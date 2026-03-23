const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

// Employees
const getEmployees = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, department_id, search } = req.query;

    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`e.employment_status = $${idx}`); vals.push(status); idx++; }
    if (department_id) { conds.push(`e.department_id = $${idx}`); vals.push(department_id); idx++; }
    if (search) {
      conds.push(`(e.employee_number ILIKE $${idx} OR e.full_name ILIKE $${idx} OR e.email ILIKE $${idx})`);
      vals.push(`%${search}%`); idx++;
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM employees e ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT e.*, d.name as department_name, p.title as position_title
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       ${where}
       ORDER BY e.full_name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getEmployeeById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const emp = await query(
      `SELECT e.*, d.name as department_name, p.title as position_title
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       WHERE e.id = $1`, [id]
    );

    if (!emp.rows.length) return errorResponse(res, 'Karyawan tidak ditemukan', 404);

    const [attendance, leaves] = await Promise.all([
      query(`SELECT * FROM attendance WHERE employee_id = $1 ORDER BY date DESC LIMIT 30`, [id]),
      query(`SELECT * FROM leave_requests WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 10`, [id])
    ]);

    return successResponse(res, { ...emp.rows[0], recent_attendance: attendance.rows, recent_leaves: leaves.rows });
  } catch (err) { next(err); }
};

const createEmployee = async (req, res, next) => {
  try {
    const {
      employee_number, full_name, email, phone, nik, gender, birth_date,
      address, department_id, position_id, hire_date, employment_status,
      employment_type, basic_salary, bank_name, bank_account, npwp, bpjs_kes, bpjs_tk,
      marital_status, dependents
    } = req.body;

    if (!employee_number || !full_name || !hire_date) {
      return errorResponse(res, 'Nomor karyawan, nama, dan tanggal masuk wajib', 400);
    }

    const existing = await query('SELECT id FROM employees WHERE employee_number = $1 OR email = $2', [employee_number, email]);
    if (existing.rows.length) return errorResponse(res, 'Nomor karyawan atau email sudah ada', 409);

    const result = await query(
      `INSERT INTO employees (employee_number, full_name, email, phone, nik, gender, birth_date,
        address, department_id, position_id, hire_date, employment_status, employment_type,
        basic_salary, bank_name, bank_account, npwp, bpjs_kes, bpjs_tk,
        marital_status, dependents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [employee_number, full_name, email, phone, nik, gender, birth_date,
       address, department_id, position_id, hire_date,
       employment_status || 'PROBATION', employment_type || 'FULL_TIME',
       basic_salary, bank_name, bank_account, npwp, bpjs_kes, bpjs_tk,
       marital_status || 'TK', dependents || 0]
    );

    await logActivity({
      userId: req.user.id, module: 'HR', action: 'CREATE_EMPLOYEE',
      description: `Karyawan baru: ${full_name} (${employee_number})`,
      entityId: result.rows[0].id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Karyawan berhasil ditambahkan', 201);
  } catch (err) { next(err); }
};

// Attendance
const recordAttendance = async (req, res, next) => {
  try {
    const { employee_id, date, check_in, check_out, status, notes, overtime_hours } = req.body;
    if (!employee_id || !date) return errorResponse(res, 'employee_id dan date wajib', 400);

    const result = await query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, notes, overtime_hours, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
         status = EXCLUDED.status, notes = EXCLUDED.notes, overtime_hours = EXCLUDED.overtime_hours
       RETURNING *`,
      [employee_id, date, check_in, check_out, status || 'PRESENT', notes, overtime_hours || 0, req.user.id]
    );

    return successResponse(res, result.rows[0], 'Absensi berhasil dicatat');
  } catch (err) { next(err); }
};

