const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

const generateSONumber = async () => {
  const now = new Date();
  const prefix = `SO/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const result = await query(`SELECT nextval('so_number_seq') as seq`);
  return `${prefix}/${String(parseInt(result.rows[0].seq)).padStart(4, '0')}`;
};

// Customers
const getCustomers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;
    let where = '', vals = [];
    if (search) { where = 'WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1'; vals.push(`%${search}%`); }
    const total = parseInt((await query(`SELECT COUNT(*) FROM customers ${where}`, vals)).rows[0].count);
    const result = await query(
      `SELECT *,
        (SELECT COUNT(*) FROM sales_orders WHERE customer_id = customers.id) as total_orders,
        (SELECT COALESCE(SUM(total_amount),0) FROM sales_orders WHERE customer_id = customers.id AND status='COMPLETED') as total_spend
       FROM customers ${where} ORDER BY name LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, limit, offset]
    );
    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createCustomer = async (req, res, next) => {
  try {
    const { name, code, email, phone, address, city, npwp, credit_limit, payment_terms } = req.body;
    if (!name) return errorResponse(res, 'Nama pelanggan wajib', 400);
    const result = await query(
      `INSERT INTO customers (name, code, email, phone, address, city, npwp, credit_limit, payment_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, code, email, phone, address, city, npwp, credit_limit || 0, payment_terms]
    );
    await logActivity({
      userId: req.user.id, module: 'SALES', action: 'CREATE_CUSTOMER',
      description: `Pelanggan baru: ${name}`, entityId: result.rows[0].id, ipAddress: req.ip
    });
    return successResponse(res, result.rows[0], 'Pelanggan berhasil ditambahkan', 201);
  } catch (err) { next(err); }
};

const updateCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, email, phone, address, city, npwp, credit_limit, payment_terms } = req.body;
    const existing = await query('SELECT id FROM customers WHERE id = $1', [id]);
    if (!existing.rows.length) return errorResponse(res, 'Pelanggan tidak ditemukan', 404);
    const result = await query(
      `UPDATE customers SET
        name = COALESCE($1, name), code = COALESCE($2, code),
        email = COALESCE($3, email), phone = COALESCE($4, phone),
        address = COALESCE($5, address), city = COALESCE($6, city),
        npwp = COALESCE($7, npwp), credit_limit = COALESCE($8, credit_limit),
        payment_terms = COALESCE($9, payment_terms), updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [name, code, email, phone, address, city, npwp, credit_limit, payment_terms, id]
    );
    await logActivity({
      userId: req.user.id, module: 'SALES', action: 'UPDATE_CUSTOMER',
      description: `Data pelanggan diupdate: ${result.rows[0].name}`,
      entityId: id, ipAddress: req.ip
    });
    return successResponse(res, result.rows[0], 'Data pelanggan berhasil diupdate');
  } catch (err) { next(err); }
};

