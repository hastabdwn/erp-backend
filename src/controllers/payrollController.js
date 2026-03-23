const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

// BPJS & PPh 21 Constants
const BPJS_KES_EMPLOYEE = 0.01; // 1%
const BPJS_KES_EMPLOYER = 0.04; // 4%
const BPJS_TK_JHT_EMPLOYEE = 0.02; // 2%
const BPJS_TK_JHT_EMPLOYER = 0.037; // 3.7%
const BPJS_TK_JP_EMPLOYEE = 0.01; // 1%
const BPJS_TK_JP_EMPLOYER = 0.02; // 2%
const BPJS_TK_JKK_EMPLOYER = 0.0089; // 0.89%
const BPJS_TK_JKM_EMPLOYER = 0.003; // 0.3%
const PTKP_TK0 = 54000000; // Rp 54jt/tahun
const PTKP_K0 = 58500000; // Rp 58.5jt/tahun
const PTKP_K1 = 63000000;
const PTKP_K2 = 67500000;
const PTKP_K3 = 72000000;

const calculatePPh21 = (annualTaxableIncome) => {
  let tax = 0;
  const brackets = [
    { max: 60000000, rate: 0.05 },
    { max: 250000000, rate: 0.15 },
    { max: 500000000, rate: 0.25 },
    { max: 5000000000, rate: 0.30 },
    { max: Infinity, rate: 0.35 }
  ];

  let remaining = annualTaxableIncome;
  let prevMax = 0;
  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, bracket.max - prevMax);
    tax += taxable * bracket.rate;
    remaining -= taxable;
    prevMax = bracket.max;
  }
  return tax / 12; // monthly
};

const getPTKP = (marital_status, dependents) => {
  const key = `${marital_status}${dependents}`;
  const map = { 'TK0': PTKP_TK0, 'K0': PTKP_K0, 'K1': PTKP_K1, 'K2': PTKP_K2, 'K3': PTKP_K3 };
  return (map[key] || PTKP_TK0) / 12;
};

