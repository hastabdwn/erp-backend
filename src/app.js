require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || (process.env.NODE_ENV === 'production' ? 300 : 2000),
  message: { success: false, message: 'Terlalu banyak request. Coba lagi nanti.' },
  skip: () => process.env.NODE_ENV === 'development',
});
app.use('/api/', limiter);

// Auth rate limiter (stricter) — berlaku untuk semua endpoint auth sensitif
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: { success: false, message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' }
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/refresh-token', authLimiter);
app.use('/api/v1/auth/change-password', authLimiter);

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy
app.set('trust proxy', 1);

// Routes
app.use('/api/v1', routes);

// API v1 root info
app.get('/api/v1', (req, res) => {
  res.json({
    name: 'ERP System API',
    version: '1.0.0',
    status: 'running',
    health: '/api/v1/health',
    endpoints: {
      auth:         '/api/v1/auth',
      dashboard:    '/api/v1/dashboard',
      settings:     '/api/v1/settings',
      finance:      '/api/v1/finance',
      invoices:     '/api/v1/invoices',
      inventory:    '/api/v1/inventory',
      purchases:    '/api/v1/purchases',
      sales:        '/api/v1/sales',
      production:   '/api/v1/production',
      hr:           '/api/v1/hr',
      payroll:      '/api/v1/payroll',
      activityLogs: '/api/v1/activity-logs',
    }
  });
});

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'ERP System API',
    version: '1.0.0',
    docs: '/api/v1/health',
    modules: [
      'auth', 'dashboard', 'settings', 'finance', 'invoices',
      'inventory', 'purchases', 'sales', 'production',
      'hr', 'payroll', 'activity-logs'
    ]
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 ERP Backend Server running on port ${PORT}
📋 Environment: ${process.env.NODE_ENV || 'development'}
🔗 Base URL: http://localhost:${PORT}/api/v1
📦 Modules: Settings, Finance, Invoice, Inventory, Purchase, Sales, Production, HR, Payroll, Activity Log
  `);
});

module.exports = app;
