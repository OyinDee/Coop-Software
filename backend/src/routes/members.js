const express = require('express');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const {
  getMembers,
  getMember,
  createMember,
  updateMember,
  deleteMember,
  importCSV,
  importBalances,
  getMemberLedger,
} = require('../controllers/members');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', getMembers);
router.get('/:id/ledger', getMemberLedger);
router.get('/:id', getMember);
router.post('/', createMember);
router.put('/:id', updateMember);
router.delete('/:id', deleteMember);
router.post('/import/csv', upload.single('file'), importCSV);
router.post('/import/balances', upload.single('file'), importBalances);

module.exports = router;
