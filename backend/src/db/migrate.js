require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('./index');

async function migrate() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Admins table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(200),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        ledger_no VARCHAR(50) UNIQUE NOT NULL,
        staff_no VARCHAR(50),
        gifmis_no VARCHAR(50),
        full_name VARCHAR(200) NOT NULL,
        gender VARCHAR(10),
        marital_status VARCHAR(20),
        phone VARCHAR(20),
        email VARCHAR(200),
        date_of_admission DATE,
        bank VARCHAR(100),
        account_number VARCHAR(30),
        department VARCHAR(200),
        next_of_kin VARCHAR(200),
        next_of_kin_relation VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Loans table
    await client.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        principal NUMERIC(15,2) NOT NULL,
        months INTEGER NOT NULL,
        remaining_balance NUMERIC(15,2) NOT NULL,
        monthly_principal NUMERIC(15,2) NOT NULL,
        total_interest NUMERIC(15,2) NOT NULL,
        monthly_interest NUMERIC(15,2) NOT NULL,
        interest_paid NUMERIC(15,2) DEFAULT 0,
        months_paid INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        date_issued DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Savings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS savings (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(member_id, month, year)
      );
    `);

    // Shares table
    await client.query(`
      CREATE TABLE IF NOT EXISTS shares (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(member_id, month, year)
      );
    `);

    // Commodity table
    await client.query(`
      CREATE TABLE IF NOT EXISTS commodity (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        description TEXT,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Loan repayments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS loan_repayments (
        id SERIAL PRIMARY KEY,
        loan_id INTEGER REFERENCES loans(id) ON DELETE CASCADE,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        principal_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
        interest_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate().catch(console.error);
