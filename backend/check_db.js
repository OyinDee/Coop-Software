const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Check a few members across months to see what monthly_trans actually has
  const res = await client.query(`
    SELECT member_id, year, month, column_key, amount
    FROM monthly_trans
    WHERE member_id IN (
      SELECT id FROM members ORDER BY id LIMIT 3
    )
    AND year = 2026
    ORDER BY member_id, year, month, column_key
  `);

  const byMember = {};
  for (const r of res.rows) {
    const k = `member_${r.member_id}`;
    if (!byMember[k]) byMember[k] = {};
    const mk = `${r.year}-${String(r.month).padStart(2,'0')}`;
    if (!byMember[k][mk]) byMember[k][mk] = {};
    byMember[k][mk][r.column_key] = parseFloat(r.amount);
  }

  for (const [mem, months] of Object.entries(byMember)) {
    console.log(`\n=== ${mem} ===`);
    for (const [month, keys] of Object.entries(months)) {
      console.log(`  ${month}:`, JSON.stringify(keys));
    }
  }

  // Also check what's in the savings table
  const savRes = await client.query(`
    SELECT member_id, year, month, amount
    FROM savings
    WHERE member_id IN (SELECT id FROM members ORDER BY id LIMIT 3)
    ORDER BY member_id, year, month
  `);
  console.log('\n=== SAVINGS TABLE ===');
  for (const r of savRes.rows) {
    console.log(`  member_${r.member_id} ${r.year}-${String(r.month).padStart(2,'0')}: ${r.amount}`);
  }

  await client.end();
}
run();
