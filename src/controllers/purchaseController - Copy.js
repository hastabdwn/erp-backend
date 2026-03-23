const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

const generatePONumber = async () => {
  const now = new Date();
  const prefix = `PO/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Gunakan sequence untuk hindari race condition
  const result = await query(
    `SELECT nextval('po_number_seq') as seq`
  );
  return `${prefix}/${String(parseInt(result.rows[0].seq)).padStart(4, '0')}`;
};

const getPurchaseRequisitions = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status } = req.query;

    let where = '', vals = [];
    if (status) { where = 'WHERE pr.status = $1'; vals.push(status); }

    const total = parseInt((await query(`SELECT COUNT(*) FROM purchase_requisitions pr ${where}`, vals)).rows[0].count);
    const result = await query(
      `SELECT pr.*, u.full_name as requested_by_name, d.name as department_name
       FROM purchase_requisitions pr
       LEFT JOIN users u ON pr.requested_by = u.id
       LEFT JOIN departments d ON pr.department_id = d.id
       ${where}
       ORDER BY pr.created_at DESC
       LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createPurchaseRequisition = async (req, res, next) => {
  try {
    const { department_id, needed_by, justification, items } = req.body;

    if (!items?.length) return errorResponse(res, 'Items wajib diisi', 400);

    const result = await transaction(async (client) => {
      const pr = await client.query(
        `INSERT INTO purchase_requisitions (requested_by, department_id, needed_by, justification, status)
         VALUES ($1,$2,$3,$4,'PENDING') RETURNING *`,
        [req.user.id, department_id, needed_by, justification]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO purchase_requisition_items (pr_id, product_id, description, quantity, estimated_unit_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [pr.rows[0].id, item.product_id, item.description, item.quantity, item.estimated_unit_price]
        );
      }
      return pr.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'PURCHASE', action: 'CREATE_PR',
      description: 'Purchase Requisition dibuat', entityId: result.id, ipAddress: req.ip
    });

    return successResponse(res, result, 'PR berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const approvePR = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body; // APPROVED or REJECTED

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return errorResponse(res, 'Status harus APPROVED atau REJECTED', 400);
    }

    const result = await query(
      `UPDATE purchase_requisitions SET status=$1, approved_by=$2, approval_notes=$3, approved_at=NOW()
       WHERE id=$4 AND status='PENDING' RETURNING *`,
      [status, req.user.id, notes, id]
    );

    if (!result.rows.length) return errorResponse(res, 'PR tidak ditemukan atau sudah diproses', 404);

    await logActivity({
      userId: req.user.id, module: 'PURCHASE', action: `${status}_PR`,
      description: `PR ${status} oleh ${req.user.full_name}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, `PR berhasil ${status === 'APPROVED' ? 'disetujui' : 'ditolak'}`);
  } catch (err) { next(err); }
};

const getPurchaseOrders = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, supplier_id, search } = req.query;

    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`po.status = $${idx}`); vals.push(status); idx++; }
    if (supplier_id) { conds.push(`po.supplier_id = $${idx}`); vals.push(supplier_id); idx++; }
    if (search) { conds.push(`(po.po_number ILIKE $${idx} OR s.name ILIKE $${idx})`); vals.push(`%${search}%`); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(
      `SELECT COUNT(*) FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id ${where}`, vals
    )).rows[0].count);

    const result = await query(
      `SELECT po.*, s.name as supplier_name, s.email as supplier_email, u.full_name as created_by_name
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN users u ON po.created_by = u.id
       ${where}
       ORDER BY po.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createPurchaseOrder = async (req, res, next) => {
  try {
    const { supplier_id, pr_id, expected_delivery, items, notes, payment_terms } = req.body;

    if (!supplier_id || !items?.length) {
      return errorResponse(res, 'supplier_id dan items wajib diisi', 400);
    }

    // Get company info for PO header
    const company = await query('SELECT * FROM company_profile LIMIT 1');

    const result = await transaction(async (client) => {
      const poNumber = await generatePONumber();
      const totalAmount = items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);

      const po = await client.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, pr_id, expected_delivery, total_amount,
          notes, payment_terms, status, created_by, company_name, company_npwp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10) RETURNING *`,
        [poNumber, supplier_id, pr_id, expected_delivery, totalAmount, notes, payment_terms,
         req.user.id, company.rows[0]?.name, company.rows[0]?.npwp]
      );

      for (const item of items) {
        await client.query(
          `INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [po.rows[0].id, item.product_id, item.description, item.quantity, item.unit_price,
           item.quantity * item.unit_price]
        );
      }
      return po.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'PURCHASE', action: 'CREATE_PO',
      description: `Purchase Order dibuat: ${result.po_number}`,
      entityId: result.id, ipAddress: req.ip
    });

    return successResponse(res, result, 'PO berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const receiveGoods = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items, received_date, notes } = req.body;

    const po = await query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
    if (!po.rows.length) return errorResponse(res, 'PO tidak ditemukan', 404);
    if (!['APPROVED', 'PARTIAL'].includes(po.rows[0].status)) {
      return errorResponse(res, 'PO belum disetujui atau sudah selesai', 400);
    }

    await transaction(async (client) => {
      for (const item of items) {
        // Update received quantity
        await client.query(
          `UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2`,
          [item.received_quantity, item.po_item_id]
        );

        // Add to inventory
        const poItem = await client.query('SELECT * FROM purchase_order_items WHERE id = $1', [item.po_item_id]);
        await client.query(
          'UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2',
          [item.received_quantity, poItem.rows[0].product_id]
        );

        await client.query(
          `INSERT INTO stock_movements (product_id, movement_type, quantity, unit_cost, reference_id, notes, created_by)
           VALUES ($1,'IN',$2,$3,$4,$5,$6)`,
          [poItem.rows[0].product_id, item.received_quantity, poItem.rows[0].unit_price,
           id, notes, req.user.id]
        );
      }

      // Auto journal: Debit Persediaan (1300), Kredit Hutang Usaha (2100)
      const je = await client.query(
        `INSERT INTO journal_entries (entry_date, reference_number, description, type, total_amount, status, created_by)
         VALUES ($1,$2,$3,'EXPENSE',$4,'POSTED',$5) RETURNING id`,
        [received_date, `GR-${po.rows[0].po_number}`,
         `Penerimaan barang dari ${po.rows[0].po_number}`, po.rows[0].total_amount, req.user.id]
      );
      const jeId = je.rows[0].id;
      const amt = po.rows[0].total_amount;
      // Get account IDs
      const persediaan = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '1300' LIMIT 1`);
      const hutang = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '2100' LIMIT 1`);
      if (persediaan.rows.length && hutang.rows.length) {
        const persediaanId = persediaan.rows[0].id;
        const hutangId = hutang.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,$4,0,1)`,
          [jeId, persediaanId, 'Penerimaan persediaan', amt]
        );
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,0,$4,2)`,
          [jeId, hutangId, 'Hutang usaha', amt]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [persediaanId, jeId, received_date, amt]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [hutangId, jeId, received_date, amt]
        );
      }

      // Check if all items received
      const remaining = await client.query(
        `SELECT COUNT(*) FROM purchase_order_items 
         WHERE po_id = $1 AND received_quantity < quantity`, [id]
      );
      const newStatus = parseInt(remaining.rows[0].count) === 0 ? 'RECEIVED' : 'PARTIAL';
      await client.query(
        'UPDATE purchase_orders SET status=$1, received_date=$2 WHERE id=$3',
        [newStatus, received_date, id]
      );
    });

    await logActivity({
      userId: req.user.id, module: 'PURCHASE', action: 'RECEIVE_GOODS',
      description: `Penerimaan barang untuk PO: ${po.rows[0].po_number}`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, null, 'Penerimaan barang berhasil dicatat');
  } catch (err) { next(err); }
};

