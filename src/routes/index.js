const express = require('express');
const router = express.Router();

const { authenticate, authorize } = require('../middlewares/auth');

// Public routes
router.use('/auth', require('./authRoutes'));

// Protected routes
router.use('/dashboard', authenticate, require('./dashboardRoutes'));
router.use('/settings', authenticate, require('./settingsRoutes'));
router.use('/finance', authenticate, require('./financeRoutes'));
router.use('/invoices', authenticate, require('./invoiceRoutes'));
router.use('/inventory', authenticate, require('./inventoryRoutes'));
router.use('/purchases', authenticate, require('./purchaseRoutes'));
router.use('/sales', authenticate, require('./salesRoutes'));
router.use('/production', authenticate, require('./productionRoutes'));
router.use('/hr', authenticate, require('./hrRoutes'));
router.use('/payroll', authenticate, require('./payrollRoutes'));
router.use('/activity-logs', authenticate, require('./activityLogRoutes'));

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '1.0.0' });
});

module.exports = router;
