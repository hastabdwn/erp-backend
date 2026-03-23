const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/salesController');

router.get('/customers', ctrl.getCustomers);
router.post('/customers', ctrl.createCustomer);
router.put('/customers/:id', ctrl.updateCustomer);

router.get('/orders', ctrl.getSalesOrders);
router.get('/orders/analytics', ctrl.getSalesAnalytics);
router.get('/orders/:id', ctrl.getSalesOrderById);
router.post('/orders', ctrl.createSalesOrder);
router.post('/orders/:id/confirm', ctrl.confirmSalesOrder);
router.post('/orders/:id/ship', ctrl.shipSalesOrder);
router.patch('/orders/:id/cancel', ctrl.cancelSalesOrder);

module.exports = router;
