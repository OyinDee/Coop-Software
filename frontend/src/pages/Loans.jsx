import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal  from '../components/Modal';
import api    from '../api';
import { fmtNGN, fmtDate } from '../utils/format';
import { useToast } from '../context/ToastContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Repayment history + record modal ─────────────────────────────────────────
function RepaymentModal({ loanId, onClose, onRefresh }) {
  const toast = useToast();
  const now   = new Date();

  const [loan,       setLoan]       = useState(null);
  const [repayments, setRepayments] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [useCustom,    setUseCustom]    = useState(false);
  const [principalAmt, setPrincipalAmt] = useState('');
  const [interestAmt,  setInterestAmt]  = useState('');
  const [description,  setDescription]  = useState('');
  const [repMonth,     setRepMonth]     = useState(now.getMonth() + 1);
  const [repYear,      setRepYear]      = useState(now.getFullYear());

  const fetchData = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/loans/${loanId}/repayments`);
      setLoan(r.data.loan);
      setRepayments(r.data.repayments);
      // Pre-fill form with scheduled amounts
      setPrincipalAmt(parseFloat(r.data.loan.monthly_principal).toFixed(2));
      setInterestAmt(parseFloat(r.data.loan.monthly_interest).toFixed(2));
    } catch (err) {
      toast(err.response?.data?.error || 'Error loading repayments', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [loanId]);

  const handleRecord = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        month: repMonth,
        year:  repYear,
        description: description || undefined,
      };
      if (loan?.status === 'cleared') {
        // Interest-only payment
        payload.interest_paid = parseFloat(interestAmt) || 0;
      } else if (useCustom) {
        payload.principal_paid = parseFloat(principalAmt) || 0;
        payload.interest_paid  = parseFloat(interestAmt)  || 0;
      }
      await api.post(`/loans/${loanId}/repayment`, payload);
      toast('Repayment recorded');
      setDescription('');
      await fetchData();
      onRefresh();
    } catch (err) {
      toast(err.response?.data?.error || 'Error recording repayment', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const scheduledRepayment = loan
    ? parseFloat(loan.monthly_principal) + parseFloat(loan.monthly_interest)
    : 0;

  return (
    <Modal
      title={loan ? `Repayments — ${loan.full_name}` : 'Loan Repayments'}
      onClose={onClose}
      width={660}
    >
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : loan ? (
        <>
          {/* Loan summary */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10,
            background: 'var(--surface-alt, rgba(0,0,0,.03))', borderRadius: 6,
            padding: '12px 14px', marginBottom: 20, border: '1px solid var(--border)',
          }}>
            {[
              { label: 'Opening Bal.',    value: fmtNGN(loan.principal) },
              { label: 'Remaining',     value: fmtNGN(loan.remaining_balance), red: true },
              { label: 'Monthly (Sched.)', value: fmtNGN(scheduledRepayment) },
              { label: 'Status',        value: loan.status === 'active' ? 'Active' : 'Cleared',
                color: loan.status === 'active' ? 'var(--amber)' : 'var(--green)' },
            ].map(({ label, value, red, color }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>{label.toUpperCase()}</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13, color: red ? 'var(--red)' : color || 'var(--text)' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Record new repayment */}
          {(loan.status === 'active' || parseFloat(loan.interest_paid) < parseFloat(loan.total_interest)) && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
                {loan.status === 'cleared' ? 'Record Interest Payment' : 'Record Repayment'}
              </div>
              <form onSubmit={handleRecord}>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 120 }}>
                    <label className="form-label">Month</label>
                    <select className="form-input" value={repMonth} onChange={(e) => setRepMonth(Number(e.target.value))}>
                      {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 80 }}>
                    <label className="form-label">Year</label>
                    <input className="form-input" type="number" min="2000" max="2100" value={repYear}
                      onChange={(e) => setRepYear(Number(e.target.value))} />
                  </div>
                </div>

                {loan.status === 'cleared' ? (
                  // Interest-only form for cleared loans
                  <>
                    <div className="info-box" style={{ marginBottom: 12, fontSize: 12 }}>
                      Principal is fully repaid. Recording interest payment only.
                      Remaining interest: <strong>{fmtNGN(parseFloat(loan.total_interest) - parseFloat(loan.interest_paid))}</strong>
                    </div>
                    <div className="form-group" style={{ margin: 0, marginBottom: 12 }}>
                      <label className="form-label">Interest Paid (₦)</label>
                      <input className="form-input" type="number" min="0" step="0.01"
                        value={interestAmt} onChange={(e) => setInterestAmt(e.target.value)} required />
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                      <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
                      Use custom amount (different from scheduled)
                    </label>

                    {useCustom && (
                      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                        <div className="form-group" style={{ margin: 0, flex: 1 }}>
                          <label className="form-label">Repayment Amount (₦)</label>
                          <input className="form-input" type="number" min="0" step="0.01"
                            value={principalAmt} onChange={(e) => setPrincipalAmt(e.target.value)} required />
                        </div>
                        <div className="form-group" style={{ margin: 0, flex: 1 }}>
                          <label className="form-label">Interest Paid (₦)</label>
                          <input className="form-input" type="number" min="0" step="0.01"
                            value={interestAmt} onChange={(e) => setInterestAmt(e.target.value)} required />
                        </div>
                      </div>
                    )}

                    {!useCustom && (
                      <div className="info-box" style={{ marginBottom: 12, fontSize: 12 }}>
                        Will deduct scheduled amounts: <strong>{fmtNGN(loan.monthly_principal)}</strong> repayment
                        + <strong>{fmtNGN(loan.monthly_interest)}</strong> interest.
                      </div>
                    )}
                  </>
                )}

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Description / Narration</label>
                  <input className="form-input" type="text"
                    placeholder="e.g. Partial payment, cheque #1234…"
                    value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>

                <div style={{ marginTop: 12 }}>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Recording…' : 'Record Repayment'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Repayment history */}
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
            Repayment History ({repayments.length})
          </div>
          {repayments.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No repayments recorded yet.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th style={{ textAlign: 'right' }}>Repayment</th>
                    <th style={{ textAlign: 'right' }}>Interest</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {repayments.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {MONTHS[r.month - 1]} {r.year}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtNGN(r.principal_paid)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{fmtNGN(r.interest_paid)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {fmtNGN(parseFloat(r.principal_paid) + parseFloat(r.interest_paid))}
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{r.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmtNGN(repayments.reduce((s, r) => s + parseFloat(r.principal_paid), 0))}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--amber)' }}>
                      {fmtNGN(repayments.reduce((s, r) => s + parseFloat(r.interest_paid), 0))}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmtNGN(repayments.reduce((s, r) => s + parseFloat(r.principal_paid) + parseFloat(r.interest_paid), 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Modal>
  );
}

// ── Main Loans page ───────────────────────────────────────────────────────────
export default function Loans() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.get('/loans').then((r) => setLoans(r.data.loans)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const totals = loans.reduce((acc, l) => ({
    balance: acc.balance + parseFloat(l.remaining_balance),
    interest: acc.interest + parseFloat(l.total_interest) - parseFloat(l.interest_paid),
    monthly_repayment: acc.monthly_repayment + parseFloat(l.monthly_principal) + parseFloat(l.monthly_interest),
    monthly_i: acc.monthly_i + parseFloat(l.monthly_interest),
  }), { balance: 0, interest: 0, monthly_repayment: 0, monthly_i: 0 });

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
          <div className="stat-label">Monthly Repayment</div>
          <div className="stat-value" style={{ color: 'var(--text)' }}>{fmtNGN(totals.monthly_repayment)}</div>
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
                  <th>Member</th><th>Ledger No</th><th>Principal B/F</th><th>Remaining</th>
                  <th>Monthly Repayment</th>
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
                    <td>{fmtNGN(parseFloat(l.monthly_principal) + parseFloat(l.monthly_interest))}</td>
                    <td className="td-amber">{fmtNGN(l.total_interest)}</td>
                    <td className="td-amber">{fmtNGN(l.monthly_interest)}</td>
                    <td className="td-green">{fmtNGN(l.interest_paid)}</td>
                    <td className="td-muted" style={{ fontSize: 11 }}>{fmtDate(l.date_issued)}</td>
                    <td><span className={`badge badge-${l.status === 'active' ? 'amber' : 'red'}`}>
                      {l.status === 'active' ? 'Active' : 'Int. Due'}
                    </span></td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setSelectedLoanId(l.id)}
                        title="View repayment history / record repayment"
                      >
                        Repayments
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/ledger/${l.member_id}`)}>
                        Ledger
                      </button>
                    </td>
                  </tr>
                ))}
                {loans.length === 0 && (
                  <tr><td colSpan="12" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No active loans</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedLoanId && (
        <RepaymentModal
          loanId={selectedLoanId}
          onClose={() => setSelectedLoanId(null)}
          onRefresh={load}
        />
      )}
    </Layout>
  );
}
