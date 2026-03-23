const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

// === JOURNAL ENTRIES ===
const getJournalEntries = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, type, start_date, end_date, search } = req.query;

    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`je.status = $${idx}`); vals.push(status); idx++; }
    if (type) { conds.push(`je.type = $${idx}`); vals.push(type); idx++; }
    if (start_date) { conds.push(`je.entry_date >= $${idx}`); vals.push(start_date); idx++; }
    if (end_date) { conds.push(`je.entry_date <= $${idx}`); vals.push(end_date); idx++; }
    if (search) { conds.push(`(je.reference_number ILIKE $${idx} OR je.description ILIKE $${idx})`); vals.push(`%${search}%`); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM journal_entries je ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT je.*, u.full_name as created_by_name
       FROM journal_entries je
       LEFT JOIN users u ON je.created_by = u.id
       ${where}
       ORDER BY je.entry_date DESC, je.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getJournalEntryById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const je = await query(`
      SELECT je.*, u.full_name as created_by_name
      FROM journal_entries je
      LEFT JOIN users u ON je.created_by = u.id
      WHERE je.id = $1
    `, [id]);

    if (!je.rows.length) return errorResponse(res, 'Jurnal tidak ditemukan', 404);

    const lines = await query(`
      SELECT jel.*, coa.code as account_code, coa.name as account_name
      FROM journal_entry_lines jel
      JOIN chart_of_accounts coa ON jel.account_id = coa.id
      WHERE jel.journal_entry_id = $1
      ORDER BY jel.line_order
    `, [id]);

    return successResponse(res, { ...je.rows[0], lines: lines.rows });
  } catch (err) { next(err); }
};

