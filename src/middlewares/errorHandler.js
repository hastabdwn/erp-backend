const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Data sudah ada (duplicate)',
      field: err.detail
    });
  }
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Referensi data tidak valid (foreign key violation)'
    });
  }
  if (err.code === '23502') {
    return res.status(400).json({
      success: false,
      message: 'Field wajib tidak boleh kosong'
    });
  }

  // Joi validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validasi gagal',
      errors: err.details?.map(d => d.message)
    });
  }

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} tidak ditemukan`
  });
};

module.exports = { errorHandler, notFound };
