const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { generateTokens, verifyRefreshToken } = require('../config/jwt');
const { logActivity } = require('../middlewares/activityLog');
const { successResponse, errorResponse } = require('../utils/response');

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return errorResponse(res, 'Username dan password wajib diisi', 400);
    }

    const result = await query(
      `SELECT u.*, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE (u.username = $1 OR u.email = $1) AND u.is_active = true`,
      [username]
    );

    if (result.rows.length === 0) {
      await logActivity({
        module: 'AUTH', action: 'LOGIN_FAILED',
        description: `Login gagal untuk username: ${username}`,
        ipAddress: req.ip, level: 'WARNING'
      });
      return errorResponse(res, 'Username atau password salah', 401);
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      await logActivity({
        userId: user.id, module: 'AUTH', action: 'LOGIN_FAILED',
        description: `Password salah untuk user: ${username}`,
        ipAddress: req.ip, level: 'WARNING'
      });
      return errorResponse(res, 'Username atau password salah', 401);
    }

    const tokens = generateTokens({ userId: user.id, role: user.role });

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    await logActivity({
      userId: user.id, module: 'AUTH', action: 'LOGIN',
      description: `User ${user.username} berhasil login`,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], level: 'INFO'
    });

    const { password_hash, ...userSafe } = user;
    return successResponse(res, { user: userSafe, ...tokens }, 'Login berhasil');
  } catch (err) {
    next(err);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return errorResponse(res, 'Refresh token diperlukan', 400);

    const decoded = verifyRefreshToken(token);
    const result = await query(
      'SELECT id, username, role, is_active FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (!result.rows.length) return errorResponse(res, 'User tidak valid', 401);

    const tokens = generateTokens({ userId: decoded.userId, role: decoded.role });
    return successResponse(res, tokens, 'Token berhasil diperbarui');
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Refresh token expired, silakan login ulang', 401);
    }
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    await logActivity({
      userId: req.user.id, module: 'AUTH', action: 'LOGOUT',
      description: `User ${req.user.username} logout`,
      ipAddress: req.ip, level: 'INFO'
    });
    return successResponse(res, null, 'Logout berhasil');
  } catch (err) {
    next(err);
  }
};

const getProfile = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.phone,
              u.avatar_url, u.last_login, u.created_at, d.name as department_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    return successResponse(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return errorResponse(res, 'Password lama dan baru wajib diisi', 400);
    }
    if (newPassword.length < 8) {
      return errorResponse(res, 'Password baru minimal 8 karakter', 400);
    }

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isMatch) return errorResponse(res, 'Password lama salah', 400);

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);

    await logActivity({
      userId: req.user.id, module: 'AUTH', action: 'CHANGE_PASSWORD',
      description: `User ${req.user.username} mengubah password`,
      ipAddress: req.ip, level: 'WARNING'
    });

    return successResponse(res, null, 'Password berhasil diubah');
  } catch (err) {
    next(err);
  }
};

module.exports = { login, refreshToken, logout, getProfile, changePassword };