const createJournalEntry = async (req, res, next) => {
  try {
    const { entry_date, reference_number, description, type, lines } = req.body;

    if (!lines || lines.length < 2) {
      return errorResponse(res, 'Jurnal minimal memiliki 2 baris', 400);
    }

    const totalDebit = lines.reduce((s, l) => s + parseFloat(l.debit || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + parseFloat(l.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return errorResponse(res, `Jurnal tidak balance. Debit: ${totalDebit}, Kredit: ${totalCredit}`, 400);
    }

    const result = await transaction(async (client) => {
      const je = await client.query(
        `INSERT INTO journal_entries (entry_date, reference_number, description, type, total_amount, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'DRAFT',$6) RETURNING *`,
        [entry_date, reference_number, description, type, totalDebit, req.user.id]
      );

      for (let i = 0; i < lines.length; i++) {
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [je.rows[0].id, lines[i].account_id, lines[i].description, lines[i].debit || 0, lines[i].credit || 0, i + 1]
        );
      }
      return je.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'FINANCE', action: 'CREATE_JOURNAL',
      description: `Jurnal dibuat: ${reference_number} - ${description}`,
      entityId: result.id, entityType: 'journal_entry', ipAddress: req.ip
    });

    return successResponse(res, result, 'Jurnal berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const postJournalEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const je = await query('SELECT * FROM journal_entries WHERE id = $1', [id]);

    if (!je.rows.length) return errorResponse(res, 'Jurnal tidak ditemukan', 404);
    if (je.rows[0].status === 'POSTED') return errorResponse(res, 'Jurnal sudah diposting', 400);

    await query(
      'UPDATE journal_entries SET status=$1, posted_at=NOW(), posted_by=$2 WHERE id=$3',
      ['POSTED', req.user.id, id]
    );

    // Update ledger balances
    const lines = await query('SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1', [id]);
    for (const line of lines.rows) {
      await query(
        `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit)
         VALUES ($1,$2,$3,$4,$5)`,
        [line.account_id, id, je.rows[0].entry_date, line.debit, line.credit]
      );
    }

    await logActivity({
      userId: req.user.id, module: 'FINANCE', action: 'POST_JOURNAL',
      description: `Jurnal diposting: ${je.rows[0].reference_number}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Jurnal berhasil diposting');
  } catch (err) { next(err); }
};

// === FINANCIAL REPORTS ===
const getIncomeStatement = async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) return errorResponse(res, 'start_date dan end_date diperlukan', 400);

    const result = await query(`
      SELECT 
        coa.account_type,
        coa.code,
        coa.name,
        COALESCE(SUM(gl.debit), 0) as total_debit,
        COALESCE(SUM(gl.credit), 0) as total_credit,
        COALESCE(SUM(gl.credit - gl.debit), 0) as balance
      FROM chart_of_accounts coa
      LEFT JOIN general_ledger gl ON coa.id = gl.account_id
        AND gl.entry_date BETWEEN $1 AND $2
      WHERE coa.account_type IN ('REVENUE', 'EXPENSE', 'COGS')
      GROUP BY coa.id, coa.account_type, coa.code, coa.name
      ORDER BY coa.account_type, coa.code
    `, [start_date, end_date]);

    const revenue = result.rows.filter(r => r.account_type === 'REVENUE');
    const cogs = result.rows.filter(r => r.account_type === 'COGS');
    const expenses = result.rows.filter(r => r.account_type === 'EXPENSE');

    const totalRevenue = revenue.reduce((s, r) => s + parseFloat(r.balance), 0);
    const totalCogs = cogs.reduce((s, r) => s + parseFloat(r.balance), 0);
    const totalExpenses = expenses.reduce((s, r) => s + parseFloat(r.balance), 0);
    const grossProfit = totalRevenue - totalCogs;
    const netProfit = grossProfit - totalExpenses;

    return successResponse(res, {
      period: { start_date, end_date },
      revenue, total_revenue: totalRevenue,
      cogs, total_cogs: totalCogs,
      gross_profit: grossProfit,
      expenses, total_expenses: totalExpenses,
      net_profit: netProfit
    });
  } catch (err) { next(err); }
};

const getBalanceSheet = async (req, res, next) => {
  try {
    const { as_of_date } = req.query;
    const date = as_of_date || new Date().toISOString().split('T')[0];

    const result = await query(`
      SELECT 
        coa.account_type, coa.code, coa.name,
        COALESCE(SUM(gl.debit - gl.credit), 0) as balance
      FROM chart_of_accounts coa
      LEFT JOIN general_ledger gl ON coa.id = gl.account_id AND gl.entry_date <= $1
      WHERE coa.account_type IN ('ASSET', 'LIABILITY', 'EQUITY')
      GROUP BY coa.id, coa.account_type, coa.code, coa.name
      ORDER BY coa.account_type, coa.code
    `, [date]);

    const assets = result.rows.filter(r => r.account_type === 'ASSET');
    const liabilities = result.rows.filter(r => r.account_type === 'LIABILITY');
    const equity = result.rows.filter(r => r.account_type === 'EQUITY');

    return successResponse(res, {
      as_of_date: date,
      assets, total_assets: assets.reduce((s, r) => s + parseFloat(r.balance), 0),
      liabilities, total_liabilities: liabilities.reduce((s, r) => s + parseFloat(r.balance), 0),
      equity, total_equity: equity.reduce((s, r) => s + parseFloat(r.balance), 0)
    });
  } catch (err) { next(err); }
};

const getBankReconciliation = async (req, res, next) => {
  try {
    const { account_id, month, year } = req.query;
    if (!account_id) return errorResponse(res, 'account_id diperlukan', 400);

    const result = await query(`
      SELECT 
        gl.*,
        je.reference_number, je.description as je_description
      FROM general_ledger gl
      JOIN journal_entries je ON gl.journal_entry_id = je.id
      WHERE gl.account_id = $1
      AND DATE_PART('month', gl.entry_date) = $2
      AND DATE_PART('year', gl.entry_date) = $3
      ORDER BY gl.entry_date
    `, [account_id, month || new Date().getMonth() + 1, year || new Date().getFullYear()]);

    const balance = result.rows.reduce((s, r) => s + parseFloat(r.debit) - parseFloat(r.credit), 0);

    return successResponse(res, { transactions: result.rows, closing_balance: balance });
  } catch (err) { next(err); }
};

module.exports = {
  getJournalEntries, getJournalEntryById, createJournalEntry, postJournalEntry,
  getIncomeStatement, getBalanceSheet, getBankReconciliation
};