// Calculate payroll for an employee
const calculateEmployeePayroll = async (employeeId, month, year) => {
  const emp = await query(`
    SELECT e.*, e.basic_salary,
      COALESCE(SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END), 0) as present_days,
      COALESCE(SUM(CASE WHEN a.status = 'ABSENT' THEN 1 ELSE 0 END), 0) as absent_days,
      COALESCE(SUM(CASE WHEN a.status = 'LEAVE' THEN 1 ELSE 0 END), 0) as leave_days,
      COALESCE(SUM(a.overtime_hours), 0) as overtime_hours
    FROM employees e
    LEFT JOIN attendance a ON e.id = a.employee_id
      AND DATE_PART('month', a.date) = $2
      AND DATE_PART('year', a.date) = $3
    WHERE e.id = $1
    GROUP BY e.id
  `, [employeeId, month, year]);

  if (!emp.rows.length) throw new Error('Karyawan tidak ditemukan');
  const e = emp.rows[0];

  // Get allowances
  const allowances = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM employee_allowances WHERE employee_id = $1 AND is_active = true`,
    [employeeId]
  );

  // Get deductions (non-BPJS)
  const deductions = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM employee_deductions WHERE employee_id = $1 AND month = $2 AND year = $3`,
    [employeeId, month, year]
  );

  const basicSalary = parseFloat(e.basic_salary);
  const allowanceTotal = parseFloat(allowances.rows[0].total);
  const overtimePay = (basicSalary / 173) * 1.5 * parseFloat(e.overtime_hours); // 1.5x overtime
  const absentDeduction = e.absent_days > 0 ? (basicSalary / 26) * e.absent_days : 0;

  const grossSalary = basicSalary + allowanceTotal + overtimePay - absentDeduction;

  // BPJS
  const bpjsKesEmployee = grossSalary * BPJS_KES_EMPLOYEE;
  const bpjsKesEmployer = grossSalary * BPJS_KES_EMPLOYER;
  const bpjsTkJhtEmployee = grossSalary * BPJS_TK_JHT_EMPLOYEE;
  const bpjsTkJhtEmployer = grossSalary * BPJS_TK_JHT_EMPLOYER;
  const bpjsTkJpEmployee = grossSalary * BPJS_TK_JP_EMPLOYEE;
  const bpjsTkJpEmployer = grossSalary * BPJS_TK_JP_EMPLOYER;
  const bpjsTkJkkEmployer = grossSalary * BPJS_TK_JKK_EMPLOYER;
  const bpjsTkJkmEmployer = grossSalary * BPJS_TK_JKM_EMPLOYER;

  const totalBpjsEmployee = bpjsKesEmployee + bpjsTkJhtEmployee + bpjsTkJpEmployee;

  // PPh 21
  const monthlyPTKP = getPTKP(e.marital_status || 'TK', e.dependents || 0);
  const taxableMonthly = Math.max(0, grossSalary - totalBpjsEmployee - monthlyPTKP);
  const pph21 = calculatePPh21(taxableMonthly * 12);

  const totalDeductions = totalBpjsEmployee + pph21 + parseFloat(deductions.rows[0].total);
  const netSalary = grossSalary - totalDeductions;

  return {
    employee_id: employeeId,
    month, year,
    basic_salary: basicSalary,
    allowance_total: allowanceTotal,
    overtime_pay: overtimePay,
    absent_deduction: absentDeduction,
    gross_salary: grossSalary,
    bpjs_kes_employee: bpjsKesEmployee,
    bpjs_kes_employer: bpjsKesEmployer,
    bpjs_tk_jht_employee: bpjsTkJhtEmployee,
    bpjs_tk_jht_employer: bpjsTkJhtEmployer,
    bpjs_tk_jp_employee: bpjsTkJpEmployee,
    bpjs_tk_jp_employer: bpjsTkJpEmployer,
    bpjs_tk_jkk_employer: bpjsTkJkkEmployer,
    bpjs_tk_jkm_employer: bpjsTkJkmEmployer,
    total_bpjs_employee: totalBpjsEmployee,
    pph21: pph21,
    other_deductions: parseFloat(deductions.rows[0].total),
    total_deductions: totalDeductions,
    net_salary: netSalary,
    present_days: parseInt(e.present_days),
    absent_days: parseInt(e.absent_days),
    leave_days: parseInt(e.leave_days),
    overtime_hours: parseFloat(e.overtime_hours)
  };
};

