const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/database');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

// === COMPANY PROFILE ===
const getCompanyProfile = async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM company_profile LIMIT 1');
    return successResponse(res, result.rows[0] || {});
  } catch (err) { next(err); }
};

const updateCompanyProfile = async (req, res, next) => {
  try {
    const {
      name, npwp, address, city, province, postal_code,
      phone, email, website, logo_url, tax_number,
      bank_name, bank_account, bank_account_name
    } = req.body;

    const existing = await query('SELECT id FROM company_profile LIMIT 1');
    let result;

    if (existing.rows.length > 0) {
      result = await query(
        `UPDATE company_profile SET
          name=$1, npwp=$2, address=$3, city=$4, province=$5, postal_code=$6,
          phone=$7, email=$8, website=$9, logo_url=$10, tax_number=$11,
          bank_name=$12, bank_account=$13, bank_account_name=$14, updated_at=NOW()
         WHERE id=$15 RETURNING *`,
        [name, npwp, address, city, province, postal_code,
         phone, email, website, logo_url, tax_number,
         bank_name, bank_account, bank_account_name, existing.rows[0].id]
      );
    } else {
      result = await query(
        `INSERT INTO company_profile (name, npwp, address, city, province, postal_code, phone, email, website, logo_url, tax_number, bank_name, bank_account, bank_account_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [name, npwp, address, city, province, postal_code,
         phone, email, website, logo_url, tax_number,
         bank_name, bank_account, bank_account_name]
      );
    }

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'UPDATE_COMPANY_PROFILE',
      description: 'Profil perusahaan diperbarui', newData: req.body,
      ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, result.rows[0], 'Profil perusahaan berhasil diperbarui');
  } catch (err) { next(err); }
};

// === GLOBAL PREFERENCES ===
const getPreferences = async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM system_preferences');
    const prefs = {};
    result.rows.forEach(row => { prefs[row.key] = row.value; });
    return successResponse(res, prefs);
  } catch (err) { next(err); }
};

const updatePreferences = async (req, res, next) => {
  try {
    const updates = req.body; // { key: value, ... }
    const entries = Object.entries(updates);

    await transaction(async (client) => {
      for (const [key, value] of entries) {
        await client.query(
          `INSERT INTO system_preferences (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, String(value)]
        );
      }
    });

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'UPDATE_PREFERENCES',
      description: `Preferensi sistem diperbarui: ${Object.keys(updates).join(', ')}`,
      ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Preferensi berhasil diperbarui');
  } catch (err) { next(err); }
};

