const express = require('express');
const authenticate = require('../middleware/auth');
const { getMyProfile, getMyMonthlyReport, downloadMyStatementPdf, changeMyPassword } = require('../controllers/portal');

const router = express.Router();

router.use(authenticate);

router.get('/me', getMyProfile);
router.get('/monthly', getMyMonthlyReport);
router.get('/statement.pdf', downloadMyStatementPdf);
router.post('/change-password', changeMyPassword);

module.exports = router;
