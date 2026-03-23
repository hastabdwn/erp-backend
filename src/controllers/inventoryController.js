const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

const getProducts = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { category_id, search, low_stock, is_active = 'true' } = req.query;

    let conds = ['p.is_active = $1'], vals = [is_active !== 'false'], idx = 2;
    if (category_id) { conds.push(`p.category_id = $${idx}`); vals.push(category_id); idx++; }
    if (search) { conds.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`); vals.push(`%${search}%`); idx++; }
    if (low_stock === 'true') { conds.push(`p.current_stock <= p.reorder_point`); }

    const where = 'WHERE ' + conds.join(' AND ');
    const total = parseInt((await query(`SELECT COUNT(*) FROM products p ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT p.*, pc.name as category_name,
              CASE WHEN p.current_stock = 0 THEN 'OUT_OF_STOCK'
                   WHEN p.current_stock <= p.reorder_point THEN 'LOW_STOCK'
                   ELSE 'NORMAL' END as stock_status
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       ${where}
       ORDER BY p.name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await query(
      `SELECT p.*, pc.name as category_name
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       WHERE p.id = $1`, [id]
    );

    if (!product.rows.length) return errorResponse(res, 'Produk tidak ditemukan', 404);

    const movements = await query(
      `SELECT sm.*, u.full_name as created_by_name
       FROM stock_movements sm
       LEFT JOIN users u ON sm.created_by = u.id
       WHERE sm.product_id = $1
       ORDER BY sm.created_at DESC LIMIT 20`, [id]
    );

    return successResponse(res, { ...product.rows[0], recent_movements: movements.rows });
  } catch (err) { next(err); }
};

const createProduct = async (req, res, next) => {
  try {
    const {
      sku, name, description, category_id, unit, unit_cost, selling_price,
      current_stock = 0, minimum_stock = 0, reorder_point = 0, is_raw_material = false
    } = req.body;

    if (!sku || !name || !unit) return errorResponse(res, 'SKU, nama, dan satuan wajib diisi', 400);

    const result = await query(
      `INSERT INTO products (sku, name, description, category_id, unit, unit_cost, selling_price,
        current_stock, minimum_stock, reorder_point, is_raw_material)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [sku, name, description, category_id, unit, unit_cost, selling_price,
       current_stock, minimum_stock, reorder_point, is_raw_material]
    );

    if (current_stock > 0) {
      await query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity, unit_cost, notes, created_by)
         VALUES ($1,'INITIAL',$2,$3,'Stok awal',$4)`,
        [result.rows[0].id, current_stock, unit_cost, req.user.id]
      );
    }

    await logActivity({
      userId: req.user.id, module: 'INVENTORY', action: 'CREATE_PRODUCT',
      description: `Produk baru: ${name} (${sku})`,
      entityId: result.rows[0].id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Produk berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const adjustStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { quantity, movement_type, unit_cost, notes, reference_id } = req.body;

    if (!quantity || !movement_type) {
      return errorResponse(res, 'quantity dan movement_type wajib diisi', 400);
    }

    // Cek produk exists dulu
    const checkProduct = await query('SELECT id, name FROM products WHERE id = $1', [id]);
    if (!checkProduct.rows.length) return errorResponse(res, 'Produk tidak ditemukan', 404);

    const isIn = ['IN', 'INITIAL', 'RETURN', 'PRODUCTION_IN', 'ADJUSTMENT'].includes(movement_type);
    const isOut = ['OUT', 'PRODUCTION_OUT', 'SALE', 'DAMAGE'].includes(movement_type);

    await transaction(async (client) => {
      // Lock row untuk hindari race condition
      const product = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
      const currentStock = parseFloat(product.rows[0].current_stock);
      const qty = parseFloat(quantity);

      if (isOut && currentStock < qty) {
        throw new Error(`Stok tidak mencukupi. Tersedia: ${currentStock}`);
      }

      const newStock = isIn ? currentStock + qty : currentStock - qty;

      await client.query('UPDATE products SET current_stock=$1, updated_at=NOW() WHERE id=$2', [newStock, id]);

      await client.query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity, unit_cost, notes, reference_id, stock_before, stock_after, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, movement_type, qty, unit_cost, notes, reference_id, currentStock, newStock, req.user.id]
      );
    });

    await logActivity({
      userId: req.user.id, module: 'INVENTORY', action: `STOCK_${movement_type}`,
      description: `Penyesuaian stok ${checkProduct.rows[0].name}: ${movement_type} ${quantity} unit`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, null, 'Stok berhasil disesuaikan');
  } catch (err) { next(err); }
};