const getPayrollList = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { month, year, status } = req.query;

    let conds = [], vals = [], idx = 1;
    if (month) { conds.push(`pr.month = $${idx}`); vals.push(month); idx++; }
    if (year) { conds.push(`pr.year = $${idx}`); vals.push(year); idx++; }
    if (status) { conds.push(`pr.status = $${idx}`); vals.push(status); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM payroll_runs pr ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT pr.*, u.full_name as created_by_name,
              COUNT(pd.id) as employee_count,
              COALESCE(SUM(pd.gross_salary), 0) as total_gross_salary,
              COALESCE(SUM(pd.total_deductions), 0) as total_deductions,
              COALESCE(SUM(pd.net_salary), 0) as total_net_salary,
              COALESCE(SUM(pd.absent_deduction), 0) as total_absent_deduction,
              COALESCE(SUM(pd.pph21), 0) as total_pph21,
              COALESCE(SUM(pd.total_bpjs_employee), 0) as total_bpjs
       FROM payroll_runs pr
       LEFT JOIN payroll_details pd ON pr.id = pd.payroll_run_id
       LEFT JOIN users u ON pr.created_by = u.id
       ${where}
       GROUP BY pr.id, u.full_name
       ORDER BY pr.year DESC, pr.month DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createPayrollRun = async (req, res, next) => {
  try {
    const { month, year, department_id } = req.body;
    if (!month || !year) return errorResponse(res, 'Bulan dan tahun wajib', 400);

    // Check if already exists
    const existing = await query(
      'SELECT id FROM payroll_runs WHERE month = $1 AND year = $2 AND status != $3',
      [month, year, 'CANCELLED']
    );
    if (existing.rows.length) return errorResponse(res, 'Payroll untuk periode ini sudah ada', 409);

    let empQuery = 'SELECT id FROM employees WHERE employment_status = $1';
    let empVals = ['ACTIVE'];
    if (department_id) { empQuery += ' AND department_id = $2'; empVals.push(department_id); }

    const employees = await query(empQuery, empVals);
    if (!employees.rows.length) return errorResponse(res, 'Tidak ada karyawan aktif', 400);

    const result = await transaction(async (client) => {
      const run = await client.query(
        `INSERT INTO payroll_runs (month, year, status, created_by)
         VALUES ($1,$2,'DRAFT',$3) RETURNING *`,
        [month, year, req.user.id]
      );

      let totalGross = 0, totalNet = 0;
      for (const emp of employees.rows) {
        try {
          const calc = await calculateEmployeePayroll(emp.id, month, year);
          await client.query(
            `INSERT INTO payroll_details (payroll_run_id, employee_id, basic_salary, allowance_total,
              overtime_pay, absent_deduction, gross_salary, bpjs_kes_employee, bpjs_tk_jht_employee,
              bpjs_tk_jp_employee, total_bpjs_employee, pph21, other_deductions, total_deductions,
              net_salary, present_days, absent_days, overtime_hours)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [run.rows[0].id, emp.id, calc.basic_salary, calc.allowance_total,
             calc.overtime_pay, calc.absent_deduction, calc.gross_salary,
             calc.bpjs_kes_employee, calc.bpjs_tk_jht_employee, calc.bpjs_tk_jp_employee,
             calc.total_bpjs_employee, calc.pph21, calc.other_deductions, calc.total_deductions,
             calc.net_salary, calc.present_days, calc.absent_days, calc.overtime_hours]
          );
          totalGross += calc.gross_salary;
          totalNet += calc.net_salary;
        } catch (e) {
          console.error(`Payroll calc error for emp ${emp.id}:`, e.message);
        }
      }

      await client.query(
        'UPDATE payroll_runs SET total_gross=$1, total_net=$2 WHERE id=$3',
        [totalGross, totalNet, run.rows[0].id]
      );
      return run.rows[0];
    });

    await logActivity({
      userId: req.user.id, module: 'PAYROLL', action: 'CREATE_PAYROLL_RUN',
      description: `Payroll dibuat untuk ${month}/${year}: ${employees.rows.length} karyawan`,
      entityId: result.id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, result, 'Payroll berhasil dihitung', 201);
  } catch (err) { next(err); }
};

const approvePayroll = async (req, res, next) => {
  try {
    const { id } = req.params;
    const run = await query('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run.rows.length) return errorResponse(res, 'Payroll tidak ditemukan', 404);
    if (run.rows[0].status !== 'DRAFT') return errorResponse(res, 'Hanya payroll DRAFT yang bisa disetujui', 400);

    await query(
      'UPDATE payroll_runs SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3',
      ['APPROVED', req.user.id, id]
    );

    await logActivity({
      userId: req.user.id, module: 'PAYROLL', action: 'APPROVE_PAYROLL',
      description: `Payroll ${run.rows[0].month}/${run.rows[0].year} disetujui`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Payroll disetujui');
  } catch (err) { next(err); }
};

const processPayroll = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { payment_date } = req.body;

    const run = await query('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run.rows.length) return errorResponse(res, 'Payroll tidak ditemukan', 404);
    if (run.rows[0].status !== 'APPROVED') return errorResponse(res, 'Payroll belum disetujui', 400);

    await transaction(async (client) => {
      await client.query(
        'UPDATE payroll_runs SET status=$1, payment_date=$2, processed_by=$3 WHERE id=$4',
        ['PROCESSED', payment_date, req.user.id, id]
      );

      // Auto journal: Debit Beban Gaji (6100), Kredit Kas (1100)
      const jeRes = await client.query(
        `INSERT INTO journal_entries (entry_date, reference_number, description, type, total_amount, status, created_by)
         VALUES ($1,$2,$3,'EXPENSE',$4,'POSTED',$5) RETURNING id`,
        [payment_date, `PAYROLL-${run.rows[0].month}-${run.rows[0].year}`,
         `Gaji karyawan ${run.rows[0].month}/${run.rows[0].year}`,
         run.rows[0].total_net, req.user.id]
      );
      const jeId = jeRes.rows[0].id;
      const amt = run.rows[0].total_net;
      const bebanGaji = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '6100' LIMIT 1`);
      const kas = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '1100' LIMIT 1`);
      if (bebanGaji.rows.length && kas.rows.length) {
        const bebanId = bebanGaji.rows[0].id;
        const kasId = kas.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,$4,0,1)`,
          [jeId, bebanId, 'Beban gaji karyawan', amt]
        );
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, description, debit, credit, line_order) VALUES ($1,$2,$3,0,$4,2)`,
          [jeId, kasId, 'Pembayaran gaji', amt]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [bebanId, jeId, payment_date, amt]
        );
        await client.query(
          `INSERT INTO general_ledger (account_id, journal_entry_id, entry_date, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [kasId, jeId, payment_date, amt]
        );
      }
    });

    await logActivity({
      userId: req.user.id, module: 'PAYROLL', action: 'PROCESS_PAYROLL',
      description: `Gaji diproses untuk ${run.rows[0].month}/${run.rows[0].year}. Total: Rp ${run.rows[0].total_net}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Gaji berhasil diproses dan jurnal dibuat');
  } catch (err) { next(err); }
};

const getPayslip = async (req, res, next) => {
  try {
    const { employee_id, payroll_run_id } = req.query;

    const result = await query(`
      SELECT pd.*, e.full_name, e.employee_number, e.bank_name, e.bank_account,
             d.name as department_name, p.title as position_title,
             pr.month, pr.year, pr.payment_date,
             cp.name as company_name, cp.address as company_address
      FROM payroll_details pd
      JOIN employees e ON pd.employee_id = e.id
      JOIN payroll_runs pr ON pd.payroll_run_id = pr.id
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN positions p ON e.position_id = p.id
      CROSS JOIN company_profile cp
      WHERE pd.employee_id = $1 AND pd.payroll_run_id = $2
    `, [employee_id, payroll_run_id]);

    if (!result.rows.length) return errorResponse(res, 'Slip gaji tidak ditemukan', 404);

    // Get allowance details
    const allowances = await query(
      'SELECT * FROM employee_allowances WHERE employee_id = $1 AND is_active = true', [employee_id]
    );

    return successResponse(res, { ...result.rows[0], allowances: allowances.rows });
  } catch (err) { next(err); }
};

// deletePayrollRun
const deletePayrollRun = async (req, res, next) => {
  try {
    const { id } = req.params;
    const run = await query('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run.rows.length) return errorResponse(res, 'Payroll tidak ditemukan', 404);
    if (run.rows[0].status === 'PROCESSED') {
      return errorResponse(res, 'Payroll yang sudah diproses tidak bisa dihapus', 400);
    }
    await query('DELETE FROM payroll_details WHERE payroll_run_id = $1', [id]);
    await query('DELETE FROM payroll_runs WHERE id = $1', [id]);
    await logActivity({
      userId: req.user.id, module: 'PAYROLL', action: 'DELETE_PAYROLL_RUN',
      description: `Payroll ${run.rows[0].month}/${run.rows[0].year} dihapus`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });
    return successResponse(res, null, 'Payroll berhasil dihapus');
  } catch (err) { next(err); }
};
module.exports = { getPayrollList, createPayrollRun, approvePayroll, processPayroll, getPayslip, deletePayrollRun };
