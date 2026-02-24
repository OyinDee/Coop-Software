const express = require('express');
const { getCommodity, getMemberCommodity, createCommodity, updateCommodity, deleteCommodity } = require('../controllers/commodity');
const authenticate = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', getCommodity);
router.get('/member/:memberId', getMemberCommodity);
router.post('/', createCommodity);
router.put('/:id', updateCommodity);
router.delete('/:id', deleteCommodity);

module.exports = router;
