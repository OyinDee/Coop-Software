/**
 * Repair per-loan remaining_balance from repayment history.
 * Run when multiple active loans were incorrectly given the member's total ledger balance.
 */
require('dotenv').config();
const db = require('./src/db');

async function fixLoanRemaining() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query(`
      UPDATE loans l
      SET remaining_balance = GREATEST(0, l.principal - COALESCE((
        SELECT SUM(principal_paid) FROM loan_repayments lr WHERE lr.loan_id = l.id
      ), 0)),
      status = CASE
        WHEN l.status = 'active'
          AND GREATEST(0, l.principal - COALESCE((
            SELECT SUM(principal_paid) FROM loan_repayments lr WHERE lr.loan_id = l.id
          ), 0)) <= 0
          AND l.interest_paid >= l.total_interest
        THEN 'cleared'
        WHEN l.status = 'active'
          AND GREATEST(0, l.principal - COALESCE((
            SELECT SUM(principal_paid) FROM loan_repayments lr WHERE lr.loan_id = l.id
          ), 0)) <= 0
        THEN 'cleared'
        ELSE l.status
      END,
      updated_at = NOW()
      WHERE l.status IN ('active', 'cleared')
      RETURNING l.id, l.member_id, l.principal, l.remaining_balance
    `);

    await client.query('COMMIT');
    console.log(`Repaired ${result.rowCount} loan records`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Repair failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

fixLoanRemaining();
