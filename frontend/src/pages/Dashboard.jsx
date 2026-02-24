import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import { fmtNGN } from '../utils/format';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard').then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Layout title="Dashboard"><div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div></Layout>;

  return (
    <Layout
      title="Dashboard"
      actions={
        <button className="btn btn-ghost btn-sm">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <polyline points="21 15 21 19 3 19 3 15" /><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 8 12 3 17 8" />
          </svg>
          Export
        </button>
      }
    >
      {/* Stat cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Members</div>
          <div className="stat-value">{data?.totalMembers ?? 0}</div>
          <div className="stat-sub">Registered ↑ {data?.newThisMonth ?? 0} this month</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Total Savings</div>
          <div className="stat-value">{fmtNGN(data?.totalSavings)}</div>
          <div className="stat-sub">Cumulative balance</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Loan Outstanding</div>
          <div className="stat-value">{fmtNGN(data?.loanOutstanding)}</div>
          <div className="stat-sub">Active loan balances</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Interest Due</div>
          <div className="stat-value">{fmtNGN(data?.interestDue)}</div>
          <div className="stat-sub">Unpaid interest</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Active loans */}
        <div className="card">
          <div className="card-title">
            Members with Active Loans
            <span className="badge badge-red">{(data?.activeLoans ?? []).length} shown</span>
          </div>
          {(data?.activeLoans ?? []).map((m) => (
            <div className="mini-row" key={m.ledger_no}>
              <div>
                <div className="mr-name">{m.full_name}</div>
                <div className="mr-sub">{m.ledger_no} · {m.loan_count} loan{m.loan_count !== '1' ? 's' : ''}</div>
              </div>
              <div>
                <div className="mr-val td-red">{fmtNGN(m.loan_balance)}</div>
                <div className="mr-sub" style={{ textAlign: 'right' }}>+{fmtNGN(m.interest_due)} int.</div>
              </div>
            </div>
          ))}
          {(data?.activeLoans ?? []).length === 0 && <div style={{ color: 'var(--faint)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No active loans</div>}
        </div>

        {/* Top savers */}
        <div className="card">
          <div className="card-title">
            Top Savers
            <span className="badge badge-green">{data?.totalMembers ?? 0} members</span>
          </div>
          {(data?.topSavers ?? []).map((m) => (
            <div className="mini-row" key={m.ledger_no}>
              <div>
                <div className="mr-name">{m.full_name}</div>
                <div className="mr-sub">{m.ledger_no}</div>
              </div>
              <div className="mr-val td-green">{fmtNGN(m.total_savings)}</div>
            </div>
          ))}
          {(data?.topSavers ?? []).length === 0 && <div style={{ color: 'var(--faint)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No savings data</div>}
        </div>
      </div>
    </Layout>
  );
}
