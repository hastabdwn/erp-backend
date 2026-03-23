// invoiceRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/invoiceController');

router.get('/', ctrl.getInvoices);
router.get('/:id', ctrl.getInvoiceById);
router.post('/', ctrl.createInvoice);
router.post('/:id/send', ctrl.sendInvoice);
router.post('/:id/payment', ctrl.recordPayment);

module.exports = router;
