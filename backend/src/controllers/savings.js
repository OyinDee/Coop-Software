const db = require('../db');

const { propagateMemberBalances } = require('../utils/propagateBalances');

// Helper: set savings_add or savings_add_bank in monthly_trans and recalculate savings_cf
async function syncSavingsToTrans(client, member_id, month, year, savings_add_amount, is_bank = false) {
  const m = parseInt(month), y = parseInt(year);

  // Get sum of standard savings (is_bank = false)
  const stdRes = await client.query(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM savings
    WHERE member_id = $1 AND month = $2 AND year = $3 AND is_bank = false
  `, [member_id, m, y]);
  const stdAmt = parseFloat(stdRes.rows[0].total) || 0;

  // Get sum of bank savings (is_bank = true)
  const bnkRes = await client.query(`
    SELECT COALESCE(SUM(amount), 0) AS total FROM savings
    WHERE member_id = $1 AND month = $2 AND year = $3 AND is_bank = true
  `, [member_id, m, y]);
  const bnkAmt = parseFloat(bnkRes.rows[0].total) || 0;

  // Insert standard savings to monthly_trans
  await client.query(`
    INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
    VALUES ($1, 'savings_add', $2, $3, $4)
    ON CONFLICT (member_id, column_key, month, year)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
  `, [member_id, stdAmt, m, y]);

  // Insert bank savings to monthly_trans
  await client.query(`
    INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
    VALUES ($1, 'savings_add_bank', $2, $3, $4)
    ON CONFLICT (member_id, column_key, month, year)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
  `, [member_id, bnkAmt, m, y]);

  // Get other savings variables for this month
  const res = await client.query(`
    SELECT column_key, amount FROM monthly_trans
    WHERE member_id=$1 AND month=$2 AND year=$3
      AND column_key IN ('savings_bf', 'savings_add', 'savings_add_bank', 'savings_withdrawal')
  `, [member_id, m, y]);
  const v = {};
  for (const r of res.rows) v[r.column_key] = parseFloat(r.amount) || 0;

  const savings_cf = Math.max(0,
    (v.savings_bf || 0) + (v.savings_add || 0) + (v.savings_add_bank || 0) - (v.savings_withdrawal || 0)
  );

  await client.query(`
    INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
    VALUES ($1, 'savings_cf', $2, $3, $4)
    ON CONFLICT (member_id, column_key, month, year)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
  `, [member_id, savings_cf, m, y]);

  // Propagate balances forward to subsequent months
  await propagateMemberBalances(client, member_id, m, y);
}

async function getSavings(req, res) {
  const { month, year } = req.query;
  try {
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
          COALESCE(
            s.description,
            CASE 
              WHEN s.id IS NULL THEN 'Opening Balance'
              ELSE 'Carried Forward'
            END
          ) AS description,
          COALESCE(
            s.amount,
            (SELECT sv.amount FROM savings sv
             WHERE sv.member_id = m.id
               AND (sv.year < $2 OR (sv.year = $2 AND sv.month < $1))
             ORDER BY sv.year DESC, sv.month DESC LIMIT 1),
            0
          ) AS amount,
          -- Cumulative savings balance: prefer savings_cf from monthly_trans, else sum from savings table
          COALESCE(
            (SELECT mt.amount FROM monthly_trans mt
             WHERE mt.member_id = m.id AND mt.month = $1 AND mt.year = $2
               AND mt.column_key = 'savings_cf' LIMIT 1),
            (SELECT COALESCE(SUM(sv.amount), 0) FROM savings sv
             WHERE sv.member_id = m.id
               AND (sv.year < $2 OR (sv.year = $2 AND sv.month <= $1))),
            0
          ) AS cumulative_balance,
          COALESCE(s.is_bank, FALSE) AS is_bank,
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
        -- Include all members (active and deactivated) to show their savings and loans
        ORDER BY m.ledger_no
      `, [m, y]);
      return res.json({ savings: result.rows });
    }

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
  const { member_id, amount, month, year, description, is_bank } = req.body;
  if (!member_id || !amount || !month || !year) {
    return res.status(400).json({ error: 'member_id, amount, month, year required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Upsert savings record based on the new unique constraint (member_id, month, year, is_bank)
    const result = await client.query(`
      INSERT INTO savings (member_id, amount, month, year, description, is_bank)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (member_id, month, year, is_bank) DO UPDATE SET amount = EXCLUDED.amount, description = EXCLUDED.description
      RETURNING *
    `, [member_id, amount, month, year, description, is_bank || false]);

    // Sync savings_add to monthly_trans and recalculate savings_cf
    await syncSavingsToTrans(client, member_id, month, year, parseFloat(amount), is_bank || false);

    await client.query('COMMIT');
    res.status(201).json({ saving: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function updateSavings(req, res) {
  const { id } = req.params;
  const { amount, description, is_bank } = req.body;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get the old savings record
    const oldRecord = await client.query('SELECT * FROM savings WHERE id=$1', [id]);
    if (!oldRecord.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Record not found' });
    }

    const old = oldRecord.rows[0];
    const newIsBank = is_bank !== undefined ? is_bank : old.is_bank;

    // Update savings table
    const result = await client.query(
      'UPDATE savings SET amount=$1, description=$2, is_bank=$3 WHERE id=$4 RETURNING *',
      [amount, description, newIsBank, id]
    );

    // Sync savings_add to monthly_trans and recalculate savings_cf
    await syncSavingsToTrans(client, old.member_id, old.month, old.year, parseFloat(amount), newIsBank);

    await client.query('COMMIT');
    res.json({ saving: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function deleteSavings(req, res) {
  const { id } = req.params;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get the savings record before deletion
    const oldRecord = await client.query('SELECT * FROM savings WHERE id=$1', [id]);
    if (!oldRecord.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const old = oldRecord.rows[0];

    // Delete from savings table
    await client.query('DELETE FROM savings WHERE id=$1', [id]);

    // Set savings_add = 0 and recalculate savings_cf
    await syncSavingsToTrans(client, old.member_id, old.month, old.year, 0);

    await client.query('COMMIT');
    res.json({ message: 'Deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { getSavings, getMemberSavings, createSavings, updateSavings, deleteSavings };
