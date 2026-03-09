const db = require('../db');

// Helper: sync comm_add from commodity table and recalculate comm_bal_cf
async function recalcCommTrans(client, member_id, month, year) {
  const m = parseInt(month), y = parseInt(year);

  // Sum all commodity records for this member/month (absolute, not cumulative)
  const totRes = await client.query(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM commodity WHERE member_id=$1 AND month=$2 AND year=$3',
    [member_id, m, y]
  );
  const comm_add = parseFloat(totRes.rows[0].total);

  await client.query(`
    INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
    VALUES ($1, 'comm_add', $2, $3, $4)
    ON CONFLICT (member_id, column_key, month, year)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
  `, [member_id, comm_add, m, y]);

  // Get B/F and repayment values
  const res = await client.query(`
    SELECT column_key, amount FROM monthly_trans
    WHERE member_id=$1 AND month=$2 AND year=$3
      AND column_key IN ('comm_bal_bf', 'comm_repayment', 'comm_repayment_bank')
  `, [member_id, m, y]);
  const v = {};
  for (const r of res.rows) v[r.column_key] = parseFloat(r.amount) || 0;

  const commBefore  = (v.comm_bal_bf || 0) + comm_add;
  const effRepay    = Math.min(v.comm_repayment || 0, commBefore);
  const effRepayBnk = Math.min(v.comm_repayment_bank || 0, Math.max(0, commBefore - effRepay));
  const comm_bal_cf = Math.max(0, commBefore - effRepay - effRepayBnk);

  await client.query(`
    INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
    VALUES ($1, 'comm_bal_cf', $2, $3, $4)
    ON CONFLICT (member_id, column_key, month, year)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
  `, [member_id, comm_bal_cf, m, y]);
}

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
  const { member_id, amount, description, month, year, monthly_repayment } = req.body;
  if (!member_id || !amount || !month || !year) {
    return res.status(400).json({ error: 'member_id, amount, month, year required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'INSERT INTO commodity (member_id, amount, description, month, year) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [member_id, amount, description, month, year]
    );

    // If a monthly repayment was specified, set comm_repayment for this month
    if (monthly_repayment && parseFloat(monthly_repayment) > 0) {
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        VALUES ($1, 'comm_repayment', $2, $3, $4)
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, [member_id, parseFloat(monthly_repayment), parseInt(month), parseInt(year)]);
    }

    // Sync comm_add from commodity table total and recalculate comm_bal_cf
    await recalcCommTrans(client, member_id, parseInt(month), parseInt(year));

    await client.query('COMMIT');
    res.status(201).json({ commodity: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function updateCommodity(req, res) {
  const { id } = req.params;
  const { amount, description } = req.body;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get the old commodity record
    const oldRecord = await client.query('SELECT * FROM commodity WHERE id=$1', [id]);
    if (!oldRecord.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const old = oldRecord.rows[0];

    // Update commodity table
    const result = await client.query(
      'UPDATE commodity SET amount=$1, description=$2 WHERE id=$3 RETURNING *',
      [amount, description, id]
    );

    // Recalculate comm_add and comm_bal_cf for the commodity's actual month/year
    await recalcCommTrans(client, old.member_id, old.month, old.year);

    await client.query('COMMIT');
    res.json({ commodity: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function deleteCommodity(req, res) {
  const { id } = req.params;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get the commodity record before deletion
    const oldRecord = await client.query('SELECT * FROM commodity WHERE id=$1', [id]);
    if (!oldRecord.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const old = oldRecord.rows[0];

    // Delete from commodity table
    await client.query('DELETE FROM commodity WHERE id=$1', [id]);

    // Recalculate comm_add and comm_bal_cf for the commodity's actual month/year
    await recalcCommTrans(client, old.member_id, old.month, old.year);

    await client.query('COMMIT');
    res.json({ message: 'Deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { getCommodity, getMemberCommodity, createCommodity, updateCommodity, deleteCommodity };
