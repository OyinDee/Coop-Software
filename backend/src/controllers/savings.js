const db = require('../db');

async function getSavings(req, res) {
  const { month, year } = req.query;
  try {
    // When a specific month+year is requested, return ALL active members with carry-forward logic:
    // if no record exists for that month, use the most recent past savings amount.
    if (month && year) {
      const m = parseInt(month);
      const y = parseInt(year);
      const result = await db.query(`
        SELECT
          m.id            AS member_id,
          m.full_name,
          m.ledger_no,
          s.id            AS id,
          $1::int         AS month,
          $2::int         AS year,
          s.description,
          COALESCE(
            s.amount,
            (SELECT sv.amount FROM savings sv
             WHERE sv.member_id = m.id
               AND (sv.year < $2 OR (sv.year = $2 AND sv.month < $1))
             ORDER BY sv.year DESC, sv.month DESC LIMIT 1),
            0
          ) AS amount,
          CASE
            WHEN s.id IS NOT NULL THEN FALSE
            WHEN (
              SELECT 1 FROM savings sv WHERE sv.member_id = m.id
                AND (sv.year < $2 OR (sv.year = $2 AND sv.month < $1))
              LIMIT 1
            ) IS NOT NULL THEN TRUE
            ELSE NULL
          END AS carried_forward
        FROM members m
        LEFT JOIN savings s
          ON s.member_id = m.id AND s.month = $1 AND s.year = $2
        WHERE m.is_active = TRUE
        ORDER BY m.ledger_no
      `, [m, y]);
      return res.json({ savings: result.rows });
    }

    // No filter: return all actual records
    const result = await db.query(`
      SELECT s.*, m.full_name, m.ledger_no
      FROM savings s JOIN members m ON m.id = s.member_id
      ORDER BY s.year DESC, s.month DESC, s.amount DESC
    `);
    res.json({ savings: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMemberSavings(req, res) {
  const { memberId } = req.params;
  try {
    const result = await db.query(
      'SELECT * FROM savings WHERE member_id=$1 ORDER BY year DESC, month DESC',
      [memberId]
    );
    const total = result.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    res.json({ savings: result.rows, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSavings(req, res) {
  const { member_id, amount, month, year, description } = req.body;
  if (!member_id || !amount || !month || !year) {
    return res.status(400).json({ error: 'member_id, amount, month, year required' });
  }
  try {
    const result = await db.query(`
      INSERT INTO savings (member_id, amount, month, year, description)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (member_id, month, year) DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description
      RETURNING *
    `, [member_id, amount, month, year, description]);
    res.status(201).json({ saving: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSavings(req, res) {
  const { id } = req.params;
  const { amount, description } = req.body;
  try {
    const result = await db.query(
      'UPDATE savings SET amount=$1, description=$2 WHERE id=$3 RETURNING *',
      [amount, description, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Record not found' });
    res.json({ saving: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteSavings(req, res) {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM savings WHERE id=$1', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getSavings, getMemberSavings, createSavings, updateSavings, deleteSavings };