// Sales Orders
const getSalesOrders = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, customer_id, start_date, end_date, search } = req.query;
    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`so.status = $${idx}`); vals.push(status); idx++; }
    if (customer_id) { conds.push(`so.customer_id = $${idx}`); vals.push(customer_id); idx++; }
    if (start_date) { conds.push(`so.order_date >= $${idx}`); vals.push(start_date); idx++; }
    if (end_date) { conds.push(`so.order_date <= $${idx}`); vals.push(end_date); idx++; }
    if (search) { conds.push(`(so.so_number ILIKE $${idx} OR c.name ILIKE $${idx})`); vals.push(`%${search}%`); idx++; }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(
      `SELECT COUNT(*) FROM sales_orders so JOIN customers c ON so.customer_id = c.id ${where}`, vals
    )).rows[0].count);
    const result = await query(
      `SELECT so.*, c.name as customer_name, c.email as customer_email, u.full_name as created_by_name
       FROM sales_orders so
       JOIN customers c ON so.customer_id = c.id
       LEFT JOIN users u ON so.created_by = u.id
       ${where}
       ORDER BY so.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );
    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getSalesOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const so = await query(
      `SELECT so.*, c.name as customer_name, c.email as customer_email,
              c.address as customer_address, u.full_name as created_by_name
       FROM sales_orders so
       JOIN customers c ON so.customer_id = c.id
       LEFT JOIN users u ON so.created_by = u.id
       WHERE so.id = $1`, [id]
    );
    if (!so.rows.length) return errorResponse(res, 'Sales Order tidak ditemukan', 404);
    const items = await query(
      `SELECT soi.*, p.name as product_name, p.sku, p.current_stock
       FROM sales_order_items soi
       LEFT JOIN products p ON soi.product_id = p.id
       WHERE soi.sales_order_id = $1`, [id]
    );
    return successResponse(res, { ...so.rows[0], items: items.rows });
  } catch (err) { next(err); }
};

const createSalesOrder = async (req, res, next) => {
  try {
    const { customer_id, items, notes, payment_terms, discount_amount = 0 } = req.body;

    // Sanitasi tanggal — string kosong "" akan error di PostgreSQL type date
    const order_date = req.body.order_date && req.body.order_date.trim() !== ''
      ? req.body.order_date
      : new Date().toISOString().slice(0, 10);
    const delivery_date = req.body.delivery_date && req.body.delivery_date.trim() !== ''
      ? req.body.delivery_date
      : null;

    if (!customer_id || !items?.length) {
      return errorResponse(res, 'customer_id dan items wajib diisi', 400);
    }

    // Check stock availability
    for (const item of items) {
      const product = await query('SELECT current_stock, name FROM products WHERE id = $1', [item.product_id]);
      if (!product.rows.length) return errorResponse(res, `Produk ID ${item.product_id} tidak ditemukan`, 400);
      if (product.rows[0].current_stock < item.quantity) {
        await logActivity({
          userId: req.user.id, module: 'SALES', action: 'STOCK_INSUFFICIENT',
          description: `Stok tidak cukup untuk ${product.rows[0].name}. Dibutuhkan: ${item.quantity}, Tersedia: ${product.rows[0].current_stock}`,
          ipAddress: req.ip, level: 'ERROR'
        });
        return errorResponse(res, `Stok ${product.rows[0].name} tidak mencukupi. Tersedia: ${product.rows[0].current_stock}`, 400);
      }
    }

    const result = await transaction(async (client) => {
      const soNumber = await generateSONumber();
      const subtotal = items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
      const totalAmount = subtotal - discount_amount;
      const so = await client.query(
        `INSERT INTO sales_orders (so_number, customer_id, order_date, delivery_date, subtotal,
          discount_amount, total_amount, notes, payment_terms, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10) RETURNING *`,
        [soNumber, customer_id, order_date, delivery_date, subtotal, discount_amount, totalAmount,
         notes, payment_terms, req.user.id]
      );
      for (const item of items) {
        const lineTotal = item.quantity * item.unit_price;
        await client.query(
          `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5)`,
          [so.rows[0].id, item.product_id, item.quantity, item.unit_price, lineTotal]
        );
      }
      return so.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'SALES', action: 'CREATE_SO',
      description: `Sales Order dibuat: ${result.so_number}`,
      entityId: result.id, ipAddress: req.ip
    });
    return successResponse(res, result, 'Sales Order berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const confirmSalesOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const so = await query('SELECT * FROM sales_orders WHERE id = $1', [id]);
    if (!so.rows.length) return errorResponse(res, 'SO tidak ditemukan', 404);
    if (so.rows[0].status !== 'PENDING') return errorResponse(res, 'SO tidak dalam status PENDING', 400);
    const items = await query('SELECT * FROM sales_order_items WHERE sales_order_id = $1', [id]);
    for (const item of items.rows) {
      await query('UPDATE products SET reserved_stock = reserved_stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
    }
    await query('UPDATE sales_orders SET status=$1, confirmed_at=NOW() WHERE id=$2', ['CONFIRMED', id]);
    await logActivity({
      userId: req.user.id, module: 'SALES', action: 'CONFIRM_SO',
      description: `SO dikonfirmasi: ${so.rows[0].so_number}`, entityId: id, ipAddress: req.ip
    });
    return successResponse(res, null, 'Sales Order dikonfirmasi dan stok direservasi');
  } catch (err) { next(err); }
};

const shipSalesOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tracking_number } = req.body;
    // Sanitasi shipping_date
    const shipping_date = req.body.shipping_date && req.body.shipping_date.trim() !== ''
      ? req.body.shipping_date
      : new Date().toISOString().slice(0, 10);
    const notes = req.body.notes || null;

    const so = await query('SELECT * FROM sales_orders WHERE id = $1', [id]);
    if (!so.rows.length) return errorResponse(res, 'SO tidak ditemukan', 404);
    if (so.rows[0].status !== 'CONFIRMED') return errorResponse(res, 'SO belum dikonfirmasi', 400);

    await transaction(async (client) => {
      const items = await client.query('SELECT * FROM sales_order_items WHERE sales_order_id = $1', [id]);
      for (const item of items.rows) {
        await client.query(
          'UPDATE products SET current_stock = current_stock - $1, reserved_stock = reserved_stock - $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
        await client.query(
          `INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by)
           VALUES ($1,'SALE',$2,$3,'Pengiriman SO',$4)`,
          [item.product_id, item.quantity, id, req.user.id]
        );
      }
      await client.query(
        `UPDATE sales_orders SET status='SHIPPED', shipping_date=$1, tracking_number=$2, shipping_notes=$3 WHERE id=$4`,
        [shipping_date, tracking_number, notes, id]
      );
      // Auto journal: Debit Piutang Usaha (1200), Kredit Penjualan (4100)
      const jeRes = await client.query(
        `INSERT INTO journal_entries (entry_date, reference_number, description, type, total_amount, status, created_by)
         VALUES ($1,$2,$3,'REVENUE',$4,'POSTED',$5) RETURNING id`,
        [shipping_date, so.rows[0].so_number, `Penjualan ${so.rows[0].so_number}`, so.rows[0].total_amount, req.user.id]
      );
      const jeId = jeRes.rows[0].id;
      const amt = so.rows[0].total_amount;
      const piutang  = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '1200' LIMIT 1`);
      const penjualan = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '4100' LIMIT 1`);
      if (piutang.rows.length && penjualan.rows.length) {
        const piutangId   = piutang.rows[0].id;
        const penjualanId = penjualan.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,$4,0,1)`,
          [jeId, piutangId, 'Piutang usaha', amt]
        );
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,0,$4,2)`,
          [jeId, penjualanId, 'Pendapatan penjualan', amt]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [piutangId, jeId, shipping_date, amt]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [penjualanId, jeId, shipping_date, amt]
        );
      }
    });

    await logActivity({
      userId: req.user.id, module: 'SALES', action: 'SHIP_ORDER',
      description: `Barang dikirim untuk SO: ${so.rows[0].so_number}`, entityId: id, ipAddress: req.ip
    });
    return successResponse(res, null, 'Pengiriman berhasil dicatat');
  } catch (err) { next(err); }
};

const cancelSalesOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const so = await query('SELECT * FROM sales_orders WHERE id = $1', [id]);
    if (!so.rows.length) return errorResponse(res, 'Sales Order tidak ditemukan', 404);
    if (!['PENDING', 'CONFIRMED'].includes(so.rows[0].status)) {
      return errorResponse(res, `SO tidak bisa dibatalkan dari status ${so.rows[0].status}`, 400);
    }
    await transaction(async (client) => {
      if (so.rows[0].status === 'CONFIRMED') {
        const items = await client.query('SELECT * FROM sales_order_items WHERE sales_order_id = $1', [id]);
        for (const item of items.rows) {
          await client.query(
            'UPDATE products SET reserved_stock = GREATEST(0, reserved_stock - $1) WHERE id = $2',
            [item.quantity, item.product_id]
          );
        }
      }
      await client.query(
        `UPDATE sales_orders SET status = 'CANCELLED', notes = CONCAT(COALESCE(notes,''), ' [CANCELLED: ', $1, ']') WHERE id = $2`,
        [reason || 'Dibatalkan', id]
      );
    });
    await logActivity({
      userId: req.user.id, module: 'SALES', action: 'CANCEL_SO',
      description: `SO dibatalkan: ${so.rows[0].so_number}. Alasan: ${reason || '-'}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });
    return successResponse(res, null, 'Sales Order berhasil dibatalkan');
  } catch (err) { next(err); }
};

const getSalesAnalytics = async (req, res, next) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const monthly = await query(`
      SELECT DATE_PART('month', order_date) as month,
        COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as revenue
      FROM sales_orders
      WHERE DATE_PART('year', order_date) = $1 AND status != 'CANCELLED'
      GROUP BY DATE_PART('month', order_date) ORDER BY month
    `, [year]);
    const topCustomers = await query(`
      SELECT c.id, c.name, COUNT(so.id) as orders, SUM(so.total_amount) as revenue
      FROM customers c
      JOIN sales_orders so ON c.id = so.customer_id
      WHERE DATE_PART('year', so.order_date) = $1 AND so.status != 'CANCELLED'
      GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 10
    `, [year]);
    return successResponse(res, { year, monthly: monthly.rows, top_customers: topCustomers.rows });
  } catch (err) { next(err); }
};

module.exports = {
  getCustomers, createCustomer, updateCustomer,
  getSalesOrders, getSalesOrderById, createSalesOrder, confirmSalesOrder, shipSalesOrder, cancelSalesOrder,
  getSalesAnalytics
};
