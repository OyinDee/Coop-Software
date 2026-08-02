const db = require('../db');

/**
 * Propagate running balances forward for a single member starting from a given month.
 * Uses the previous month's C/F values as the starting B/F, then cascades through
 * all subsequent months that have any data in monthly_trans.
 *
 * @param {object} client - A pg client (inside a transaction) or the db pool
 * @param {number} memberId - The member's id
 * @param {number} fromMonth - Month to start propagation (1-12)
 * @param {number} fromYear - Year to start propagation
 */
async function propagateMemberBalances(client, memberId, fromMonth, fromYear) {
  // 1. Fetch all monthly_trans for this member from (fromYear, fromMonth) onward,
  //    PLUS the previous month so we can get carry-forward starting values.
  const prevMonth = fromMonth === 1 ? 12 : fromMonth - 1;
  const prevYear  = fromMonth === 1 ? fromYear - 1 : fromYear;

  const allRes = await client.query(`
    SELECT year, month, column_key, amount
    FROM monthly_trans
    WHERE member_id = $1
      AND (
        (year = $2 AND month = $3)
        OR (year > $4 OR (year = $4 AND month >= $5))
      )
    ORDER BY year ASC, month ASC
  `, [memberId, prevYear, prevMonth, fromYear, fromMonth]);

  // Organise into { "YYYY-MM": { column_key: amount } }
  const byPeriod = {};
  for (const r of allRes.rows) {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byPeriod[key]) byPeriod[key] = { year: r.year, month: r.month, data: {} };
    byPeriod[key].data[r.column_key] = parseFloat(r.amount) || 0;
  }

  // Sort periods chronologically
  const periods = Object.values(byPeriod).sort((a, b) => a.year - b.year || a.month - b.month);

  if (periods.length === 0) return;

  // 2. Extract carry-forward from the previous month (if it exists in our result set)
  let carrySavings = 0, carryLoan = 0, carryInt = 0, carryComm = 0;

  const prevKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  if (byPeriod[prevKey]) {
    const d = byPeriod[prevKey].data;
    carrySavings = d.savings_cf  ?? d.savings_bf  ?? 0;
    carryLoan    = d.loan_ledger_bal ?? d.loan_bal_bf ?? 0;
    carryInt     = d.loan_int_cf ?? d.loan_int_bf ?? 0;
    carryComm    = d.comm_bal_cf ?? d.comm_bal_bf ?? 0;
  }

  // 3. Walk forward from fromMonth, computing B/F and C/F
  const updates = []; // [memberId, column_key, amount, month, year]

  for (const p of periods) {
    // Skip the previous-month entry (we only needed it for carry values)
    if (p.year === prevYear && p.month === prevMonth) continue;

    const g = (k) => p.data[k] || 0;

    const savings_bf         = carrySavings;
    const savings_add        = g('savings_add');
    const savings_add_bank   = g('savings_add_bank');
    const savings_withdrawal = g('savings_withdrawal');
    const savings_cf         = Math.max(0, savings_bf + savings_add + savings_add_bank - savings_withdrawal);

    const loan_bal_bf         = carryLoan;
    const loan_granted        = g('loan_granted');
    const loan_repayment      = g('loan_repayment');
    const loan_repayment_bank = g('loan_repayment_bank');
    const loan_ledger_bal     = Math.max(0, loan_bal_bf + loan_granted - loan_repayment - loan_repayment_bank);

    const loan_int_bf         = carryInt;
    const loan_int_charged    = g('loan_int_charged');
    const loan_int_paid       = g('loan_int_paid');
    const loan_int_paid_bank  = g('loan_int_paid_bank');
    const loan_int_cf         = Math.max(0, loan_int_bf + loan_int_charged - loan_int_paid - loan_int_paid_bank);

    const comm_bal_bf         = carryComm;
    const comm_add            = g('comm_add');
    const comm_repayment      = g('comm_repayment');
    const comm_repayment_bank = g('comm_repayment_bank');
    const comm_bal_cf         = Math.max(0, comm_bal_bf + comm_add - comm_repayment - comm_repayment_bank);

    // Carry forward for next month
    carrySavings = savings_cf;
    carryLoan    = loan_ledger_bal;
    carryInt     = loan_int_cf;
    carryComm    = comm_bal_cf;

    const balanceKeys = {
      savings_bf, savings_cf,
      loan_bal_bf, loan_ledger_bal,
      loan_int_bf, loan_int_cf,
      comm_bal_bf, comm_bal_cf,
    };

    for (const [k, v] of Object.entries(balanceKeys)) {
      updates.push([memberId, k, v, p.month, p.year]);
    }
  }

  // 4. Bulk upsert all computed balance values
  if (updates.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const chunk = updates.slice(i, i + batchSize);
      const valueStrings = chunk.map((_, idx) =>
        `($${idx * 5 + 1},$${idx * 5 + 2},$${idx * 5 + 3},$${idx * 5 + 4},$${idx * 5 + 5})`
      ).join(',');
      const flatValues = chunk.flat();
      await client.query(`
        INSERT INTO monthly_trans (member_id, column_key, amount, month, year)
        VALUES ${valueStrings}
        ON CONFLICT (member_id, column_key, month, year)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      `, flatValues);
    }
  }

  // 5. Update the loans table remaining_balance to match the latest C/F
  await client.query(`
    UPDATE loans SET remaining_balance = $1, updated_at = NOW()
    WHERE member_id = $2 AND status = 'active'
  `, [carryLoan, memberId]);
}

module.exports = { propagateMemberBalances };
