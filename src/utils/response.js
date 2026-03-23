const successResponse = (res, data, message = 'Berhasil', statusCode = 200, meta = null) => {
  const response = { success: true, message };
  if (meta) response.meta = meta;
  if (data !== null && data !== undefined) response.data = data;
  return res.status(statusCode).json(response);
};

const errorResponse = (res, message = 'Terjadi kesalahan', statusCode = 500, errors = null) => {
  const response = { success: false, message };
  if (errors) response.errors = errors;
  return res.status(statusCode).json(response);
};

const paginatedResponse = (res, data, total, page, limit, message = 'Berhasil') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  });
};

const getPaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const buildWhereClause = (filters, startIdx = 1) => {
  const conditions = [];
  const values = [];
  let idx = startIdx;

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'string' && value.includes('%')) {
        conditions.push(`${key} ILIKE $${idx}`);
      } else {
        conditions.push(`${key} = $${idx}`);
      }
      values.push(value);
      idx++;
    }
  }

  return {
    where: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
    values,
    nextIdx: idx
  };
};

module.exports = { successResponse, errorResponse, paginatedResponse, getPaginationParams, buildWhereClause };
