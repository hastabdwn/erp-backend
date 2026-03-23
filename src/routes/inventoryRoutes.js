const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventoryController');

router.get('/products', ctrl.getProducts);
router.get('/products/low-stock', ctrl.getLowStockAlerts);
router.get('/products/:id', ctrl.getProductById);
router.post('/products', ctrl.createProduct);
router.put('/products/:id', ctrl.updateProduct);
router.delete('/products/:id', ctrl.deleteProduct);
router.post('/products/:id/adjust-stock', ctrl.adjustStock);
router.get('/movements', ctrl.getStockMovements);

module.exports = router;
