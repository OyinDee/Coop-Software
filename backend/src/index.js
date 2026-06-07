require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const loanRoutes = require('./routes/loans');
const savingsRoutes = require('./routes/savings');
const dashboardRoutes = require('./routes/dashboard');
const transactionRoutes = require('./routes/transactions');
const commodityRoutes = require('./routes/commodity');
const settingsRoutes   = require('./routes/settings');
const balancesRoutes   = require('./routes/balances');
const deductionsRoutes = require('./routes/deductions');
const adminRoutes      = require('./routes/admin');
const migrate = require('./db/migrate');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const schemaReady = migrate();

app.use(async (req, res, next) => {
  try {
    await schemaReady;
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/commodity', commodityRoutes);
app.use('/api/settings',    settingsRoutes);
app.use('/api/balances',    balancesRoutes);
app.use('/api/deductions',  deductionsRoutes);
app.use('/api/admin',       adminRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Local dev: start server. On Vercel, the app is exported as a serverless function.
if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 5000;
  schemaReady
    .then(() => app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`)))
    .catch((err) => {
      console.error('Failed to initialize schema', err);
      process.exit(1);
    });
}

module.exports = app;
