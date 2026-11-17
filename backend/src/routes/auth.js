const express = require('express');
const { login, getMe, requestPasswordReset, resetPassword } = require('../controllers/auth');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);

module.exports = router;
