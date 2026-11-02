import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const CURRENT_MONTH = new Date().getMonth() + 1;
const CURRENT_YEAR = new Date().getFullYear();

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function transactionRows(summary) {
  if (!summary) return [];
  return [
    { label: 'Savings added', value: summary.savings_add + summary.savings_add_bank },
    { label: 'Savings withdrawn', value: summary.savings_withdrawal },
    { label: 'Loan granted', value: summary.loan_granted },
    { label: 'Loan repayment', value: summary.loan_repayment + summary.loan_repayment_bank },
    { label: 'Loan interest charged', value: summary.loan_int_charged },
    { label: 'Loan interest paid', value: summary.loan_int_paid + summary.loan_int_paid_bank },
    { label: 'Commodity added', value: summary.comm_add },
    { label: 'Commodity repayment', value: summary.comm_repayment + summary.comm_repayment_bank },
    { label: 'Form fee', value: summary.form },
    { label: 'Other charges', value: summary.other_charges },
  ].filter((row) => row.value !== 0);
}

export default function MemberPortal() {
  const toast = useToast();
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      await api.post('/portal/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      toast('Password updated');
    } catch (err) {
      toast(err.response?.data?.error || 'Could not update password', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/portal/monthly', { params: { month, year } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Could not load your statement'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, year]);

  const member = data?.member;
  const summary = data?.summary;
  const rows = transactionRows(summary);

  const balances = [
    { label: 'Savings balance', value: summary?.savings_cf, className: 'td-green' },
    { label: 'Loan balance', value: summary?.loan_ledger_bal, className: 'td-red' },
    { label: 'Interest due', value: summary?.loan_int_cf, className: 'td-amber' },
    { label: 'Commodity balance', value: summary?.comm_bal_cf, className: 'td-gold' },
  ];

  return (
    <Layout
      variant="member"
      title="My Account"
      actions={(
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ height: 34, minWidth: 120 }}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
          <input
            className="form-input"
            type="number"
            min="2000"
            max="9999"
            style={{ height: 34, width: 92 }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value || CURRENT_YEAR))}
          />
        </div>
      )}
    >
      <div className="page-header">
        <div>
          <div className="page-eyebrow">{member?.ledger_no ? `Ledger ${member.ledger_no}` : 'Member statement'}</div>
          <div className="page-title">{MONTH_NAMES[month - 1]} {year} Statement</div>
        </div>
      </div>

      {error && (
        <div className="info-box" style={{ borderColor: 'rgba(241,96,96,.4)', color: 'var(--red)', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading your statement…</div>
      ) : !summary ? (
        <div className="info-box">Data for {MONTH_NAMES[month - 1]} {year} is not available yet.</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>Member</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>Name</div>
                <div style={{ overflowWrap: 'anywhere' }}>{member?.full_name}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>Ledger No</div>
                <div className="td-mono td-gold">{member?.ledger_no}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>Staff No</div>
                <div className="td-mono">{member?.staff_no || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>Email</div>
                <div style={{ overflowWrap: 'anywhere' }}>{member?.email || '—'}</div>
              </div>
            </div>
          </div>

          {!data.hasData || rows.length === 0 ? (
            <div className="info-box">Data for {MONTH_NAMES[month - 1]} {year} is not available yet.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 14, marginBottom: 20 }}>
                {balances.map((item) => (
                  <div className="card" key={item.label}>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
                      {item.label}
                    </div>
                    <div className={item.className} style={{ fontSize: 20, fontFamily: 'var(--serif)', overflowWrap: 'anywhere' }}>
                      {fmtNGN(item.value || 0)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div className="card-title" style={{ marginBottom: 4 }}>Transactions for {MONTH_NAMES[month - 1]} {year}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Total deduction this month: <strong>{fmtNGN(summary.total_deduction || 0)}</strong>
                  </div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr><th>Transaction</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan="2" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No transactions were recorded for this month.</td></tr>
                    ) : rows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td className="td-mono" style={{ textAlign: 'right' }}>{fmtNGN(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--faint)' }}>
                This is the same statement sent to your email each month. Contact the cooperative office if anything looks wrong.
              </div>
            </>
          )}

          <div className="card" style={{ marginTop: 24, maxWidth: 460 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>Change password</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              You are currently using the default password. Choose a new one to keep your statement private.
            </div>
            <form onSubmit={changePassword}>
              <div className="form-group">
                <label className="form-label">Current password</label>
                <input
                  className="form-input"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">New password</label>
                <input
                  className="form-input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={savingPassword}>
                {savingPassword ? 'Saving…' : 'Update password'}
              </button>
            </form>
          </div>
        </>
      )}
    </Layout>
  );
}
