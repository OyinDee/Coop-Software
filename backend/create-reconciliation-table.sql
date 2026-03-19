-- Create table for storing reconciliation data from payroll
CREATE TABLE IF NOT EXISTS reconciliation_data (
    id SERIAL PRIMARY KEY,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    data JSONB NOT NULL, -- stores staff_no -> actual_deducted_amount mapping
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(month, year)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_reconciliation_month_year ON reconciliation_data(month, year);

-- Add comment
COMMENT ON TABLE reconciliation_data IS 'Stores actual deduction amounts returned from payroll for reconciliation';
COMMENT ON COLUMN reconciliation_data.data IS 'JSON object mapping staff numbers to actual deducted amounts';