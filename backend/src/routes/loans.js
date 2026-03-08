const express = require('express');
const { getLoans, getMemberLoans, createLoan, updateLoan, deleteLoan, addRepayment, getRepayments } = require('../controllers/loans');
const authenticate = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', getLoans);
router.get('/member/:memberId', getMemberLoans);
router.post('/', createLoan);
router.put('/:id', updateLoan);
router.delete('/:id', deleteLoan);
router.get('/:id/repayments', getRepayments);
router.post('/:id/repayment', addRepayment);

module.exports = router;
