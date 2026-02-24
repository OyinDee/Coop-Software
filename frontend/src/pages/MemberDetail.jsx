import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import api from '../api';
import { fmtNGN, fmtDate, calcLoan } from '../utils/format';
import { useToast } from '../context/ToastContext';

const LOAN_FORM = { principal: '', months: '', monthly_payment: '' };

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanForm, setLoanForm] = useState(LOAN_FORM);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({});

  const load = () => {
    setLoading(true);
    api.get(`/members/${id}`).then((r) => setData(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  // Recalculate loan preview
  useEffect(() => {
    const result = calcLoan({
      principal: loanForm.principal,
      months: loanForm.months || null,
      monthlyPayment: loanForm.monthly_payment || null,
    });
    setPreview(result);
  }, [loanForm.principal, loanForm.months, loanForm.monthly_payment]);

  const handleAddLoan = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/loans', {
        member_id: id,
        principal: loanForm.principal,
        months: loanForm.months || undefined,
        monthly_payment: loanForm.monthly_payment || undefined,
      });
      toast('Loan added'); setLoanOpen(false); setLoanForm(LOAN_FORM); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Error adding loan', 'error');
    } finally { setSaving(false); }
  };

  const handleDeleteLoan = async (loanId) => {
    if (!window.confirm('Delete this loan?')) return;
    try {
      await api.delete(`/loans/${loanId}`);
      toast('Loan deleted'); load();
    } catch { toast('Error', 'error'); }
  };

  const handleRepayment = async (loanId) => {
    const now = new Date();
    if (!window.confirm(`Record repayment for ${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}?`)) return;
    try {
      await api.post(`/loans/${loanId}/repayment`, { month: now.getMonth() + 1, year: now.getFullYear() });
      toast('Repayment recorded'); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Error', 'error');
    }
  };

  const openEditMember = () => {
    const m = data?.member;
    setEditForm({
      ledger_no: m.ledger_no || '', staff_no: m.staff_no || '', gifmis_no: m.gifmis_no || '',
      full_name: m.full_name || '', gender: m.gender || 'Male', marital_status: m.marital_status || 'Married',
      phone: m.phone || '', email: m.email || '',
      date_of_admission: m.date_of_admission ? m.date_of_admission.split('T')[0] : '',
      bank: m.bank || '', account_number: m.account_number || '', department: m.department || '',
      next_of_kin: m.next_of_kin || '', next_of_kin_relation: m.next_of_kin_relation || '',
    });
    setEditOpen(true);
  };

  const handleEditSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.put(`/members/${id}`, editForm);
      toast('Member updated'); setEditOpen(false); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Error', 'error');
    } finally { setSaving(false); }
  };

  const exportCSV = () => {
    const m = data?.member;
    const loans = data?.loans || [];
    let csv = 'Field,Value\n';
    csv += `Name,${m.full_name}\nLedger No,${m.ledger_no}\nStaff No,${m.staff_no}\n`;
    csv += `Savings,${m.total_savings}\nLoan Balance,${m.loan_balance}\nInterest Due,${m.interest_due}\n\n`;
    csv += 'Loan #,Principal,Remaining,Months,Monthly Principal,Total Interest,Monthly Interest,Status\n';
    loans.forEach((l, i) => {
      csv += `Loan ${i+1},${l.principal},${l.remaining_balance},${l.months},${l.monthly_principal},${l.total_interest},${l.monthly_interest},${l.status}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${m.ledger_no}-ledger.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Layout title="Personal Ledger"><div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading…</div></Layout>;

  const member = data?.member;
  const loans = data?.loans || [];
  const activeLoans = loans.filter((l) => l.status === 'active');
  const totalMonthlyPrincipal = activeLoans.reduce((s, l) => s + parseFloat(l.monthly_principal), 0);
  const totalMonthlyInterest = activeLoans.reduce((s, l) => s + parseFloat(l.monthly_interest), 0);

  return (
    <Layout
      title="Personal Ledger"
      actions={
        <>
          <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', fontSize: 9, letterSpacing: .5 }} onClick={() => navigate('/members')}>
            ← Members
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <polyline points="21 15 21 19 3 19 3 15" /><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 8 12 3 17 8" />
            </svg>
            Export CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setLoanOpen(true)}>
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Loan
          </button>
        </>
      }
    >
      {/* Member Hero */}
      <div className="member-hero">
        <div>
          <div className="member-name">{member.full_name}</div>
          <div className="member-meta">
            <span className="td-mono">{member.ledger_no}</span>
            {member.staff_no && <><span className="sep">·</span><span>{member.staff_no}</span></>}
            {member.bank && <><span className="sep">·</span><span>{member.bank}</span></>}
            {member.account_number && <><span className="sep">·</span><span>{member.account_number}</span></>}
            {member.department && <><span className="sep">·</span><span>{member.department}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {parseInt(member.active_loans) > 0 && (
            <span className="badge badge-red">{member.active_loans} Active Loan{member.active_loans !== '1' ? 's' : ''}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={openEditMember}>Edit</button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 14 }}>
        <div className="stat-card green" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Savings</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(member.total_savings)}</div>
        </div>
        <div className="stat-card blue" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Shares</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(member.total_shares)}</div>
        </div>
        <div className="stat-card red" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Loan Balance</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(member.loan_balance)}</div>
        </div>
        <div className="stat-card amber" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Interest Due</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(member.interest_due)}</div>
        </div>
        <div className="stat-card" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Commodity</div>
          <div className="stat-value" style={{ fontSize: 17, color: 'var(--blue)' }}>{fmtNGN(member.total_commodity)}</div>
        </div>
      </div>

      {/* Monthly deduction strip */}
      {activeLoans.length > 0 && (
        <div className="monthly-strip">
          <div>
            <div className="ms-label">Monthly Principal</div>
            <div className="ms-value" style={{ color: 'var(--text)' }}>{fmtNGN(totalMonthlyPrincipal)}</div>
          </div>
          <div>
            <div className="ms-label">Monthly Interest</div>
            <div className="ms-value" style={{ color: 'var(--amber)' }}>{fmtNGN(totalMonthlyInterest)}</div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(200,168,75,.2)', paddingLeft: 40 }}>
            <div className="ms-label">Total Deduction / Month</div>
            <div className="ms-value big">{fmtNGN(totalMonthlyPrincipal + totalMonthlyInterest)}</div>
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
            <div>{activeLoans.length} loan{activeLoans.length !== 1 ? 's' : ''} combined</div>
          </div>
        </div>
      )}

      {/* Loans table */}
      <div className="card">
        <div className="card-title">Loans ({loans.length})</div>
        {loans.length === 0 ? (
          <div style={{ color: 'var(--faint)', fontSize: 12, textAlign: 'center', paddingBottom: 8 }}>No loans</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Loan #</th><th>Principal</th><th>Remaining</th><th>Months</th>
                  <th>Paid</th><th>Monthly Principal</th><th>Total Interest (5%)</th>
                  <th>Monthly Interest</th><th>Interest Paid</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l, i) => (
                  <tr key={l.id}>
                    <td className="td-mono td-muted">Loan {i + 1}</td>
                    <td>{fmtNGN(l.principal)}</td>
                    <td className={l.status === 'active' ? 'td-red' : 'td-green'}>{fmtNGN(l.remaining_balance)}</td>
                    <td>{l.months} mo</td>
                    <td>{l.months_paid}</td>
                    <td>{fmtNGN(l.monthly_principal)}</td>
                    <td className="td-amber">{fmtNGN(l.total_interest)}</td>
                    <td className="td-amber">{fmtNGN(l.monthly_interest)}</td>
                    <td>{fmtNGN(l.interest_paid)}</td>
                    <td>
                      {l.status === 'active'
                        ? <span className="badge badge-amber">Active</span>
                        : <span className="badge badge-green">Cleared</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {l.status === 'active' && (
                          <button className="btn btn-ghost btn-sm" onClick={() => handleRepayment(l.id)}>Repay</button>
                        )}
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteLoan(l.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Breakdown note */}
            {activeLoans.length > 1 && (
              <div className="breakdown-note">
                <strong>Interest breakdown:</strong>{' '}
                {activeLoans.map((l, i) => (
                  <span key={l.id}>
                    Loan {i + 1} — <strong>{fmtNGN(l.total_interest)}</strong> (5% of {fmtNGN(l.principal)} over {l.months} months = {fmtNGN(l.monthly_interest)}/mo)
                    {i < activeLoans.length - 1 ? ' + ' : ' '}
                  </span>
                ))}
                = <strong style={{ color: 'var(--amber)' }}>{fmtNGN(activeLoans.reduce((s, l) => s + parseFloat(l.total_interest) - parseFloat(l.interest_paid), 0))} total interest outstanding</strong>
                {' '}| <strong>{fmtNGN(totalMonthlyInterest)} / month</strong> combined
              </div>
            )}
          </div>
        )}
      </div>

      {/* Member details */}
      <div className="card">
        <div className="card-title">Member Details</div>
        <div className="details-grid">
          <div className="detail-item"><div className="di-label">Email</div><div className="di-val">{member.email || '—'}</div></div>
          <div className="detail-item"><div className="di-label">Phone</div><div className="di-val">{member.phone || '—'}</div></div>
          <div className="detail-item"><div className="di-label">Gender</div><div className="di-val">{member.gender || '—'}</div></div>
          <div className="detail-item"><div className="di-label">Marital Status</div><div className="di-val">{member.marital_status || '—'}</div></div>
          <div className="detail-item"><div className="di-label">Admission Date</div><div className="di-val">{fmtDate(member.date_of_admission)}</div></div>
          <div className="detail-item"><div className="di-label">Department</div><div className="di-val">{member.department || '—'}</div></div>
          <div className="detail-item"><div className="di-label">Next of Kin</div><div className="di-val">{member.next_of_kin || '—'}</div></div>
          <div className="detail-item"><div className="di-label">Relation</div><div className="di-val">{member.next_of_kin_relation || '—'}</div></div>
          <div className="detail-item"><div className="di-label">GIFMIS No</div><div className="di-val td-mono" style={{ fontSize: 12 }}>{member.gifmis_no || '—'}</div></div>
        </div>
      </div>

      {/* Add Loan Modal */}
      {loanOpen && (
        <Modal title="Add New Loan" onClose={() => { setLoanOpen(false); setLoanForm(LOAN_FORM); }}>
          <form onSubmit={handleAddLoan}>
            <div className="info-box">
              Interest is calculated at <strong>5% of the loan principal</strong>, spread equally across all repayment months. It is tracked in the <strong>Interest</strong> column separately — not added to the principal balance.
            </div>
            <div className="form-group">
              <label className="form-label">Loan Amount (₦) *</label>
              <input
                className="form-input"
                placeholder="e.g. 500000"
                value={loanForm.principal}
                onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value, monthly_payment: '' })}
                required
              />
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: 'var(--faint)', marginBottom: 14 }}>
              ENTER EITHER MONTHS OR MONTHLY PAYMENT — NOT BOTH
            </div>
            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <div className="form-group">
                <label className="form-label">Number of Months</label>
                <input
                  className="form-input"
                  placeholder="e.g. 12"
                  value={loanForm.months}
                  onChange={(e) => setLoanForm({ ...loanForm, months: e.target.value, monthly_payment: '' })}
                />
              </div>
              <div className="or-div">OR</div>
              <div className="form-group">
                <label className="form-label">Monthly Payment (₦)</label>
                <input
                  className="form-input"
                  placeholder="e.g. 50,000"
                  value={loanForm.monthly_payment}
                  onChange={(e) => setLoanForm({ ...loanForm, monthly_payment: e.target.value, months: '' })}
                  style={{ opacity: loanForm.months ? .5 : 1 }}
                />
              </div>
            </div>

            {preview && (
              <div className="preview-box">
                <div className="preview-item">
                  <div className="pi-label">Monthly Principal</div>
                  <div className="pi-val gold">{fmtNGN(preview.monthly_principal)}</div>
                </div>
                <div className="preview-item">
                  <div className="pi-label">Monthly Interest</div>
                  <div className="pi-val amber">{fmtNGN(preview.monthly_interest)}</div>
                </div>
                <div className="preview-item">
                  <div className="pi-label">Total Interest (5%)</div>
                  <div className="pi-val amber">{fmtNGN(preview.total_interest)}</div>
                </div>
                <div className="preview-item">
                  <div className="pi-label">Total Payable</div>
                  <div className="pi-val">{fmtNGN(preview.total_payable)}</div>
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setLoanOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !preview}>
                {saving ? 'Adding…' : 'Add Loan'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Member Modal */}
      {editOpen && (
        <Modal title="Edit Member" onClose={() => setEditOpen(false)} width={520}>
          <form onSubmit={handleEditSave}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Ledger No *</label>
                <input className="form-input" value={editForm.ledger_no} onChange={(e) => setEditForm({ ...editForm, ledger_no: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Staff No</label>
                <input className="form-input" value={editForm.staff_no} onChange={(e) => setEditForm({ ...editForm, staff_no: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input className="form-input" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Bank</label>
                <input className="form-input" value={editForm.bank} onChange={(e) => setEditForm({ ...editForm, bank: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Account Number</label>
                <input className="form-input" value={editForm.account_number} onChange={(e) => setEditForm({ ...editForm, account_number: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Department</label>
                <input className="form-input" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">GIFMIS No</label>
                <input className="form-input" value={editForm.gifmis_no} onChange={(e) => setEditForm({ ...editForm, gifmis_no: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Next of Kin</label>
                <input className="form-input" value={editForm.next_of_kin} onChange={(e) => setEditForm({ ...editForm, next_of_kin: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Relation</label>
                <input className="form-input" value={editForm.next_of_kin_relation} onChange={(e) => setEditForm({ ...editForm, next_of_kin_relation: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setEditOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
