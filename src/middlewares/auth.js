const { verifyAccessToken } = require('../config/jwt');
const { query } = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    // Verify user still exists and is active
    const result = await query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User tidak ditemukan atau tidak aktif' });
    }

    req.user = result.rows[0];
    req.userId = decoded.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
};

// Role-based access control
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Akses ditolak. Role ${req.user.role} tidak memiliki izin untuk aksi ini.`
      });
    }
    next();
  };
};

// Permission-based access (module-level)
const hasPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const result = await query(
        `SELECT 1 FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.id
         WHERE rp.role = $1 AND p.module = $2 AND p.action = $3`,
        [req.user.role, module, action]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: `Tidak ada izin untuk ${action} di modul ${module}`
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { authenticate, authorize, hasPermission };
