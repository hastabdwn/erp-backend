const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/financeController');
const { authorize } = require('../middlewares/auth');

router.get('/journals', ctrl.getJournalEntries);
router.get('/journals/:id', ctrl.getJournalEntryById);
router.post('/journals', ctrl.createJournalEntry);
router.post('/journals/:id/post', authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE'), ctrl.postJournalEntry);

router.get('/reports/income-statement', ctrl.getIncomeStatement);
router.get('/reports/balance-sheet', ctrl.getBalanceSheet);
router.get('/reports/bank-reconciliation', ctrl.getBankReconciliation);

module.exports = router;
