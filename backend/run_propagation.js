const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to DB for full running balance propagation...');

  try {
    await client.query('BEGIN');

    // 1. Fetch all transactions from 2025 onwards in one query
    const allTransRes = await client.query(`
      SELECT member_id, year, month, column_key, amount 
      FROM monthly_trans 
      WHERE year >= 2025
      ORDER BY member_id, year ASC, month ASC
    `);

    const dataByMember = {};
    for (const r of allTransRes.rows) {
      const mId = r.member_id;
      const y = r.year;
      const m = r.month;
      if (!dataByMember[mId]) dataByMember[mId] = {};
      if (!dataByMember[mId][y]) dataByMember[mId][y] = {};
      if (!dataByMember[mId][y][m]) dataByMember[mId][y][m] = {};
      dataByMember[mId][y][m][r.column_key] = parseFloat(r.amount) || 0;
    }

    const periodsRes = await client.query(`
      SELECT DISTINCT year, month 
      FROM monthly_trans 
      WHERE year >= 2025
      ORDER BY year ASC, month ASC
    `);
    const periods = periodsRes.rows;
    console.log('Periods found in DB:', periods);

    const bulkRows = [];
    const loanUpdates = new Map();

    for (const [mIdStr, yearData] of Object.entries(dataByMember)) {
      const memberId = parseInt(mIdStr, 10);

      // Dec 2025 initial balances
      const decData = (yearData[2025] && yearData[2025][12]) || {};
      let carrySavings = decData.savings_cf  || decData.savings_bf  || decData.savings_balance   || 0;
      let carryLoan    = decData.loan_ledger_bal || decData.loan_bal_bf || decData.loan_balance     || 0;
      let carryInt     = decData.loan_int_cf || decData.loan_int_bf || decData.interest_balance  || 0;
      let carryComm    = decData.comm_bal_cf || decData.comm_bal_bf || decData.commodity_balance || 0;

      for (const p of periods) {
        if (p.year === 2025 && p.month === 12) {
          const decKeys = {
            savings_bf: carrySavings, savings_cf: carrySavings,
            loan_bal_bf: carryLoan, loan_ledger_bal: carryLoan,
            loan_int_bf: carryInt, loan_int_cf: carryInt,
            comm_bal_bf: carryComm, comm_bal_cf: carryComm,
          };
          for (const [k, v] of Object.entries(decKeys)) {
            bulkRows.push([memberId, k, v, 12, 2025]);
          }
          continue;
        }

        const monthData = (yearData[p.year] && yearData[p.year][p.month]) || {};
        const g = (k) => monthData[k] || 0;

        const savings_bf         = carrySavings;
        const savings_add        = g('savings_add');
        const savings_add_bank   = g('savings_add_bank');
        const savings_withdrawal = g('savings_withdrawal');
        const savings_cf         = Math.max(0, savings_bf + savings_add + savings_add_bank - savings_withdrawal);

        const loan_bal_bf        = carryLoan;
        const loan_granted       = g('loan_granted');
        const loan_repayment     = g('loan_repayment');
        const loan_repayment_bank= g('loan_repayment_bank');
        const loan_ledger_bal    = Math.max(0, loan_bal_bf + loan_granted - loan_repayment - loan_repayment_bank);

        const loan_int_bf        = carryInt;
        const loan_int_charged   = g('loan_int_charged');
        const loan_int_paid      = g('loan_int_paid');
        const loan_int_paid_bank = g('loan_int_paid_bank');
        const loan_int_cf        = Math.max(0, loan_int_bf + loan_int_charged - loan_int_paid - loan_int_paid_bank);

        const comm_bal_bf        = carryComm;
        const comm_add           = g('comm_add');
        const comm_repayment     = g('comm_repayment');
        const comm_repayment_bank= g('comm_repayment_bank');
        const comm_bal_cf        = Math.max(0, comm_bal_bf + comm_add - comm_repayment - comm_repayment_bank);

        // Update carry values for next month
        carrySavings = savings_cf;
        carryLoan    = loan_ledger_bal;
        carryInt     = loan_int_cf;
        carryComm    = comm_bal_cf;

        const updateKeys = {
          savings_bf, savings_cf,
          loan_bal_bf, loan_ledger_bal,
          loan_int_bf, loan_int_cf,
          comm_bal_bf, comm_bal_cf,
        };

        for (const [k, v] of Object.entries(updateKeys)) {
          bulkRows.push([memberId, k, v, p.month, p.year]);
        }
      }

      loanUpdates.set(memberId, carryLoan);
    }

    console.log(`Bulk inserting ${bulkRows.length} balance entries across all months...`);
    const batchSize = 1000;
    for (let i = 0; i < bulkRows.length; i += batchSize) {
      const chunk = bulkRows.slice(i, i + batchSize);
      const valueStrings = chunk.map((_, idx) => `($${idx*5+1},$${idx*5+2},$${idx*5+3},$${idx*5+4},$${idx*5+5})`).join(',');
      const flatValues = chunk.flat();
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        VALUES ${valueStrings}
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, flatValues);
    }

    if (loanUpdates.size > 0) {
      console.log('Updating active loan remaining balances in bulk...');
      const mIds = Array.from(loanUpdates.keys());
      const remBals = Array.from(loanUpdates.values());
      await client.query(`
        UPDATE loans SET remaining_balance = u.rem_bal, updated_at = NOW()
        FROM (SELECT unnest($1::int[]) AS m_id, unnest($2::numeric[]) AS rem_bal) u
        WHERE loans.member_id = u.m_id AND loans.status = 'active'
      `, [mIds, remBals]);
    }

    await client.query('COMMIT');
    console.log('FULL BALANCE PROPAGATION COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Propagation failed:', err);
  } finally {
    await client.end();
  }
}

run();
