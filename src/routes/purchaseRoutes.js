const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/purchaseController');
const { authorize } = require('../middlewares/auth');

router.get('/requisitions', ctrl.getPurchaseRequisitions);
router.post('/requisitions', ctrl.createPurchaseRequisition);
router.patch('/requisitions/:id/approve', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), ctrl.approvePR);

router.get('/orders', ctrl.getPurchaseOrders);
router.get('/orders/:id', ctrl.getPurchaseOrderById);
router.post('/orders', ctrl.createPurchaseOrder);
router.patch('/orders/:id/approve', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FINANCE'), ctrl.approvePO);
router.post('/orders/:id/receive', ctrl.receiveGoods);

router.get('/suppliers', ctrl.getSuppliers);
router.post('/suppliers', ctrl.createSupplier);

module.exports = router;
