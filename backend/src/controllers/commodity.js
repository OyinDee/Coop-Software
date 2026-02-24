const db = require('../db');

async function getCommodity(req, res) {
  try {
    const result = await db.query(`
      SELECT c.*, m.full_name, m.ledger_no
      FROM commodity c JOIN members m ON m.id = c.member_id
      ORDER BY c.created_at DESC
    `);
    res.json({ commodity: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMemberCommodity(req, res) {
  const { memberId } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM commodity WHERE member_id=$1 ORDER BY year DESC, month DESC',
      [memberId]
    );
    const total = result.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    res.json({ commodity: result.rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createCommodity(req, res) {
  const { member_id, amount, description, month, year } = req.body;
  if (!member_id || !amount || !month || !year) {
    return res.status(400).json({ error: 'member_id, amount, month, year required' });
  }
  try {
    const result = await db.query(
      'INSERT INTO commodity (member_id, amount, description, month, year) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [member_id, amount, description, month, year]
    );
    res.status(201).json({ commodity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateCommodity(req, res) {
  const { id } = req.params;
  const { amount, description } = req.body;
  try {
    const result = await db.query(
      'UPDATE commodity SET amount=$1, description=$2 WHERE id=$3 RETURNING *',
      [amount, description, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ commodity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteCommodity(req, res) {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM commodity WHERE id=$1', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getCommodity, getMemberCommodity, createCommodity, updateCommodity, deleteCommodity };
