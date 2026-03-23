const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

// Bill of Materials
const getBOMs = async (req, res, next) => {
  try {
    const { product_id } = req.query;
    let where = '', vals = [];
    if (product_id) { where = 'WHERE b.product_id = $1'; vals.push(product_id); }

    const result = await query(
      `SELECT b.*, p.name as product_name, p.sku
       FROM bom_headers b
       JOIN products p ON b.product_id = p.id
       ${where}
       ORDER BY b.created_at DESC`,
      vals
    );
    return successResponse(res, result.rows);
  } catch (err) { next(err); }
};

const getBOMById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const bom = await query(
      `SELECT b.*, p.name as product_name FROM bom_headers b JOIN products p ON b.product_id = p.id WHERE b.id = $1`, [id]
    );

    if (!bom.rows.length) return errorResponse(res, 'BOM tidak ditemukan', 404);

    const items = await query(
      `SELECT bi.*, p.name as material_name, p.sku, p.unit, p.current_stock
       FROM bom_items bi
       JOIN products p ON bi.material_id = p.id
       WHERE bi.bom_id = $1
       ORDER BY bi.line_order`, [id]
    );

    return successResponse(res, { ...bom.rows[0], materials: items.rows });
  } catch (err) { next(err); }
};

const createBOM = async (req, res, next) => {
  try {
    const { product_id, quantity_produced, materials, notes } = req.body;
    if (!product_id || !materials?.length) return errorResponse(res, 'product_id dan materials wajib', 400);

    const result = await transaction(async (client) => {
      const bom = await client.query(
        `INSERT INTO bom_headers (product_id, quantity_produced, notes, version, is_active)
         VALUES ($1,$2,$3,1,true) RETURNING *`,
        [product_id, quantity_produced || 1, notes]
      );

      for (let i = 0; i < materials.length; i++) {
        await client.query(
          `INSERT INTO bom_items (bom_id, material_id, quantity, unit, scrap_pct, line_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [bom.rows[0].id, materials[i].material_id, materials[i].quantity,
           materials[i].unit, materials[i].scrap_pct || 0, i + 1]
        );
      }
      return bom.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'PRODUCTION', action: 'CREATE_BOM',
      description: `BOM dibuat untuk produk ID: ${product_id}`,
      entityId: result.id, ipAddress: req.ip
    });

    return successResponse(res, result, 'BOM berhasil dibuat', 201);
  } catch (err) { next(err); }
};

// Work Orders
const getWorkOrders = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, product_id } = req.query;

    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`wo.status = $${idx}`); vals.push(status); idx++; }
    if (product_id) { conds.push(`wo.product_id = $${idx}`); vals.push(product_id); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM work_orders wo ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT wo.*, p.name as product_name, p.sku, u.full_name as created_by_name,
              CASE WHEN wo.deadline < NOW() AND wo.status NOT IN ('COMPLETED','CANCELLED') THEN true ELSE false END as is_overdue
       FROM work_orders wo
       JOIN products p ON wo.product_id = p.id
       LEFT JOIN users u ON wo.created_by = u.id
       ${where}
       ORDER BY wo.deadline ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createWorkOrder = async (req, res, next) => {
  try {
    const { product_id, bom_id, quantity, deadline, so_id, notes } = req.body;
    if (!product_id || !quantity || !deadline) return errorResponse(res, 'product_id, quantity, deadline wajib', 400);

    // Check material availability
    const bom = await query(
      `SELECT bi.*, p.name as material_name, p.current_stock
       FROM bom_items bi
       JOIN products p ON bi.material_id = p.id
       WHERE bi.bom_id = $1`, [bom_id]
    );

    const materialChecks = bom.rows.map(item => {
      const required = item.quantity * quantity * (1 + item.scrap_pct / 100);
      return {
        material: item.material_name,
        required,
        available: item.current_stock,
        sufficient: item.current_stock >= required
      };
    });

    const insufficient = materialChecks.filter(m => !m.sufficient);

    const now = new Date();
    const woSeq = await query(`SELECT nextval('wo_number_seq') as seq`);
    const woNumber = `WO/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(parseInt(woSeq.rows[0].seq)).padStart(4, '0')}`;

    const result = await query(
      `INSERT INTO work_orders (wo_number, product_id, bom_id, quantity, deadline, so_id, notes,
        status, material_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9) RETURNING *`,
      [woNumber, product_id, bom_id, quantity, deadline, so_id, notes,
       insufficient.length === 0 ? 'READY' : 'INSUFFICIENT', req.user.id]
    );

    await logActivity({
      userId: req.user.id, module: 'PRODUCTION', action: 'CREATE_WO',
      description: `Work Order dibuat: ${woNumber} untuk ${quantity} unit`,
      entityId: result.rows[0].id, ipAddress: req.ip
    });

    return successResponse(res, {
      ...result.rows[0],
      material_check: materialChecks,
      ...(insufficient.length > 0 && { warning: 'Bahan tidak mencukupi', insufficient_materials: insufficient })
    }, 'Work Order berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const startProduction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wo = await query('SELECT * FROM work_orders WHERE id = $1', [id]);
    if (!wo.rows.length) return errorResponse(res, 'WO tidak ditemukan', 404);
    if (wo.rows[0].status !== 'PENDING') return errorResponse(res, 'WO tidak dalam status PENDING', 400);

    // Consume raw materials
    await transaction(async (client) => {
      const bom = await client.query(
        'SELECT * FROM bom_items WHERE bom_id = $1', [wo.rows[0].bom_id]
      );

      for (const item of bom.rows) {
        const needed = item.quantity * wo.rows[0].quantity;
        await client.query(
          'UPDATE products SET current_stock = current_stock - $1 WHERE id = $2', [needed, item.material_id]
        );
        await client.query(
          `INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by)
           VALUES ($1,'PRODUCTION_OUT',$2,$3,'Konsumsi bahan WO',$4)`,
          [item.material_id, needed, id, req.user.id]
        );
      }

      await client.query(
        'UPDATE work_orders SET status=$1, started_at=NOW() WHERE id=$2', ['IN_PROGRESS', id]
      );
    });

    await logActivity({
      userId: req.user.id, module: 'PRODUCTION', action: 'START_PRODUCTION',
      description: `Produksi dimulai untuk WO: ${wo.rows[0].wo_number}`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, null, 'Produksi dimulai, bahan baku dikonsumsi');
  } catch (err) { next(err); }
};

const completeProduction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { actual_quantity, defect_quantity = 0, qc_notes, labor_cost = 0, overhead_cost = 0 } = req.body;

    const wo = await query('SELECT * FROM work_orders WHERE id = $1', [id]);
    if (!wo.rows.length) return errorResponse(res, 'WO tidak ditemukan', 404);
    if (wo.rows[0].status !== 'IN_PROGRESS') return errorResponse(res, 'WO belum dimulai', 400);

    const goodQty = actual_quantity - defect_quantity;

    await transaction(async (client) => {
      // Add finished goods to inventory
      await client.query(
        'UPDATE products SET current_stock = current_stock + $1 WHERE id = $2',
        [goodQty, wo.rows[0].product_id]
      );

      await client.query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by)
         VALUES ($1,'PRODUCTION_IN',$2,$3,'Hasil produksi WO',$4)`,
        [wo.rows[0].product_id, goodQty, id, req.user.id]
      );

      // Record QC
      await client.query(
        `INSERT INTO qc_records (work_order_id, actual_quantity, passed_quantity, defect_quantity, qc_notes, qc_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, actual_quantity, goodQty, defect_quantity, qc_notes, req.user.id]
      );

      // Hitung total biaya produksi (material + tenaga kerja + overhead)
      const bom = await client.query(
        `SELECT SUM(bi.quantity * wo.quantity * p.unit_cost) as material_cost
         FROM bom_items bi
         JOIN work_orders wo ON bi.bom_id = wo.bom_id
         JOIN products p ON bi.material_id = p.id
         WHERE wo.id = $1`, [id]
      );
      const materialCost = parseFloat(bom.rows[0].material_cost || 0);
      const totalCost = materialCost + parseFloat(labor_cost) + parseFloat(overhead_cost);

      // Jurnal HPP: Debit Persediaan Barang Jadi (1400), Kredit HPP/Biaya Produksi (5100)
      const jeRes = await client.query(
        `INSERT INTO journal_entries (entry_date, reference_number, description, type, total_amount, status, source_module, source_id, created_by)
         VALUES (NOW(),$1,$2,'EXPENSE',$3,'POSTED','PRODUCTION',$4,$5) RETURNING id`,
        [`WO-${wo.rows[0].wo_number}`, `HPP Produksi ${wo.rows[0].wo_number} (${goodQty} unit)`, totalCost, id, req.user.id]
      );
      const jeId = jeRes.rows[0].id;

      const persediaan = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '1400' LIMIT 1`);
      const hpp       = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '5100' LIMIT 1`);

      if (persediaan.rows.length && hpp.rows.length && totalCost > 0) {
        const persediaanId = persediaan.rows[0].id;
        const hppId = hpp.rows[0].id;
        // Debit Persediaan Barang Jadi (aset bertambah)
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,$4,0,1)`,
          [jeId, persediaanId, `Persediaan barang jadi - ${wo.rows[0].wo_number}`, totalCost]
        );
        // Kredit HPP / Biaya Produksi (biaya diakui)
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,0,$4,2)`,
          [jeId, hppId, `Biaya produksi - ${wo.rows[0].wo_number}`, totalCost]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,NOW(),$3,0)`,
          [persediaanId, jeId, totalCost]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,NOW(),0,$3)`,
          [hppId, jeId, totalCost]
        );
      }

      await client.query(
        `UPDATE work_orders SET status='COMPLETED', completed_at=NOW(), actual_quantity=$1,
         defect_quantity=$2, labor_cost=$3, overhead_cost=$4 WHERE id=$5`,
        [actual_quantity, defect_quantity, labor_cost, overhead_cost, id]
      );
    });

    await logActivity({
      userId: req.user.id, module: 'PRODUCTION', action: 'COMPLETE_WO',
      description: `WO selesai: ${wo.rows[0].wo_number}. Produksi: ${goodQty} unit lulus QC, ${defect_quantity} defect`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, null, `Produksi selesai. ${goodQty} unit lulus QC`);
  } catch (err) { next(err); }
};

module.exports = { getBOMs, getBOMById, createBOM, getWorkOrders, createWorkOrder, startProduction, completeProduction };
