const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/payrollController');
const { authorize } = require('../middlewares/auth');

router.get('/', ctrl.getPayrollList);
// PENTING: route statis /payslip harus sebelum route dinamis /:id
router.get('/payslip', ctrl.getPayslip);
router.post('/', authorize('SUPER_ADMIN', 'ADMIN', 'HR', 'FINANCE'), ctrl.createPayrollRun);
router.post('/:id/approve', authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE'), ctrl.approvePayroll);
router.post('/:id/process', authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE'), ctrl.processPayroll);
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.deletePayrollRun);

module.exports = router;
