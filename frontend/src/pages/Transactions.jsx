import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import { fmtNGN } from '../utils/format';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function Transactions() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/transactions', { params: { month, year } }),
      api.get('/transactions/monthly-report', { params: { month, year } }),
    ]).then(([tr, sr]) => {
      setData(tr.data.transactions);
      setSummary(sr.data);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [month, year]);

  const exportCSV = () => {
    let csv = `Monthly Transactions — ${MONTHS[month - 1]} ${year}\n\n`;
    csv += 'Ledger No,Member,Savings,Savings Status,Shares,Commodity,Loan Principal Due,Loan Interest Due\n';
    data.forEach((r) => {
      const savStatus = r.savings_carried ? 'carried fwd' : (parseFloat(r.savings) > 0 ? 'recorded' : 'none');
      csv += `${r.ledger_no},"${r.full_name}",${r.savings},${savStatus},${r.shares},${r.commodity},${r.loan_principal_due},${r.loan_interest_due}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `transactions-${year}-${String(month).padStart(2, '0')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Layout
      title="Monthly Transactions"
      actions={
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <polyline points="21 15 21 19 3 19 3 15" /><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 8 12 3 17 8" />
          </svg>
          Export CSV
        </button>
      }
    >
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Reports</div>
          <div className="page-title">Monthly Transactions</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select className="form-input" style={{ width: 140 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input className="form-input" type="number" style={{ width: 90 }} value={year} onChange={(e) => setYear(Number(e.target.value))} min="2000" max="2100" />
        </div>
      </div>

      {summary && (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          <div className="stat-card green">
            <div className="stat-label">Total Savings</div>
            <div className="stat-value">{fmtNGN(summary.totalSavings)}</div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">Loan Repayments</div>
            <div className="stat-value">{fmtNGN(summary.totalLoanPrincipal)}</div>
          </div>
          <div className="stat-card amber">
            <div className="stat-label">Interest Collected</div>
            <div className="stat-value">{fmtNGN(summary.totalLoanInterest)}</div>
          </div>
          <div className="stat-card blue">
            <div className="stat-label">Commodity</div>
            <div className="stat-value">{fmtNGN(summary.totalCommodity)}</div>
          </div>
        </div>
      )}

      <div style={{
        background: 'rgba(200,168,75,.06)', border: '1px solid rgba(200,168,75,.2)',
        borderRadius: 4, padding: '12px 18px', marginBottom: 14,
        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)',
        letterSpacing: 1,
      }}>
        {MONTHS[month - 1].toUpperCase()} {year}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Ledger No</th><th>Member</th><th>Savings</th><th>Shares</th>
                  <th>Commodity</th><th>Loan Principal</th><th>Loan Interest</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={i}>
                    <td className="td-mono td-gold">{r.ledger_no}</td>
                    <td>{r.full_name}</td>
                    <td style={{ color: parseFloat(r.savings) > 0 ? 'var(--green)' : 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {parseFloat(r.savings) > 0 ? fmtNGN(r.savings) : '—'}
                      {r.savings_carried && <span className="badge badge-warning" style={{ marginLeft: 6 }}>fwd</span>}
                    </td>
                    <td className={parseFloat(r.shares) > 0 ? '' : 'td-muted'} style={{ color: parseFloat(r.shares) > 0 ? 'var(--blue)' : undefined }}>{parseFloat(r.shares) > 0 ? fmtNGN(r.shares) : '—'}</td>
                    <td className={parseFloat(r.commodity) > 0 ? '' : 'td-muted'} style={{ color: parseFloat(r.commodity) > 0 ? 'var(--blue)' : undefined }}>{parseFloat(r.commodity) > 0 ? fmtNGN(r.commodity) : '—'}</td>
                    <td className={parseFloat(r.loan_principal_due) > 0 ? 'td-red' : 'td-muted'}>{parseFloat(r.loan_principal_due) > 0 ? fmtNGN(r.loan_principal_due) : '—'}</td>
                    <td className={parseFloat(r.loan_interest_due) > 0 ? 'td-amber' : 'td-muted'}>{parseFloat(r.loan_interest_due) > 0 ? fmtNGN(r.loan_interest_due) : '—'}</td>
                  </tr>
                ))}
                {data.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No transactions for this period</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