const getStockMovements = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { product_id, movement_type, start_date, end_date } = req.query;

    let conds = [], vals = [], idx = 1;
    if (product_id) { conds.push(`sm.product_id = $${idx}`); vals.push(product_id); idx++; }
    if (movement_type) { conds.push(`sm.movement_type = $${idx}`); vals.push(movement_type); idx++; }
    if (start_date) { conds.push(`sm.created_at >= $${idx}`); vals.push(start_date); idx++; }
    if (end_date) { conds.push(`sm.created_at <= $${idx}`); vals.push(end_date); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM stock_movements sm ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT sm.*, p.name as product_name, p.sku, u.full_name as created_by_name
       FROM stock_movements sm
       JOIN products p ON sm.product_id = p.id
       LEFT JOIN users u ON sm.created_by = u.id
       ${where}
       ORDER BY sm.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getLowStockAlerts = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT p.id, p.sku, p.name, p.current_stock, p.reorder_point, p.minimum_stock, p.unit,
             pc.name as category_name,
             CASE WHEN p.current_stock = 0 THEN 'OUT_OF_STOCK' ELSE 'LOW_STOCK' END as alert_type
      FROM products p
      LEFT JOIN product_categories pc ON p.category_id = pc.id
      WHERE p.current_stock <= p.reorder_point AND p.is_active = true
      ORDER BY p.current_stock ASC
    `);
    return successResponse(res, result.rows);
  } catch (err) { next(err); }
};

const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      sku, name, description, category_id, unit, unit_cost, selling_price,
      minimum_stock, reorder_point, is_raw_material, is_active
    } = req.body;

    const existing = await query('SELECT id FROM products WHERE id = $1', [id]);
    if (!existing.rows.length) return errorResponse(res, 'Produk tidak ditemukan', 404);

    const result = await query(
      `UPDATE products SET
        sku = COALESCE($1, sku),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        category_id = COALESCE($4, category_id),
        unit = COALESCE($5, unit),
        unit_cost = COALESCE($6, unit_cost),
        selling_price = COALESCE($7, selling_price),
        minimum_stock = COALESCE($8, minimum_stock),
        reorder_point = COALESCE($9, reorder_point),
        is_raw_material = COALESCE($10, is_raw_material),
        is_active = COALESCE($11, is_active),
        updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [sku, name, description, category_id, unit, unit_cost, selling_price,
       minimum_stock, reorder_point, is_raw_material, is_active, id]
    );

    await logActivity({
      userId: req.user.id, module: 'INVENTORY', action: 'UPDATE_PRODUCT',
      description: `Produk diupdate: ${result.rows[0].name} (${result.rows[0].sku})`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Produk berhasil diupdate');
  } catch (err) { next(err); }
};

const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await query('SELECT id, name, current_stock FROM products WHERE id = $1', [id]);
    if (!existing.rows.length) return errorResponse(res, 'Produk tidak ditemukan', 404);
    if (parseFloat(existing.rows[0].current_stock) > 0) {
      return errorResponse(res, 'Tidak bisa menghapus produk yang masih memiliki stok. Sesuaikan stok ke 0 terlebih dahulu.', 400);
    }

    // Soft delete
    await query('UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);

    await logActivity({
      userId: req.user.id, module: 'INVENTORY', action: 'DELETE_PRODUCT',
      description: `Produk dinonaktifkan: ${existing.rows[0].name}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Produk berhasil dinonaktifkan');
  } catch (err) { next(err); }
};

module.exports = { getProducts, getProductById, createProduct, updateProduct, deleteProduct, adjustStock, getStockMovements, getLowStockAlerts };
