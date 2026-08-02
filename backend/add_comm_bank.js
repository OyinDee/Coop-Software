const { Client } = require('pg');
require('dotenv').config({ path: './.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('Adding repayment_is_bank column to commodity table...');
  try {
    await client.query(`ALTER TABLE commodity ADD COLUMN IF NOT EXISTS repayment_is_bank BOOLEAN DEFAULT FALSE`);
    console.log('Column added successfully.');
  } catch (e) {
    console.error('Error adding column:', e);
  }

  await client.end();
}
run();
