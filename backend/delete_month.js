const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const month = 8, year = 2026;

  console.log(`Deleting all generated data for ${month}/${year}...`);

  const r1 = await client.query(
    `DELETE FROM monthly_trans WHERE month = $1 AND year = $2`, [month, year]
  );
  console.log(`  monthly_trans: ${r1.rowCount} rows deleted`);

  const r2 = await client.query(
    `DELETE FROM savings WHERE month = $1 AND year = $2`, [month, year]
  );
  console.log(`  savings: ${r2.rowCount} rows deleted`);

  const r3 = await client.query(
    `DELETE FROM commodity WHERE month = $1 AND year = $2`, [month, year]
  );
  console.log(`  commodity: ${r3.rowCount} rows deleted`);

  console.log('Done! August 2026 data removed.');
  await client.end();
}
run();
