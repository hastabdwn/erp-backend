const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/hrController');
const { authorize } = require('../middlewares/auth');

router.get('/employees', ctrl.getEmployees);
router.get('/employees/:id', ctrl.getEmployeeById);
router.post('/employees', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), ctrl.createEmployee);
router.put('/employees/:id', authorize('SUPER_ADMIN', 'ADMIN', 'HR'), ctrl.updateEmployee);

router.get('/attendance', ctrl.getAttendance);
router.post('/attendance', ctrl.recordAttendance);

router.get('/leaves', ctrl.getLeaveRequests);
router.post('/leaves', ctrl.submitLeaveRequest);
router.patch('/leaves/:id/approve', authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'HR'), ctrl.approveLeave);

module.exports = router;
