const express = require('express');
const multer  = require('multer');
const { getBalances, uploadBalances } = require('../controllers/balances');
const authenticate = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

router.get('/',             getBalances);
router.post('/upload', upload.single('file'), uploadBalances);

module.exports = router;
