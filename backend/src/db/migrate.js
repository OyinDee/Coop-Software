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

    // App settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT
      );
    `);

    // Seed default loan interest rate and penalty rate if not already set
    await client.query(`
      INSERT INTO app_settings (key, value, description) VALUES
        ('loan_interest_rate', '5', 'Annual loan interest rate percentage'),
        ('loan_penalty_rate', '10', 'Penalty rate percentage for unpaid loan installments (default 10%)')
      ON CONFLICT (key) DO NOTHING;
    `);

    // Add interest_rate column to loans if not already present (for existing databases)
    await client.query(`
      ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(5,4) DEFAULT 0.05;
    `);

    // Add months_remaining column to loans (for diminishing balance calculation)
    await client.query(`
      ALTER TABLE loans ADD COLUMN IF NOT EXISTS months_remaining INTEGER;
    `);

    // Populate months_remaining for existing loans (= months - months_paid)
    await client.query(`
      UPDATE loans SET months_remaining = GREATEST(0, months - months_paid) 
      WHERE months_remaining IS NULL;
    `);

    // Add performance indexes for large datasets
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_full_name_text ON members USING gin(to_tsvector('english', full_name))`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_ledger_no_text ON members USING gin(to_tsvector('english', ledger_no))`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_staff_no_text ON members USING gin(to_tsvector('english', staff_no))`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_department_text ON members USING gin(to_tsvector('english', department))`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_active_created ON members(is_active, created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_composite ON members(is_active, ledger_no)`);

    // Optimize savings table for large datasets
    await client.query(`CREATE INDEX IF NOT EXISTS idx_savings_member_amount ON savings(member_id, amount)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_savings_member_month_year ON savings(member_id, month, year)`);

    // Optimize loans table for large datasets  
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_member_status ON loans(member_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_active_balance ON loans(status, remaining_balance) WHERE status = 'active'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_member_interest ON loans(member_id, total_interest, interest_paid)`);

    // Optimize monthly_trans for large datasets
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_trans_composite ON monthly_trans(member_id, month, year, column_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_trans_member_lookup ON monthly_trans(member_id, column_key)`);

    // Add pagination count optimization
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_count ON members(is_active) WHERE is_active = TRUE`);

    // ── Add indexes for optimal 700+ member performance ────────────────────────
    // Members table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_is_active ON members(is_active)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_ledger_no ON members(ledger_no)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_members_staff_no ON members(staff_no)`);

    // Savings table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_savings_member_id ON savings(member_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_savings_member_month_year ON savings(member_id, month, year)`);

    // Loans table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_member_id ON loans(member_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_member_status ON loans(member_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loans_months_remaining ON loans(months_remaining)`);

    // Monthly_trans table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_trans_member_id ON monthly_trans(member_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_trans_month_year ON monthly_trans(month, year)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_trans_member_month_year ON monthly_trans(member_id, month, year)`);

    // Commodity table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_commodity_member_id ON commodity(member_id)`);

    // Shares table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_member_id ON shares(member_id)`);

    // Loan repayments table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_loan_repayments_member_id ON loan_repayments(member_id)`);

    // Deduction narrations table
    await client.query(`CREATE INDEX IF NOT EXISTS idx_deduction_narrations_member_month_year ON deduction_narrations(member_id, month, year)`);

    // Balance column configuration (fixed built-ins + admin-defined custom ones)
    await client.query(`
      CREATE TABLE IF NOT EXISTS balance_columns (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        label VARCHAR(200) NOT NULL,
        type VARCHAR(20) DEFAULT 'custom',
        enabled BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Custom / "other" balance values per member (fixed columns are computed live)
    await client.query(`
      CREATE TABLE IF NOT EXISTS member_custom_balances (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        column_key VARCHAR(100) NOT NULL,
        amount NUMERIC(15,2) DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(member_id, column_key)
      );
    `);

    // Seed the five fixed columns (idempotent)
    await client.query(`
      INSERT INTO balance_columns (key, label, type, enabled, sort_order) VALUES
        ('savings',       'Savings',       'fixed', TRUE, 1),
        ('shares',        'Shares',        'fixed', TRUE, 2),
        ('loans',         'Loan Balance',  'fixed', TRUE, 3),
        ('loan_interest', 'Loan Interest', 'fixed', TRUE, 4),
        ('commodity',     'Commodity',     'fixed', TRUE, 5)
      ON CONFLICT (key) DO NOTHING;
    `);

    // Add description to loan_repayments (for custom repayment narration)
    await client.query(`
      ALTER TABLE loan_repayments ADD COLUMN IF NOT EXISTS description TEXT;
    `);

    // Monthly per-member custom deduction amounts (Form Fee, Other Charges, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_deductions (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        column_key VARCHAR(100) NOT NULL,
        amount NUMERIC(15,2) DEFAULT 0,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(member_id, column_key, month, year)
      );
    `);

    // Per-member narration/notes for a given deduction month
    await client.query(`
      CREATE TABLE IF NOT EXISTS deduction_narrations (
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        narration TEXT,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (member_id, month, year)
      );
    `);

    // Column definitions for monthly CSV upload (auto-registered on first upload)
    await client.query(`
      CREATE TABLE IF NOT EXISTS trans_columns (
        id SERIAL PRIMARY KEY,
        key VARCHAR(200) UNIQUE NOT NULL,
        label VARCHAR(300) NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Per-member, per-column, per-month values stored from CSV upload
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_trans (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        column_key VARCHAR(200) NOT NULL,
        amount NUMERIC(15,2) DEFAULT 0,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(member_id, column_key, month, year)
      );
    `);

    // Seed the standard columns matching the CSV header format (idempotent)
    await client.query(`
      INSERT INTO trans_columns (key, label, sort_order) VALUES
        ('savings_bf',          'SAVINGS B/F',                                   1),
        ('savings_add',         'ADD: Savings during the month',                 2),
        ('savings_add_bank',    'ADD: Savings during the month (Bank)',           3),
        ('savings_withdrawal',  'LESS: Withdrawal',                              4),
        ('savings_cf',          'Net Saving C/F',                                5),
        ('loan_bal_bf',         'Loan Prin. Bal. B/F',                           6),
        ('loan_granted',        'ADD: Loan Granted this Month (auto)',            7),
        ('loan_repayment',      'LESS: Loan Principal Repayment',                8),
        ('loan_repayment_bank', 'LESS: Loan Principal Repayment (Bank)',         9),
        ('loan_ledger_bal',     'LOAN LEDGER BAL.',                             10),
        ('loan_int_bf',         'Loan Interest Balance B/F',                    11),
        ('loan_int_charged',    'ADD:Interest charged on loan granted this month:',12),
        ('loan_int_paid',       'LESS: Loan Interest paid this month',          13),
        ('loan_int_paid_bank',  'LESS: Loan Interest Paid  (Bank)',             14),
        ('loan_int_cf',         'Loan Interest Balance C/F',                    15),
        ('comm_bal_bf',         'Commodity Sales Bal. B/F',                     16),
        ('comm_add',            'ADD: Comm. Sales During the Month',            17),
        ('comm_repayment',      'LESS: Commodity Sales Repayment ',             18),
        ('comm_repayment_bank', 'LESS: Comm. Sales Repay. (Bank)',              19),
        ('comm_bal_cf',         'COMM.  SALES BAL. C/F',                        20),
        ('form',                'FORM',                                         21),
        ('other_charges',       'OTHER CHARGES',                                22),
        ('total_deduction',     'TOTAL DEDUCTION',                              23)
      ON CONFLICT (key) DO NOTHING;
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
