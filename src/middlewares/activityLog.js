const { query } = require('../config/database');

// Auto-log all write operations
const activityLogger = (module, action, getDescription) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async function (data) {
      // Only log successful write operations
      if (res.statusCode < 400 && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        try {
          const description = typeof getDescription === 'function'
            ? getDescription(req, data)
            : getDescription || `${action} pada modul ${module}`;

          await logActivity({
            userId: req.user?.id,
            module,
            action,
            description,
            entityType: module.toLowerCase(),
            entityId: data?.data?.id || req.params?.id || null,
            oldData: req.body?._oldData || null,
            newData: req.body || null,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            level: determineLevel(action, res.statusCode),
          });
        } catch (logErr) {
          console.error('Activity log error:', logErr.message);
        }
      }
      return originalJson(data);
    };

    next();
  };
};

const logActivity = async ({
  userId, module, action, description,
  entityType, entityId, oldData, newData,
  ipAddress, userAgent, level = 'INFO'
}) => {
  try {
    await query(
      `INSERT INTO activity_logs 
       (user_id, module, action, description, entity_type, entity_id, old_data, new_data, ip_address, user_agent, level, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        userId || null,
        module,
        action,
        description,
        entityType || null,
        entityId || null,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        ipAddress || null,
        userAgent || null,
        level
      ]
    );
  } catch (err) {
    console.error('Failed to write activity log:', err.message);
  }
};

const determineLevel = (action, statusCode) => {
  if (statusCode >= 400) return 'ERROR';
  if (action.includes('DELETE') || action.includes('HAPUS')) return 'WARNING';
  if (action.includes('LOGIN') || action.includes('LOGOUT')) return 'INFO';
  if (action.includes('SETTING') || action.includes('CONFIG')) return 'WARNING';
  return 'INFO';
};

module.exports = { activityLogger, logActivity };
