const express = require('express');
const {
  getSettings, updateSettings,
  getColumns, createColumn, updateColumn, deleteColumn,
} = require('../controllers/settings');
const authenticate = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', getSettings);
router.put('/', updateSettings);

// Balance column management
router.get('/columns',         getColumns);
router.post('/columns',        createColumn);
router.put('/columns/:key',    updateColumn);
router.delete('/columns/:key', deleteColumn);

module.exports = router;
