const express = require('express');
const multer  = require('multer');
const {
  getDeductions, upsertDeductions,
  uploadTransCSV, getTransColumns, updateTransColumn, generateNextMonth, patchMonthEntry,
} = require('../controllers/deductions');
const authenticate = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/columns',              getTransColumns);
router.put('/columns/:key',         updateTransColumn);
router.post('/upload',              upload.single('file'), uploadTransCSV);
router.post('/generate-next-month', generateNextMonth);
router.patch('/entry',              patchMonthEntry);   // update one member's month entry
router.get('/',                     getDeductions);
router.post('/',                    upsertDeductions);

module.exports = router;
