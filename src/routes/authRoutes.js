const express = require('express');
const router = express.Router();
const { login, refreshToken, logout, getProfile, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');

router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/logout', authenticate, logout);
router.get('/profile', authenticate, getProfile);
router.patch('/change-password', authenticate, changePassword);

module.exports = router;
