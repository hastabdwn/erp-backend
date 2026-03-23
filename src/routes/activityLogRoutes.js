const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/activityLogController');
const { authorize } = require('../middlewares/auth');

router.get('/', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.getActivityLogs);
router.get('/stats', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.getLogStats);
router.get('/:id', authorize('SUPER_ADMIN', 'ADMIN'), ctrl.getActivityLogById);

module.exports = router;