const getAttendance = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { employee_id, month, year, status } = req.query;

    let conds = [], vals = [], idx = 1;
    if (employee_id) { conds.push(`a.employee_id = $${idx}`); vals.push(employee_id); idx++; }
    if (month) { conds.push(`DATE_PART('month', a.date) = $${idx}`); vals.push(month); idx++; }
    if (year) { conds.push(`DATE_PART('year', a.date) = $${idx}`); vals.push(year); idx++; }
    if (status) { conds.push(`a.status = $${idx}`); vals.push(status); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM attendance a ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT a.*, e.full_name as employee_name, e.employee_number
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       ${where}
       ORDER BY a.date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

// Leave Management
const submitLeaveRequest = async (req, res, next) => {
  try {
    const { employee_id, leave_type, start_date, end_date, reason } = req.body;
    if (!employee_id || !leave_type || !start_date || !end_date) {
      return errorResponse(res, 'Data cuti tidak lengkap', 400);
    }

    const startD = new Date(start_date), endD = new Date(end_date);
    const days = Math.ceil((endD - startD) / (1000 * 60 * 60 * 24)) + 1;

    const result = await query(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING') RETURNING *`,
      [employee_id, leave_type, start_date, end_date, days, reason]
    );

    await logActivity({
      userId: req.user.id, module: 'HR', action: 'SUBMIT_LEAVE',
      description: `Pengajuan cuti ${leave_type} selama ${days} hari`,
      entityId: result.rows[0].id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Permohonan cuti berhasil diajukan', 201);
  } catch (err) { next(err); }
};

const approveLeave = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return errorResponse(res, 'Status harus APPROVED atau REJECTED', 400);
    }

    const result = await query(
      `UPDATE leave_requests SET status=$1, approved_by=$2, approval_notes=$3, approved_at=NOW()
       WHERE id=$4 AND status='PENDING' RETURNING *`,
      [status, req.user.id, notes, id]
    );

    if (!result.rows.length) return errorResponse(res, 'Permohonan tidak ditemukan', 404);

    if (status === 'APPROVED') {
      await query(
        `UPDATE employees SET leave_balance = leave_balance - $1 WHERE id = $2`,
        [result.rows[0].total_days, result.rows[0].employee_id]
      );
    }

    await logActivity({
      userId: req.user.id, module: 'HR', action: `${status}_LEAVE`,
      description: `Cuti ${status} oleh ${req.user.full_name}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, `Cuti berhasil ${status === 'APPROVED' ? 'disetujui' : 'ditolak'}`);
  } catch (err) { next(err); }
};

const getLeaveRequests = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { status, employee_id } = req.query;

    let conds = [], vals = [], idx = 1;
    if (status) { conds.push(`lr.status = $${idx}`); vals.push(status); idx++; }
    if (employee_id) { conds.push(`lr.employee_id = $${idx}`); vals.push(employee_id); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM leave_requests lr ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT lr.*, e.full_name as employee_name, e.employee_number,
              u.full_name as approver_name
       FROM leave_requests lr
       JOIN employees e ON lr.employee_id = e.id
       LEFT JOIN users u ON lr.approved_by = u.id
       ${where}
       ORDER BY lr.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const updateEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      full_name, email, phone, address, department_id, position_id,
      employment_status, employment_type, basic_salary, bank_name,
      bank_account, marital_status, dependents
    } = req.body;

    const existing = await query('SELECT id FROM employees WHERE id = $1', [id]);
    if (!existing.rows.length) return errorResponse(res, 'Karyawan tidak ditemukan', 404);

    // Cek duplikat email jika diubah
    if (email) {
      const dupEmail = await query('SELECT id FROM employees WHERE email = $1 AND id != $2', [email, id]);
      if (dupEmail.rows.length) return errorResponse(res, 'Email sudah digunakan karyawan lain', 409);
    }

    const result = await query(
      `UPDATE employees SET
        full_name = COALESCE($1, full_name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        address = COALESCE($4, address),
        department_id = COALESCE($5, department_id),
        position_id = COALESCE($6, position_id),
        employment_status = COALESCE($7, employment_status),
        employment_type = COALESCE($8, employment_type),
        basic_salary = COALESCE($9, basic_salary),
        bank_name = COALESCE($10, bank_name),
        bank_account = COALESCE($11, bank_account),
        marital_status = COALESCE($12, marital_status),
        dependents = COALESCE($13, dependents),
        updated_at = NOW()
       WHERE id = $14 RETURNING *`,
      [full_name, email, phone, address, department_id, position_id,
       employment_status, employment_type, basic_salary, bank_name,
       bank_account, marital_status, dependents, id]
    );

    await logActivity({
      userId: req.user.id, module: 'HR', action: 'UPDATE_EMPLOYEE',
      description: `Data karyawan diupdate: ${result.rows[0].full_name}`,
      entityId: id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Data karyawan berhasil diupdate');
  } catch (err) { next(err); }
};

module.exports = {
  getEmployees, getEmployeeById, createEmployee, updateEmployee,
  recordAttendance, getAttendance,
  submitLeaveRequest, approveLeave, getLeaveRequests
};
