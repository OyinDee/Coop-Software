const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Adding is_bank column to loan_repayments table...');
  try {
    await client.query(`ALTER TABLE loan_repayments ADD COLUMN IF NOT EXISTS is_bank BOOLEAN DEFAULT FALSE`);
    console.log('Column added successfully.');
  } catch (e) {
    console.error('Error adding column:', e);
  }

  await client.end();
}
run();
