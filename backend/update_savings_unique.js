const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Altering unique constraint on savings table...');
  try {
    // Drop old unique constraint
    await client.query(`ALTER TABLE savings DROP CONSTRAINT IF EXISTS savings_member_id_month_year_key`);
    
    // Create new unique constraint including is_bank
    await client.query(`ALTER TABLE savings ADD CONSTRAINT savings_member_id_month_year_is_bank_key UNIQUE (member_id, month, year, is_bank)`);
    console.log('Constraint updated successfully.');
  } catch (e) {
    console.error('Error altering constraint:', e);
  }

  await client.end();
}
run();