// Suppliers CRUD
const getSuppliers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search } = req.query;

    let where = '', vals = [];
    if (search) {
      where = 'WHERE name ILIKE $1 OR email ILIKE $1 OR npwp ILIKE $1';
      vals.push(`%${search}%`);
    }

    const total = parseInt((await query(`SELECT COUNT(*) FROM suppliers ${where}`, vals)).rows[0].count);
    const result = await query(
      `SELECT *, (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = suppliers.id) as total_orders
       FROM suppliers ${where} ORDER BY name LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createSupplier = async (req, res, next) => {
  try {
    const { name, code, email, phone, address, city, npwp, bank_name, bank_account, payment_terms } = req.body;
    if (!name || !code) return errorResponse(res, 'Nama dan kode supplier wajib', 400);

    const result = await query(
      `INSERT INTO suppliers (name, code, email, phone, address, city, npwp, bank_name, bank_account, payment_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, code, email, phone, address, city, npwp, bank_name, bank_account, payment_terms]
    );

    await logActivity({
      userId: req.user.id, module: 'PURCHASE', action: 'CREATE_SUPPLIER',
      description: `Supplier baru: ${name}`, entityId: result.rows[0].id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Supplier berhasil ditambahkan', 201);
  } catch (err) { next(err); }
};


const getPurchaseOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const po = await query(
      `SELECT po.*, s.name as supplier_name FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = $1`, [id]
    );
    if (!po.rows.length) return errorResponse(res, 'PO tidak ditemukan', 404);

    const items = await query(
      `SELECT poi.*, p.name as product_name, p.sku
       FROM purchase_order_items poi
       LEFT JOIN products p ON poi.product_id = p.id
       WHERE poi.po_id = $1 ORDER BY poi.id`, [id]
    );

    return successResponse(res, { ...po.rows[0], items: items.rows });
  } catch (err) { next(err); }
};

// approvePO
const approvePO = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
      return errorResponse(res, 'Status harus APPROVED, REJECTED, atau CANCELLED', 400);
    }
    const result = await query(
      `UPDATE purchase_orders SET status=$1, notes=COALESCE($2, notes), updated_at=NOW()
       WHERE id=$3 AND status='PENDING' RETURNING *`,
      [status, notes, id]
    );
    if (!result.rows.length) return errorResponse(res, 'PO tidak ditemukan atau sudah diproses', 404);
    await logActivity({
      userId: req.user.id, module: 'PURCHASE', action: `${status}_PO`,
      description: `PO ${result.rows[0].po_number} ${status} oleh ${req.user.full_name}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });
    return successResponse(res, result.rows[0], `PO berhasil ${status === 'APPROVED' ? 'disetujui' : 'ditolak'}`);
  } catch (err) { next(err); }
};
module.exports = {
  getPurchaseRequisitions, createPurchaseRequisition, approvePR,
  getPurchaseOrders, getPurchaseOrderById, createPurchaseOrder, approvePO, receiveGoods,
  getSuppliers, createSupplier
};
