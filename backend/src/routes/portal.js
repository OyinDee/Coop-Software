const express = require('express');
const authenticate = require('../middleware/auth');
const { getMyProfile, getMyMonthlyReport, changeMyPassword } = require('../controllers/portal');

const router = express.Router();

router.use(authenticate);

router.get('/me', getMyProfile);
router.get('/monthly', getMyMonthlyReport);
router.post('/change-password', changeMyPassword);

module.exports = router;
