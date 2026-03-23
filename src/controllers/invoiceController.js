const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

const generateInvoiceNumber = async (client) => {
  const now = new Date();
  const prefix = `INV/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fn = client ? (sql, params) => client.query(sql, params) : query;
  // Gunakan sequence untuk hindari race condition
  const result = await fn(`SELECT nextval('invoice_number_seq') as seq`, []);
  return `${prefix}/${String(parseInt(result.rows[0].seq)).padStart(4, '0')}`;
};

const getInvoices = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, customer_id, start_date, end_date, search } = req.query;

    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`i.status = $${idx}`); vals.push(status); idx++; }
    if (customer_id) { conds.push(`i.customer_id = $${idx}`); vals.push(customer_id); idx++; }
    if (start_date) { conds.push(`i.invoice_date >= $${idx}`); vals.push(start_date); idx++; }
    if (end_date) { conds.push(`i.invoice_date <= $${idx}`); vals.push(end_date); idx++; }
    if (search) { conds.push(`(i.invoice_number ILIKE $${idx} OR c.name ILIKE $${idx})`); vals.push(`%${search}%`); idx++; }

    // Auto update overdue
    await query(`UPDATE invoices SET status='OVERDUE' WHERE due_date < NOW() AND status = 'SENT'`);

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(
      `SELECT COUNT(*) FROM invoices i JOIN customers c ON i.customer_id = c.id ${where}`, vals
    )).rows[0].count);

    const result = await query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email,
              COALESCE(i.total_amount - i.paid_amount, i.total_amount) as balance_due
       FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       ${where}
       ORDER BY i.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getInvoiceById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const inv = await query(`
      SELECT i.*, c.name as customer_name, c.address as customer_address,
             c.email as customer_email, c.phone as customer_phone,
             cp.name as company_name, cp.address as company_address,
             cp.npwp as company_npwp, cp.bank_account as company_bank
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      CROSS JOIN company_profile cp
      WHERE i.id = $1
    `, [id]);

    if (!inv.rows.length) return errorResponse(res, 'Invoice tidak ditemukan', 404);

    const items = await query(`
      SELECT ii.*, p.name as product_name, p.sku
      FROM invoice_items ii
      LEFT JOIN products p ON ii.product_id = p.id
      WHERE ii.invoice_id = $1
      ORDER BY ii.line_order
    `, [id]);

    const payments = await query(`
      SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date
    `, [id]);

    return successResponse(res, { ...inv.rows[0], items: items.rows, payments: payments.rows });
  } catch (err) { next(err); }
};

const createInvoice = async (req, res, next) => {
  try {
    const {
      customer_id, sales_order_id,
      items, notes, tax_rate = 11, discount_amount = 0
    } = req.body;

    // Sanitasi tanggal — string kosong "" error di PostgreSQL type date
    const invoice_date = req.body.invoice_date && req.body.invoice_date.trim() !== ''
      ? req.body.invoice_date
      : new Date().toISOString().slice(0, 10);
    const due_date = req.body.due_date && req.body.due_date.trim() !== ''
      ? req.body.due_date
      : null;

    if (!customer_id || !items?.length) {
      return errorResponse(res, 'customer_id dan items wajib diisi', 400);
    }

    const result = await transaction(async (client) => {
      const invoiceNumber = await generateInvoiceNumber(client);

      const subtotal = items.reduce((s, item) => s + (item.quantity * item.unit_price), 0);
      const taxAmount = (subtotal - discount_amount) * tax_rate / 100;
      const totalAmount = subtotal - discount_amount + taxAmount;

      const inv = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, sales_order_id, invoice_date, due_date,
          subtotal, discount_amount, tax_rate, tax_amount, total_amount, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12) RETURNING *`,
        [invoiceNumber, customer_id, sales_order_id, invoice_date, due_date,
         subtotal, discount_amount, tax_rate, taxAmount, totalAmount, notes, req.user.id]
      // paid_amount defaults to 0 via DB default
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const lineTotal = item.quantity * item.unit_price * (1 - (item.discount_pct || 0) / 100);
        await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, discount_pct, line_total, line_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [inv.rows[0].id, item.product_id, item.description, item.quantity, item.unit_price,
           item.discount_pct || 0, lineTotal, i + 1]
        );
      }
      return inv.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'INVOICE', action: 'CREATE_INVOICE',
      description: `Invoice dibuat: ${result.invoice_number}`,
      entityId: result.id, ipAddress: req.ip
    });

    return successResponse(res, result, 'Invoice berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const sendInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const inv = await query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!inv.rows.length) return errorResponse(res, 'Invoice tidak ditemukan', 404);
    if (inv.rows[0].status !== 'DRAFT') return errorResponse(res, 'Hanya invoice DRAFT yang bisa dikirim', 400);

    await query(
      'UPDATE invoices SET status=$1, sent_at=NOW() WHERE id=$2',
      ['SENT', id]
    );

    await logActivity({
      userId: req.user.id, module: 'INVOICE', action: 'SEND_INVOICE',
      description: `Invoice dikirim: ${inv.rows[0].invoice_number}`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, null, 'Invoice berhasil dikirim');
  } catch (err) { next(err); }
};

const recordPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, payment_date, payment_method, reference, notes } = req.body;

    const inv = await query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (!inv.rows.length) return errorResponse(res, 'Invoice tidak ditemukan', 404);
    if (inv.rows[0].status === 'PAID') return errorResponse(res, 'Invoice sudah lunas', 400);

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO invoice_payments (invoice_id, amount, payment_date, payment_method, reference, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, amount, payment_date, payment_method, reference, notes, req.user.id]
      );

      // Check if fully paid
      const payments = await client.query(
        'SELECT COALESCE(SUM(amount), 0) as paid FROM invoice_payments WHERE invoice_id = $1', [id]
      );
      const totalPaid = parseFloat(payments.rows[0].paid);
      const newStatus = totalPaid >= parseFloat(inv.rows[0].total_amount) ? 'PAID' : 'PARTIAL';

      await client.query(
        'UPDATE invoices SET status=$1, paid_amount=$2 WHERE id=$3',
        [newStatus, totalPaid, id]
      );

      // Auto journal: Debit Kas (1100), Kredit Piutang Usaha (1200)
      const je = await client.query(
        `INSERT INTO journal_entries (entry_date, reference_number, description, type, total_amount, status, created_by)
         VALUES ($1,$2,$3,'REVENUE',$4,'POSTED',$5) RETURNING id`,
        [payment_date, reference || `PAY-${inv.rows[0].invoice_number}`,
         `Pembayaran invoice ${inv.rows[0].invoice_number}`, amount, req.user.id]
      );
      const jeId = je.rows[0].id;
      const kas = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '1100' LIMIT 1`);
      const piutang = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '1200' LIMIT 1`);
      if (kas.rows.length && piutang.rows.length) {
        const kasId = kas.rows[0].id;
        const piutangId = piutang.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,$4,0,1)`,
          [jeId, kasId, 'Penerimaan kas', amount]
        );
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,0,$4,2)`,
          [jeId, piutangId, 'Pelunasan piutang', amount]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [kasId, jeId, payment_date, amount]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [piutangId, jeId, payment_date, amount]
        );
      }

      await logActivity({
        userId: req.user.id, module: 'INVOICE', action: 'RECORD_PAYMENT',
        description: `Pembayaran Rp ${amount} untuk invoice ${inv.rows[0].invoice_number}`,
        entityId: id, ipAddress: req.ip
      });
    });

    return successResponse(res, null, 'Pembayaran berhasil dicatat');
  } catch (err) { next(err); }
};

module.exports = { getInvoices, getInvoiceById, createInvoice, sendInvoice, recordPayment };
