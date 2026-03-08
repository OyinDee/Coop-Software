import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import api from '../api';
import { fmtNGN, fmtDate, calcLoan } from '../utils/format';
import { useToast } from '../context/ToastContext';

const LOAN_FORM = { principal: '', months: '', monthly_payment: '' };
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// â”€â”€ Ledger table cell â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Amt({ v, red, amber, green, muted }) {
  if (v === 0) return <span style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 11 }}>â€”</span>;
  const color = red ? 'var(--red)' : amber ? 'var(--amber)' : green ? '#3cb371' : muted ? 'var(--muted)' : 'var(--text)';
  return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color }}>{fmtNGN(v)}</span>;
}

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
  const [loanRate, setLoanRate] = useState(0.05);

  // Ledger state
  const [ledger, setLedger]       = useState(null);
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear());
  const [ledgerLoading, setLedgerLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get(`/members/${id}`).then((r) => setData(r.data)).finally(() => setLoading(false));
  };

  const loadLedger = (yr) => {
    setLedgerLoading(true);
    api.get(`/members/${id}/ledger`, { params: { year: yr } })
      .then((r) => setLedger(r.data))
      .catch(() => setLedger(null))
      .finally(() => setLedgerLoading(false));
  };

  useEffect(() => { load(); }, [id]);
  useEffect(() => { loadLedger(ledgerYear); }, [id, ledgerYear]);

  useEffect(() => {
    api.get('/settings').then((r) => {
      const rateVal = parseFloat(r.data.settings.loan_interest_rate ?? 5);
      setLoanRate(rateVal / 100);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const result = calcLoan({
      principal: loanForm.principal,
      months: loanForm.months || null,
      monthlyPayment: loanForm.monthly_payment || null,
      rate: loanRate,
    });
    setPreview(result);
  }, [loanForm.principal, loanForm.months, loanForm.monthly_payment, loanRate]);

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

  const exportLedgerCSV = () => {
    if (!ledger || !data) return;
    const m = data.member;
    const { rows, bf, summary } = ledger;
    const headers = [
      'DATE',
      'REFUND/WITHDRAWAL','SAVINGS','SAVINGS (BANK)',
      'SHARES','SHARES (BANK)',
      'LOAN GRANTED','INTEREST CHARGED','MONTHLY REPAYMENT','MON. PAYMENT (BANK)','INTEREST PAID',
      'COMM. & GADGETS','REPAYMENT','REPAYMENT (BANK)',
      'FORM & BOND','OTHER CHARGES','TOTAL DEDUCTION',
    ];
    const fmt = (v) => (v || 0).toFixed(2);
    const bfRow = ['BAL B/F', fmt(bf.savings_bf), '0', fmt(bf.savings_bank_bf),
      fmt(bf.shares_bf), '0', '0', '0', '0', '0', '0',
      fmt(bf.comm_bal_bf), '0', '0', '0', '0', '0'];
    const dataRows = rows.map((r) => [
      `${MONTH_LABELS[r.month - 1]}. ${ledgerYear}`,
      fmt(r.savings_withdrawal), fmt(r.savings_add), fmt(r.savings_add_bank),
      fmt(r.shares), fmt(r.shares_bank),
      fmt(r.loan_granted), fmt(r.loan_int_charged), fmt(r.loan_repayment), fmt(r.loan_repayment_bank), fmt(r.loan_int_paid),
      fmt(r.comm_add), fmt(r.comm_repayment), fmt(r.comm_repayment_bank),
      fmt(r.form), fmt(r.other_charges), fmt(r.total_deduction),
    ]);
    const csv = [headers, bfRow, ...dataRows].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${m.ledger_no}-ledger-${ledgerYear}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <Layout title="Personal Ledger"><div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loadingâ€¦</div></Layout>;

  const member = data?.member;
  const loans = data?.loans || [];
  const activeLoans = loans.filter((l) => l.status === 'active');
  const totalMonthlyPrincipal = activeLoans.reduce((s, l) => s + parseFloat(l.monthly_principal), 0);
  const totalMonthlyInterest = activeLoans.reduce((s, l) => s + parseFloat(l.monthly_interest), 0);
  const displayRatePct = Math.round(loanRate * 1000) / 10;

  // Ledger totals
  const ledgerRows  = ledger?.rows || [];
  const ledgerBF    = ledger?.bf || {};
  const ledgerSumm  = ledger?.summary || {};
  const availYears  = ledger?.availableYears || [];
  const colSum = (key) => ledgerRows.reduce((s, r) => s + (r[key] || 0), 0);
  const now = new Date();
  const nowLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

  // Column definitions for ledger table
  const LEDGER_COLS = [
    { key: 'savings_withdrawal',  label: 'REFUND/\nWITHDRAWAL', group: 'SAVINGS',         red: true },
    { key: 'savings_add',         label: 'SAVINGS',              group: 'SAVINGS',         green: true },
    { key: 'savings_add_bank',    label: 'SAVINGS\n(BANK)',       group: 'SAVINGS',         green: true },
    { key: 'shares',              label: 'SHARES',               group: 'SHARES',          green: true },
    { key: 'shares_bank',         label: 'SHARES\n(BANK)',        group: 'SHARES',          green: true },
    { key: 'loan_granted',        label: 'LOAN\nGRANTED',        group: 'LOANS',           amber: true },
    { key: 'loan_int_charged',    label: 'INTEREST\nCHARGED',    group: 'LOANS',           red: true },
    { key: 'loan_repayment',      label: 'MONTHLY\nREPAYMENT',   group: 'LOANS' },
    { key: 'loan_repayment_bank', label: 'MON. PAYMENT\n(BANK)', group: 'LOANS',           muted: true },
    { key: 'loan_int_paid',       label: 'INTEREST\nPAID',       group: 'LOANS',           amber: true },
    { key: 'comm_add',            label: 'COMM. &\nGADGETS',     group: 'COMMODITY',       amber: true },
    { key: 'comm_repayment',      label: 'REPAYMENT',            group: 'COMMODITY' },
    { key: 'comm_repayment_bank', label: 'REPAYMENT\n(BANK)',     group: 'COMMODITY',       muted: true },
    { key: 'form',                label: 'FORM &\nBOND',         group: 'OTHERS' },
    { key: 'other_charges',       label: 'OTHER\nCHARGES',       group: 'OTHERS' },
    { key: 'total_deduction',     label: 'TOTAL\nDEDUCTION',     group: 'TOTAL DEDUCTION', bold: true },
  ];

  // B/F values per column
  const BF_MAP = {
    savings_withdrawal: null,
    savings_add:        ledgerBF.savings_bf,
    savings_add_bank:   ledgerBF.savings_bank_bf,
    shares:             ledgerBF.shares_bf,
    shares_bank:        null,
    loan_granted:       ledgerBF.loan_bal_bf,
    loan_int_charged:   ledgerBF.loan_int_bf,
    loan_repayment:     null,
    loan_repayment_bank:null,
    loan_int_paid:      null,
    comm_add:           ledgerBF.comm_bal_bf,
    comm_repayment:     null,
    comm_repayment_bank:null,
    form:               null,
    other_charges:      null,
    total_deduction:    null,
  };

  // Group spans
  const groups = [
    { label: 'SAVINGS',              span: 3 },
    { label: 'SHARES',               span: 2 },
    { label: 'LOANS',                span: 5 },
    { label: 'COMMODITY & GADGET',   span: 3 },
    { label: 'OTHERS',               span: 2 },
    { label: 'TOTAL DEDUCTION',      span: 1 },
  ];

  const thStyle = {
    background: 'var(--surface-alt, rgba(0,0,0,.06))',
    fontSize: 9, fontWeight: 700, textAlign: 'center',
    padding: '5px 6px', letterSpacing: .5, whiteSpace: 'pre-line',
    border: '1px solid var(--border)', minWidth: 80,
  };
  const tdStyle = { padding: '4px 6px', border: '1px solid rgba(255,255,255,.05)', textAlign: 'right', whiteSpace: 'nowrap' };
  const rowStyle = (hasData) => ({ opacity: hasData ? 1 : 0.35 });

  return (
    <Layout
      title="Personal Ledger"
      actions={
        <>
          <button className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', fontSize: 9, letterSpacing: .5 }} onClick={() => navigate('/members')}>
            â† Members
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportLedgerCSV}>
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
            {member.staff_no && <><span className="sep">Â·</span><span>Staff: {member.staff_no}</span></>}
            {member.email && <><span className="sep">Â·</span><span>{member.email}</span></>}
            {member.phone && <><span className="sep">Â·</span><span>{member.phone}</span></>}
            {member.bank && <><span className="sep">Â·</span><span>{member.bank}</span></>}
            {member.account_number && <><span className="sep">Â·</span><span className="td-mono">{member.account_number}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {parseInt(member.active_loans) > 0 && (
            <span className="badge badge-red">{member.active_loans} Active Loan{member.active_loans !== '1' ? 's' : ''}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={openEditMember}>Edit</button>
        </div>
      </div>

      {/* â”€â”€ PERSONAL LEDGER TABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="card" style={{ padding: 0, marginBottom: 18 }}>
        {/* Card header */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: .5 }}>
            PERSONAL LEDGER {ledgerYear}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {availYears.length > 0 && (
              <select
                className="form-input"
                style={{ height: 30, fontSize: 12, padding: '0 8px' }}
                value={ledgerYear}
                onChange={(e) => setLedgerYear(Number(e.target.value))}
              >
                {availYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            <input
              className="form-input"
              type="number"
              min="2000" max="2100"
              style={{ width: 80, height: 30, fontSize: 12, padding: '0 8px' }}
              value={ledgerYear}
              onChange={(e) => setLedgerYear(Number(e.target.value))}
            />
          </div>
        </div>

        {ledgerLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading ledgerâ€¦</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              {/* Group headers */}
              <thead>
                <tr>
                  <th style={{ ...thStyle, minWidth: 70 }}>DATE</th>
                  {groups.map((g) => (
                    <th
                      key={g.label}
                      colSpan={g.span}
                      style={{
                        ...thStyle,
                        background: g.label === 'TOTAL DEDUCTION'
                          ? 'rgba(200,168,75,.15)' : thStyle.background,
                        fontSize: 9, letterSpacing: 1,
                      }}
                    >
                      {g.label}
                    </th>
                  ))}
                </tr>
                {/* Column headers */}
                <tr>
                  <th style={thStyle}></th>
                  {LEDGER_COLS.map((c) => (
                    <th key={c.key} style={{
                      ...thStyle,
                      color: c.red ? 'var(--red)' : c.amber ? 'var(--amber)' : c.green ? '#3cb371' : 'var(--text)',
                    }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* BAL B/F row */}
                <tr style={{ background: 'rgba(200,168,75,.05)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--gold)', fontSize: 10, letterSpacing: .5, textAlign: 'left' }}>
                    BAL B/F
                  </td>
                  {LEDGER_COLS.map((c) => (
                    <td key={c.key} style={tdStyle}>
                      {BF_MAP[c.key] != null && BF_MAP[c.key] !== 0
                        ? <Amt v={BF_MAP[c.key]} {...c} />
                        : <span style={{ color: 'var(--faint)' }}>â€”</span>}
                    </td>
                  ))}
                </tr>

                {/* Monthly rows */}
                {ledgerRows.map((row) => (
                  <tr key={row.month} style={rowStyle(row.has_data)}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--mono)', fontSize: 10, textAlign: 'left', color: 'var(--muted)' }}>
                      {MONTH_LABELS[row.month - 1]}. {ledgerYear}
                    </td>
                    {LEDGER_COLS.map((c) => (
                      <td key={c.key} style={tdStyle}>
                        <Amt v={row[c.key]} {...c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {/* TOTAL row */}
              <tfoot>
                <tr style={{ background: 'rgba(200,168,75,.08)', fontWeight: 700 }}>
                  <td style={{ ...tdStyle, color: 'var(--gold)', fontWeight: 800, fontSize: 10, textAlign: 'left', letterSpacing: .5 }}>TOTAL</td>
                  {LEDGER_COLS.map((c) => {
                    const bfVal = BF_MAP[c.key] || 0;
                    const total = colSum(c.key) + bfVal;
                    return (
                      <td key={c.key} style={{ ...tdStyle, fontWeight: 700 }}>
                        <Amt v={total} {...c} />
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Summary footer */}
        {!ledgerLoading && (
          <div style={{
            padding: '12px 18px', borderTop: '2px solid var(--border)',
            display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
            background: 'var(--surface-alt, rgba(0,0,0,.04))',
          }}>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>NET SAVINGS â‚¦</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: '#3cb371' }}>{fmtNGN(ledgerSumm.net_savings || 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>TOTAL SHARES</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14 }}>{fmtNGN(ledgerSumm.total_shares || 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>LOAN BAL.</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--red)' }}>{fmtNGN(ledgerSumm.loan_bal || 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>INT. TO PAY</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--amber)' }}>{fmtNGN(ledgerSumm.int_to_pay || 0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>BALANCE</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, color: 'var(--amber)' }}>{fmtNGN(ledgerSumm.balance || 0)}</div>
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
              {nowLabel}
            </div>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 14 }}>
        <div className="stat-card green" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Savings</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(ledgerSumm.net_savings || member.total_savings)}</div>
        </div>
        <div className="stat-card blue" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Shares</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(ledgerSumm.total_shares || member.total_shares)}</div>
        </div>
        <div className="stat-card red" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Loan Balance</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(ledgerSumm.loan_bal || member.loan_balance)}</div>
        </div>
        <div className="stat-card amber" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Interest Due</div>
          <div className="stat-value" style={{ fontSize: 17 }}>{fmtNGN(ledgerSumm.int_to_pay || member.interest_due)}</div>
        </div>
        <div className="stat-card" style={{ padding: '14px 18px' }}>
          <div className="stat-label">Commodity Bal.</div>
          <div className="stat-value" style={{ fontSize: 17, color: 'var(--amber)' }}>{fmtNGN(ledgerSumm.balance || member.total_commodity)}</div>
        </div>
      </div>

      {/* Monthly deduction strip */}
      {activeLoans.length > 0 && (
        <div className="monthly-strip">
          <div>
            <div className="ms-label">Monthly Repayment</div>
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
                  <th>Loan #</th><th>Principal</th><th>Remaining</th>
                  <th>Paid</th><th>Monthly Repayment</th><th>Total Interest ({displayRatePct}%)</th>
                  <th>Monthly Interest</th><th>Interest Paid</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l, i) => (
                  <tr key={l.id}>
                    <td className="td-mono td-muted">Loan {i + 1}</td>
                    <td>{fmtNGN(l.principal)}</td>
                    <td className={l.status === 'active' ? 'td-red' : 'td-green'}>{fmtNGN(l.remaining_balance)}</td>
                    <td>{fmtNGN(parseFloat(l.principal) - parseFloat(l.remaining_balance))}</td>
                    <td>{fmtNGN(parseFloat(l.monthly_principal) + parseFloat(l.monthly_interest))}</td>
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
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteLoan(l.id)}>âœ•</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {activeLoans.length > 1 && (
              <div className="breakdown-note">
                <strong>Interest breakdown:</strong>{' '}
                {activeLoans.map((l, i) => {
                  const r = l.interest_rate != null ? parseFloat(l.interest_rate) * 100 : 5;
                  return (
                    <span key={l.id}>
                      Loan {i + 1} â€” <strong>{fmtNGN(l.total_interest)}</strong> ({r}% of {fmtNGN(l.principal)} over {l.months} months = {fmtNGN(l.monthly_interest)}/mo)
                      {i < activeLoans.length - 1 ? ' + ' : ' '}
                    </span>
                  );
                })}
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
          <div className="detail-item"><div className="di-label">Email</div><div className="di-val">{member.email || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Phone</div><div className="di-val">{member.phone || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Gender</div><div className="di-val">{member.gender || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Marital Status</div><div className="di-val">{member.marital_status || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Admission Date</div><div className="di-val">{fmtDate(member.date_of_admission)}</div></div>
          <div className="detail-item"><div className="di-label">Department</div><div className="di-val">{member.department || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Next of Kin</div><div className="di-val">{member.next_of_kin || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Relation</div><div className="di-val">{member.next_of_kin_relation || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">GIFMIS No</div><div className="di-val td-mono" style={{ fontSize: 12 }}>{member.gifmis_no || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Bank</div><div className="di-val">{member.bank || 'â€”'}</div></div>
          <div className="detail-item"><div className="di-label">Account No</div><div className="di-val td-mono">{member.account_number || 'â€”'}</div></div>
        </div>
      </div>

      {/* Add Loan Modal */}
      {loanOpen && (
        <Modal title="Add New Loan" onClose={() => { setLoanOpen(false); setLoanForm(LOAN_FORM); }}>
          <form onSubmit={handleAddLoan}>
            <div className="info-box">
              Interest is calculated at <strong>{displayRatePct}% of the loan principal</strong>, spread equally across all repayment months.
            </div>
            <div className="form-group">
              <label className="form-label">Loan Amount (â‚¦) *</label>
              <input className="form-input" placeholder="e.g. 500000" value={loanForm.principal}
                onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value, monthly_payment: '' })} required />
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.5, color: 'var(--faint)', marginBottom: 14 }}>
              ENTER EITHER MONTHS OR MONTHLY PAYMENT â€” NOT BOTH
            </div>
            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <div className="form-group">
                <label className="form-label">Number of Months</label>
                <input className="form-input" placeholder="e.g. 12" value={loanForm.months}
                  onChange={(e) => setLoanForm({ ...loanForm, months: e.target.value, monthly_payment: '' })} />
              </div>
              <div className="or-div">OR</div>
              <div className="form-group">
                <label className="form-label">Monthly Repayment (â‚¦)</label>
                <input className="form-input" placeholder="e.g. 50,000" value={loanForm.monthly_payment}
                  onChange={(e) => setLoanForm({ ...loanForm, monthly_payment: e.target.value, months: '' })}
                  style={{ opacity: loanForm.months ? .5 : 1 }} />
              </div>
            </div>
            {preview && (
              <div className="preview-box">
                <div className="preview-item"><div className="pi-label">Monthly Repayment</div><div className="pi-val gold">{fmtNGN(preview.monthly_repayment)}</div></div>
                <div className="preview-item"><div className="pi-label">Monthly Interest</div><div className="pi-val amber">{fmtNGN(preview.monthly_interest)}</div></div>
                <div className="preview-item"><div className="pi-label">Total Interest ({displayRatePct}%)</div><div className="pi-val amber">{fmtNGN(preview.total_interest)}</div></div>
                <div className="preview-item"><div className="pi-label">Total Payable</div><div className="pi-val">{fmtNGN(preview.total_payable)}</div></div>
              </div>
            )}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setLoanOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !preview}>
                {saving ? 'Addingâ€¦' : 'Add Loan'}
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
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Savingâ€¦' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}


