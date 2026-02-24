import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../api';
import { fmtNGN, fmtDate } from '../utils/format';

export default function Loans() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.get('/loans').then((r) => setLoans(r.data.loans)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const totals = loans.reduce((acc, l) => ({
    balance: acc.balance + parseFloat(l.remaining_balance),
    interest: acc.interest + parseFloat(l.total_interest) - parseFloat(l.interest_paid),
    monthly_p: acc.monthly_p + parseFloat(l.monthly_principal),
    monthly_i: acc.monthly_i + parseFloat(l.monthly_interest),
  }), { balance: 0, interest: 0, monthly_p: 0, monthly_i: 0 });

  return (
    <Layout title="Loans">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Active</div>
          <div className="page-title">Loans</div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card red">
          <div className="stat-label">Total Outstanding</div>
          <div className="stat-value">{fmtNGN(totals.balance)}</div>
          <div className="stat-sub">{loans.length} active loans</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Interest Due</div>
          <div className="stat-value">{fmtNGN(totals.interest)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Monthly Principal</div>
          <div className="stat-value" style={{ color: 'var(--text)' }}>{fmtNGN(totals.monthly_p)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Monthly Interest</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{fmtNGN(totals.monthly_i)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Member</th><th>Ledger No</th><th>Principal</th><th>Remaining</th>
                  <th>Months</th><th>Paid</th><th>Monthly Principal</th>
                  <th>Total Interest</th><th>Monthly Interest</th><th>Interest Paid</th>
                  <th>Date Issued</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td>{l.full_name}</td>
                    <td className="td-mono td-gold">{l.ledger_no}</td>
                    <td>{fmtNGN(l.principal)}</td>
                    <td className="td-red">{fmtNGN(l.remaining_balance)}</td>
                    <td>{l.months} mo</td>
                    <td className="td-muted">{l.months_paid}</td>
                    <td>{fmtNGN(l.monthly_principal)}</td>
                    <td className="td-amber">{fmtNGN(l.total_interest)}</td>
                    <td className="td-amber">{fmtNGN(l.monthly_interest)}</td>
                    <td className="td-green">{fmtNGN(l.interest_paid)}</td>
                    <td className="td-muted" style={{ fontSize: 11 }}>{fmtDate(l.date_issued)}</td>
                    <td><span className="badge badge-amber">Active</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/ledger/${l.member_id}`)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {loans.length === 0 && (
                  <tr><td colSpan="13" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No active loans</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
