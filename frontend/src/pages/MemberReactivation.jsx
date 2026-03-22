import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

export default function MemberReactivation() {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reactivating, setReactivating] = useState(null);

  const REASONS = {
    loan_complete: 'Loan duration expired (0 months remaining)',
  };

  useEffect(() => {
    fetchDeactivated();
  }, []);

  const fetchDeactivated = async () => {
    setLoading(true);
    try {
      const r = await api.get('/members/deactivated');
      setMembers(r.data.deactivated);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to load deactivated members', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async (id, name) => {
    if (!window.confirm(`Reactivate ${name}? They will be able to make new transactions.`)) return;

    setReactivating(id);
    try {
      await api.put(`/members/${id}/reactivate`);
      toast(`${name} reactivated successfully`);
      setMembers(members.filter(m => m.id !== id));
    } catch (err) {
      toast(err.response?.data?.error || 'Reactivation failed', 'error');
    } finally {
      setReactivating(null);
    }
  };

  return (
    <Layout title="Member Reactivation">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Administration</div>
          <div className="page-title">Member Reactivation</div>
        </div>
      </div>

      <div className="info-box" style={{ marginBottom: 18 }}>
        <strong>Deactivated members:</strong> Members are automatically deactivated when their loan duration expires (0 months remaining)
        during CSV upload. Their balances are still counted in cooperative totals, but they don't appear in Member Balances or Deductions pages
        and cannot have new transactions recorded. Click <strong>Reactivate</strong> to allow them to make transactions again.
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : members.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            No deactivated members found.
          </div>
        ) : (
          <>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
              {members.length} member{members.length !== 1 ? 's' : ''} deactivated
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 110 }}>Ledger No</th>
                    <th style={{ minWidth: 210 }}>Full Name</th>
                    <th style={{ minWidth: 150 }}>Reason</th>
                    <th style={{ minWidth: 120, textAlign: 'right' }}>Outstanding Loan</th>
                    <th style={{ minWidth: 120, textAlign: 'right' }}>Interest Due</th>
                    <th style={{ minWidth: 120, textAlign: 'right' }}>Savings Balance</th>
                    <th style={{ minWidth: 100 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)' }}>
                          {m.ledger_no}
                        </span>
                      </td>
                      <td>{m.full_name}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {REASONS[m.deactivation_reason] || m.deactivation_reason || '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {fmtNGN(m.outstanding_loan || 0)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {fmtNGN(m.outstanding_interest || 0)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {fmtNGN(m.total_savings || 0)}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleReactivate(m.id, m.full_name)}
                          disabled={reactivating === m.id}
                        >
                          {reactivating === m.id ? 'Reactivating…' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
