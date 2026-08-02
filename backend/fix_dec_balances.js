const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to DB');

  try {
    await client.query('BEGIN');

    console.log('1. Deleting unneeded zero-entry rows for future months...');
    await client.query('DELETE FROM monthly_trans WHERE month = 8 AND year = 2026 AND amount = 0');

    console.log('2. Migrating custom balance keys to standard system keys for December 2025...');
    const keyPairs = [
      ['savings_balance', 'savings_bf'],
      ['savings_balance', 'savings_cf'],
      ['loan_balance', 'loan_bal_bf'],
      ['loan_balance', 'loan_ledger_bal'],
      ['interest_balance', 'loan_int_bf'],
      ['interest_balance', 'loan_int_cf'],
      ['commodity_balance', 'comm_bal_bf'],
      ['commodity_balance', 'comm_bal_cf'],
    ];

    for (const [oldKey, newKey] of keyPairs) {
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        SELECT member_id, $2, amount, month, year
        FROM monthly_trans
        WHERE column_key = $1
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, [oldKey, newKey]);
    }

    console.log('3. Populating active loans into loans table...');
    const loanRows = await client.query(`
      SELECT member_id, amount 
      FROM monthly_trans 
      WHERE column_key = 'loan_bal_bf' AND amount > 0 AND year = 2025 AND month = 12
    `);

    for (const r of loanRows.rows) {
      const memberId = r.member_id;
      const loanVal = parseFloat(r.amount);

      const intRes = await client.query(`
        SELECT amount FROM monthly_trans 
        WHERE member_id = $1 AND column_key = 'loan_int_bf' AND year = 2025 AND month = 12
      `, [memberId]);
      const intVal = intRes.rows[0] ? parseFloat(intRes.rows[0].amount) : 0;
      const monthlyPrin = Math.round((loanVal / 12) * 100) / 100;

      await client.query('DELETE FROM loans WHERE member_id = $1 AND description = \'Opening Balance\'', [memberId]);
      await client.query(`
        INSERT INTO loans 
          (member_id, principal, months, remaining_balance, monthly_principal, 
           total_interest, monthly_interest, interest_paid, months_paid, status, date_issued, description)
        VALUES ($1, $2, 12, $3, $4, $5, 0, 0, 1, 'active', '2025-12-01', 'Opening Balance')
      `, [memberId, loanVal, loanVal, monthlyPrin, intVal]);
    }

    console.log('4. Populating savings table B/F...');
    const savRows = await client.query(`
      SELECT member_id, amount 
      FROM monthly_trans 
      WHERE column_key = 'savings_bf' AND amount > 0 AND year = 2025 AND month = 12
    `);

    for (const r of savRows.rows) {
      await client.query(`
        INSERT INTO savings (member_id, amount, month, year, description)
        VALUES ($1, $2, 12, 2025, 'Balance B/F')
        ON CONFLICT (member_id, month, year)
        DO UPDATE SET amount = EXCLUDED.amount
      `, [r.member_id, parseFloat(r.amount)]);
    }

    await client.query('COMMIT');
    console.log('SUCCESS! December 2025 balances migrated and Dashboard data populated.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

run();
