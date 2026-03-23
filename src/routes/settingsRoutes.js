const express = require('express');
const router = express.Router();
const { authorize } = require('../middlewares/auth');
const ctrl = require('../controllers/settingsController');

// Company profile
router.get('/company', ctrl.getCompanyProfile);
router.put('/company', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.updateCompanyProfile);

// Preferences
router.get('/preferences', ctrl.getPreferences);
router.put('/preferences', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.updatePreferences);

// Users
router.get('/users', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.getUsers);
router.post('/users', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.createUser);
router.put('/users/:id', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.updateUser);
router.patch('/users/:id/reset-password', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.resetUserPassword);

// Chart of Accounts
router.get('/accounts', ctrl.getChartOfAccounts);
router.post('/accounts', authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE'), ctrl.createAccount);

// Departments
router.get('/departments', ctrl.getDepartments);
router.post('/departments', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.createDepartment);

module.exports = router;