// === USER MANAGEMENT ===
const getUsers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { search, role, is_active } = req.query;

    let whereConditions = [];
    let values = [];
    let idx = 1;

    if (search) {
      whereConditions.push(`(u.username ILIKE $${idx} OR u.email ILIKE $${idx} OR u.full_name ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }
    if (role) { whereConditions.push(`u.role = $${idx}`); values.push(role); idx++; }
    if (is_active !== undefined) { whereConditions.push(`u.is_active = $${idx}`); values.push(is_active === 'true'); idx++; }

    const where = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countResult = await query(`SELECT COUNT(*) FROM users u ${where}`, values);
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.phone,
              u.is_active, u.last_login, u.created_at, d.name as department_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const createUser = async (req, res, next) => {
  try {
    const { username, email, password, full_name, role, phone, department_id } = req.body;

    if (!username || !email || !password || !full_name || !role) {
      return errorResponse(res, 'Field wajib: username, email, password, full_name, role', 400);
    }
    if (password.length < 8) {
      return errorResponse(res, 'Password minimal 8 karakter', 400);
    }

    const existing = await query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existing.rows.length > 0) {
      return errorResponse(res, 'Username atau email sudah digunakan', 409);
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role, phone, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username, email, full_name, role, is_active, created_at`,
      [username, email, hash, full_name, role, phone, department_id]
    );

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'CREATE_USER',
      description: `User baru dibuat: ${username} (${role})`,
      entityId: result.rows[0].id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, result.rows[0], 'User berhasil dibuat', 201);
  } catch (err) { next(err); }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { full_name, email, role, phone, department_id, is_active } = req.body;

    const result = await query(
      `UPDATE users SET full_name=$1, email=$2, role=$3, phone=$4, department_id=$5, is_active=$6, updated_at=NOW()
       WHERE id=$7 RETURNING id, username, email, full_name, role, is_active`,
      [full_name, email, role, phone, department_id, is_active, id]
    );

    if (!result.rows.length) return errorResponse(res, 'User tidak ditemukan', 404);

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'UPDATE_USER',
      description: `User diperbarui: ${result.rows[0].username}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, result.rows[0], 'User berhasil diperbarui');
  } catch (err) { next(err); }
};

const resetUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return errorResponse(res, 'Password baru minimal 8 karakter', 400);
    }

    const hash = await bcrypt.hash(newPassword, 12);
    const result = await query(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 RETURNING username',
      [hash, id]
    );

    if (!result.rows.length) return errorResponse(res, 'User tidak ditemukan', 404);

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'RESET_PASSWORD',
      description: `Password direset untuk user: ${result.rows[0].username}`,
      entityId: id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Password berhasil direset');
  } catch (err) { next(err); }
};

// === CHART OF ACCOUNTS ===
const getChartOfAccounts = async (req, res, next) => {
  try {
    const { type, search } = req.query;
    let where = 'WHERE 1=1';
    const values = [];
    let idx = 1;

    if (type) { where += ` AND account_type = $${idx}`; values.push(type); idx++; }
    if (search) { where += ` AND (code ILIKE $${idx} OR name ILIKE $${idx})`; values.push(`%${search}%`); idx++; }

    const result = await query(
      `SELECT * FROM chart_of_accounts ${where} ORDER BY code ASC`,
      values
    );
    return successResponse(res, result.rows);
  } catch (err) { next(err); }
};

const createAccount = async (req, res, next) => {
  try {
    const { code, name, account_type, parent_id, description } = req.body;

    if (!code || !name || !account_type) {
      return errorResponse(res, 'Kode, nama, dan tipe akun wajib diisi', 400);
    }

    const result = await query(
      `INSERT INTO chart_of_accounts (code, name, account_type, parent_id, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name, account_type, parent_id, description]
    );

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'CREATE_ACCOUNT',
      description: `Akun baru dibuat: ${code} - ${name}`,
      entityId: result.rows[0].id, ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, result.rows[0], 'Akun berhasil dibuat', 201);
  } catch (err) { next(err); }
};

// === DEPARTMENTS ===
const getDepartments = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT d.*, COUNT(e.id) as employee_count
      FROM departments d
      LEFT JOIN employees e ON d.id = e.department_id AND e.employment_status = 'ACTIVE'
      GROUP BY d.id ORDER BY d.name
    `);
    return successResponse(res, result.rows);
  } catch (err) { next(err); }
};

const createDepartment = async (req, res, next) => {
  try {
    const { name, code, description, manager_id } = req.body;
    if (!name || !code) return errorResponse(res, 'Nama dan kode departemen wajib', 400);

    const result = await query(
      'INSERT INTO departments (name, code, description, manager_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, code, description, manager_id]
    );

    await logActivity({
      userId: req.user.id, module: 'SETTINGS', action: 'CREATE_DEPARTMENT',
      description: `Departemen baru: ${name}`, entityId: result.rows[0].id, ipAddress: req.ip
    });

    return successResponse(res, result.rows[0], 'Departemen berhasil dibuat', 201);
  } catch (err) { next(err); }
};

module.exports = {
  getCompanyProfile, updateCompanyProfile,
  getPreferences, updatePreferences,
  getUsers, createUser, updateUser, resetUserPassword,
  getChartOfAccounts, createAccount,
  getDepartments, createDepartment
};
