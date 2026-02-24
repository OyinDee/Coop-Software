const express = require('express');
const { getTransactions, getMemberTransactions, getMonthlyReport } = require('../controllers/transactions');
const authenticate = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', getTransactions);
router.get('/member/:memberId', getMemberTransactions);
router.get('/monthly-report', getMonthlyReport);

module.exports = router;
