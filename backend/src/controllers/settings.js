const db = require('../db');

async function getSettings(req, res) {
  try {
    const result = await db.query('SELECT key, value FROM app_settings');
    const settings = Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSettings(req, res) {
  const { loan_interest_rate, loan_penalty_rate } = req.body;
  try {
    if (loan_interest_rate !== undefined) {
      const rate = parseFloat(loan_interest_rate);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ error: 'Interest rate must be between 0 and 100' });
      }
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('loan_interest_rate', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [rate.toString()]
      );
    }
    
    if (loan_penalty_rate !== undefined) {
      const rate = parseFloat(loan_penalty_rate);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ error: 'Penalty rate must be between 0 and 100' });
      }
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('loan_penalty_rate', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [rate.toString()]
      );
    }
    
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Balance column management ─────────────────────────────────────────────────

async function getColumns(req, res) {
  try {
    const result = await db.query('SELECT * FROM balance_columns ORDER BY sort_order, id');
    res.json({ columns: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createColumn(req, res) {
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'Label is required' });

  // Derive a stable key: lowercase, spaces → underscores, strip non-alphanumeric
  const key = label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!key) return res.status(400).json({ error: 'Could not generate a valid key from that label' });

  try {
    const maxOrder = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS max FROM balance_columns');
    const sortOrder = parseInt(maxOrder.rows[0].max) + 1;

    const result = await db.query(`
      INSERT INTO balance_columns (key, label, type, enabled, sort_order)
      VALUES ($1, $2, 'custom', TRUE, $3)
      ON CONFLICT (key) DO NOTHING
      RETURNING *
    `, [key, label.trim(), sortOrder]);

    if (!result.rows[0]) return res.status(409).json({ error: 'A column with a similar name already exists' });
    res.status(201).json({ column: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateColumn(req, res) {
  const { key } = req.params;
  const { enabled, label } = req.body;

  const sets = [];
  const params = [];
  if (enabled !== undefined) { sets.push(`enabled = $${params.length + 1}`); params.push(enabled); }
  if (label  !== undefined) { sets.push(`label   = $${params.length + 1}`); params.push(label); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  try {
    params.push(key);
    const result = await db.query(
      `UPDATE balance_columns SET ${sets.join(', ')} WHERE key = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Column not found' });
    res.json({ column: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteColumn(req, res) {
  const { key } = req.params;
  try {
    const check = await db.query('SELECT type FROM balance_columns WHERE key = $1', [key]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Column not found' });
    if (check.rows[0].type === 'fixed') {
      return res.status(400).json({ error: 'Fixed columns cannot be deleted (but can be disabled)' });
    }
    await db.query('DELETE FROM member_custom_balances WHERE column_key = $1', [key]);
    await db.query('DELETE FROM balance_columns WHERE key = $1', [key]);
    res.json({ message: 'Column deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getSettings, updateSettings, getColumns, createColumn, updateColumn, deleteColumn };
