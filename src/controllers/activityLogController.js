const { query } = require('../config/database');
const { successResponse, errorResponse, paginatedResponse, getPaginationParams } = require('../utils/response');

const getActivityLogs = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { module, action, level, user_id, start_date, end_date, search } = req.query;

    let conds = [], vals = [], idx = 1;
    if (module) { conds.push(`al.module = $${idx}`); vals.push(module); idx++; }
    if (action) { conds.push(`al.action ILIKE $${idx}`); vals.push(`%${action}%`); idx++; }
    if (level) { conds.push(`al.level = $${idx}`); vals.push(level); idx++; }
    if (user_id) { conds.push(`al.user_id = $${idx}`); vals.push(user_id); idx++; }
    if (start_date) { conds.push(`al.created_at >= $${idx}`); vals.push(start_date); idx++; }
    if (end_date) { conds.push(`al.created_at <= $${idx}`); vals.push(end_date + ' 23:59:59'); idx++; }
    if (search) { conds.push(`al.description ILIKE $${idx}`); vals.push(`%${search}%`); idx++; }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = parseInt((await query(`SELECT COUNT(*) FROM activity_logs al ${where}`, vals)).rows[0].count);

    const result = await query(
      `SELECT al.id, al.module, al.action, al.description, al.level,
              al.entity_type, al.entity_id, al.ip_address,
              al.created_at, u.full_name as user_name, u.username
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset]
    );

    return paginatedResponse(res, result.rows, total, page, limit);
  } catch (err) { next(err); }
};

const getActivityLogById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT al.*, u.full_name as user_name, u.username, u.email as user_email
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.id = $1
    `, [id]);

    if (!result.rows.length) return errorResponse(res, 'Log tidak ditemukan', 404);
    return successResponse(res, result.rows[0]);
  } catch (err) { next(err); }
};

const getLogStats = async (req, res, next) => {
  try {
    const { days = 7 } = req.query;

    const [byModule, byLevel, byUser, timeline] = await Promise.all([
      query(`
        SELECT module, COUNT(*) as count
        FROM activity_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY module ORDER BY count DESC
      `),
      query(`
        SELECT level, COUNT(*) as count
        FROM activity_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY level
      `),
      query(`
        SELECT u.full_name, u.username, COUNT(al.id) as action_count
        FROM activity_logs al
        JOIN users u ON al.user_id = u.id
        WHERE al.created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY u.id, u.full_name, u.username
        ORDER BY action_count DESC LIMIT 10
      `),
      query(`
        SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as count
        FROM activity_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date
      `)
    ]);

    return successResponse(res, {
      by_module: byModule.rows,
      by_level: byLevel.rows,
      top_users: byUser.rows,
      timeline: timeline.rows
    });
  } catch (err) { next(err); }
};

module.exports = { getActivityLogs, getActivityLogById, getLogStats };
