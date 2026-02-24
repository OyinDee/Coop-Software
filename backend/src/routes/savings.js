const express = require('express');
const { getSavings, getMemberSavings, createSavings, updateSavings, deleteSavings } = require('../controllers/savings');
const authenticate = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', getSavings);
router.get('/member/:memberId', getMemberSavings);
router.post('/', createSavings);
router.put('/:id', updateSavings);
router.delete('/:id', deleteSavings);

module.exports = router;
