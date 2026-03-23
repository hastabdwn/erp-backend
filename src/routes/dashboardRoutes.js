const express = require('express');
const router = express.Router();
const { getSummary, getFinancialWidget, getSalesWidget, getInventoryWidget } = require('../controllers/dashboardController');

router.get('/', getSummary);
router.get('/widgets/financial', getFinancialWidget);
router.get('/widgets/sales', getSalesWidget);
router.get('/widgets/inventory', getInventoryWidget);

module.exports = router;
