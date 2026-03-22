#!/usr/bin/env node
/**
 * Clear all data from database
 * Usage: node clear-all-data.js
 */

require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});

async function clearAllData() {
  try {
    await client.connect();
    console.log('Connected to database. Clearing all data...\n');

    // Delete from all tables (order matters for foreign keys)
    const tables = [
      'reconciliation_data',
      'monthly_trans',
      'loan_schedules',
      'loans',
      'savings',
      'commodity',
      'deductions',
      'shares',
      'members',
    ];

    for (const table of tables) {
      try {
        const existsRes = await client.query(
          'SELECT to_regclass($1) IS NOT NULL AS exists',
          [`public.${table}`]
        );
        if (!existsRes.rows[0]?.exists) {
          console.log(`- Skipped ${table} (table does not exist)`);
          continue;
        }

        await client.query(`DELETE FROM ${table};`);
        console.log(`✓ Cleared ${table}`);
      } catch (err) {
        console.log(`✗ Error clearing ${table}: ${err.message}`);
      }
    }

    console.log('\n✓ All data cleared successfully');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

clearAllData();
