// Script to create member_custom_balances table and add unique constraint
// Run with: node backend/scripts/add-member-custom-balances-constraint.js
// Must be run from project root: CODE/COOP/

const path = require('path');

// Try multiple .env locations to be safe
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL not found in any .env file.');
  console.error('Searched in:');
  console.error(' -', path.join(__dirname, '../../.env'));
  console.error(' -', path.join(__dirname, '../.env'));
  console.error(' -', path.join(__dirname, '.env'));
  process.exit(1);
}
console.log('Connecting to:', connectionString.slice(0, 50) + '...');

const pool = new Pool({ connectionString, ssl: false });

async function addMemberCustomBalancesConstraint() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS member_custom_balances (
        id          SERIAL PRIMARY KEY,
        member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        column_key  VARCHAR(100) NOT NULL,
        amount      NUMERIC(15, 2) NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('Table member_custom_balances ensured.');

    // 2. Add unique constraint if it doesn't already exist
    const constraintRes = await client.query(`
      SELECT 1 FROM pg_constraint
      WHERE conname = 'member_custom_balances_member_id_column_key_key'
    `);

    if (constraintRes.rows.length) {
      console.log('Unique constraint already exists — skipping.');
    } else {
      await client.query(`
        ALTER TABLE member_custom_balances
          ADD CONSTRAINT member_custom_balances_member_id_column_key_key
          UNIQUE (member_id, column_key)
      `);
      console.log('Unique constraint (member_id, column_key) added.');
    }

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

addMemberCustomBalancesConstraint();