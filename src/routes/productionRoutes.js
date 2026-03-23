const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/productionController');

router.get('/bom', ctrl.getBOMs);
router.get('/bom/:id', ctrl.getBOMById);
router.post('/bom', ctrl.createBOM);

router.get('/work-orders', ctrl.getWorkOrders);
router.post('/work-orders', ctrl.createWorkOrder);
router.post('/work-orders/:id/start', ctrl.startProduction);
router.post('/work-orders/:id/complete', ctrl.completeProduction);

module.exports = router;
