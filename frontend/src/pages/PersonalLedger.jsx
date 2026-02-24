import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../api';
import { fmtNGN } from '../utils/format';

export default function PersonalLedger() {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = (q = '') => {
    setLoading(true);
    api.get('/members', { params: q ? { search: q } : {} })
      .then((r) => { setMembers(r.data.members); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <Layout title="Personal Ledger">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Select a member</div>
          <div className="page-title">Personal Ledger</div>
        </div>
      </div>

      <div className="search-bar">
        <svg width="14" height="14" fill="none" stroke="var(--faint)" strokeWidth="1.8" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          placeholder="Search member…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)' }}>{total} members</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ledger No</th><th>Name</th><th>Staff No</th><th>Department</th>
                <th>Savings</th><th>Loan Balance</th><th>Interest Due</th><th>Loans</th><th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/ledger/${m.id}`)}>
                  <td className="td-mono td-gold">{m.ledger_no}</td>
                  <td>{m.full_name}</td>
                  <td className="td-muted td-mono" style={{ fontSize: 11 }}>{m.staff_no || '—'}</td>
                  <td className="td-muted">{m.department || '—'}</td>
                  <td className="td-green">{parseFloat(m.total_savings) > 0 ? fmtNGN(m.total_savings) : '—'}</td>
                  <td className={parseFloat(m.loan_balance) > 0 ? 'td-red' : 'td-muted'}>{parseFloat(m.loan_balance) > 0 ? fmtNGN(m.loan_balance) : '—'}</td>
                  <td className={parseFloat(m.interest_due) > 0 ? 'td-amber' : 'td-muted'}>{parseFloat(m.interest_due) > 0 ? fmtNGN(m.interest_due) : '—'}</td>
                  <td>{parseInt(m.active_loans) > 0 ? <span className="badge badge-amber">{m.active_loans} active</span> : <span className="badge badge-green">Clear</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/ledger/${m.id}`); }}>Open</button></td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan="9" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No members found</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
