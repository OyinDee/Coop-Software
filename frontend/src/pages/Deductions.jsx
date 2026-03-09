import { useEffect, useRef, useState, useCallback } from 'react';
import { Link }   from 'react-router-dom';
import Layout     from '../components/Layout';
import Modal      from '../components/Modal';
import Pagination from '../components/Pagination';
import api        from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const PAGE_SIZE = 25;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Keys that represent actual salary deductions (NOT balance/BF/CF tracking columns)
// TOTAL DEDUCTION = sum of these only
const DEDUCTION_KEYS = new Set([
  'savings_add', 'savings_add_bank',
  'loan_repayment', 'loan_repayment_bank',
  'loan_int_paid', 'loan_int_paid_bank',
  'comm_repayment', 'comm_repayment_bank',
  'form', 'other_charges',
]);

// ── Upload CSV modal ──────────────────────────────────────────────────────────
function UploadModal({ month, year, onDone, onClose }) {
  const toast    = useToast();
  const fileRef  = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [selMonth, setSelMonth]   = useState(month);
  const [selYear,  setSelYear]    = useState(year);

  const handleUpload = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('month', selMonth);
      form.append('year',  selYear);
      const r = await api.post('/deductions/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast(r.data.message || 'Upload complete');
      onDone(selMonth, selYear);
    } catch (err) {
      toast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title="Upload Monthly CSV" onClose={onClose} width={440}>
      <div className="info-box" style={{ marginBottom: 18, fontSize: 12 }}>
        Upload the monthly transaction CSV. All financial columns will be imported and
        auto-registered. Members are matched by <strong>L/No</strong> or Staff No.
      </div>
      <form onSubmit={handleUpload}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div className="form-group" style={{ margin: 0, flex: 1 }}>
            <label className="form-label">Month</label>
            <select className="form-input" value={selMonth} onChange={(e) => setSelMonth(Number(e.target.value))}>
              {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, flex: 0.7 }}>
            <label className="form-label">Year</label>
            <input className="form-input" type="number" min="2000" max="2100"
              value={selYear} onChange={(e) => setSelYear(Number(e.target.value))} />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">CSV File</label>
          <input ref={fileRef} className="form-input" type="file" accept=".csv" required />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Narration edit modal ──────────────────────────────────────────────────────
function NarrationModal({ member, month, year, onSave, onClose }) {
  const toast = useToast();
  const [narration, setNarration] = useState(member.narration || '');
  const [saving, setSaving]       = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/deductions', { member_id: member.id, month, year, narration });
      onSave(member.id, narration);
      toast('Note saved');
      onClose();
    } catch (err) {
      toast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Note — ${member.full_name}`} onClose={onClose} width={400}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        {MONTHS[month - 1]} {year} &nbsp;·&nbsp; {member.ledger_no}
      </div>
      <div className="form-group">
        <label className="form-label">Narration / Notes</label>
        <textarea
          className="form-input"
          rows={3}
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          placeholder="e.g. Form fee paid, levy waived…"
          style={{ resize: 'vertical' }}
          autoFocus
        />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// Editable keys admins can change for a generated month (B/F values are read-only — they come from prev C/F)
const EDITABLE_FIELDS = [
  { key: 'savings_add',        label: 'ADD: Savings (Salary)' },
  { key: 'savings_add_bank',   label: 'ADD: Savings (Bank)' },
  { key: 'savings_withdrawal', label: 'LESS: Withdrawal' },
  { key: 'loan_granted',       label: 'ADD: New Loan Granted' },
  { key: 'loan_repayment',     label: 'LESS: Loan Repayment (Salary)' },
  { key: 'loan_repayment_bank',label: 'LESS: Loan Repayment (Bank)' },
  { key: 'loan_int_paid',      label: 'LESS: Loan Interest Paid (Salary)' },
  { key: 'loan_int_paid_bank', label: 'LESS: Loan Interest Paid (Bank)' },
  { key: 'comm_add',           label: 'ADD: New Commodity' },
  { key: 'comm_repayment',     label: 'LESS: Commodity Repayment (Salary)' },
  { key: 'comm_repayment_bank',label: 'LESS: Commodity Repayment (Bank)' },
  { key: 'form',               label: 'Form Fee' },
  { key: 'other_charges',      label: 'Other Charges' },
];

// ── Edit month entry modal ────────────────────────────────────────────────────
function EditEntryModal({ member, month, year, onSave, onClose }) {
  const toast = useToast();
  const [values, setValues] = useState(() => {
    const init = {};
    for (const f of EDITABLE_FIELDS) init[f.key] = member[f.key] != null ? String(member[f.key]) : '0';
    return init;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const changes = {};
      for (const f of EDITABLE_FIELDS) changes[f.key] = parseFloat(values[f.key]) || 0;
      const r = await api.patch('/deductions/entry', { member_id: member.id, month, year, changes });
      toast('Entry updated');
      onSave(member.id, r.data.data);
      onClose();
    } catch (err) {
      toast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit Entry — ${member.full_name}`} onClose={onClose} width={520}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        {MONTHS[month - 1]} {year} &nbsp;·&nbsp; {member.ledger_no}
        <span style={{ marginLeft: 8, color: 'var(--faint)' }}>B/F values and C/F totals are auto-calculated</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 16 }}>
        {EDITABLE_FIELDS.map((f) => (
          <div className="form-group" key={f.key} style={{ margin: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>{f.label}</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={values[f.key]}
              onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 12, padding: '8px 10px', background: 'rgba(200,168,75,.06)', borderRadius: 4, border: '1px solid rgba(200,168,75,.15)' }}>
        Saving will recalculate Net Saving C/F, Loan Ledger Bal, Loan Interest C/F, and Commodity C/F automatically.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Recalculate'}
        </button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Deductions() {
  const toast = useToast();
  const now   = new Date();
  const [month, setMonth]   = useState(now.getMonth() + 1);
  const [year,  setYear]    = useState(now.getFullYear());

  const [columns,  setColumns]  = useState([]);
  const [members,  setMembers]  = useState([]);
  const [hasData,  setHasData]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [editing,  setEditing]  = useState(null);       // narration editing
  const [editingEntry, setEditingEntry] = useState(null); // full entry editing
  const [uploading,  setUploading]  = useState(false);
  const [generating, setGenerating] = useState(false);
  const [page,       setPage]       = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/deductions', { params: { month, year } });
      setColumns(r.data.columns);  // Use columns from deductions endpoint (trans_columns)
      setMembers(r.data.members);
      setHasData(r.data.hasData);
    } catch (err) {
      toast(err.response?.data?.error || 'Error loading deductions', 'error');
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { fetchData(); setPage(1); }, [fetchData]);

  const handleUploadDone = (m, y) => {
    setUploading(false);
    setMonth(m);
    setYear(y);
    fetchData();
  };

  const handleSavedNarration = (memberId, narration) => {
    setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, narration } : m));
  };

  const handleSavedEntry = (memberId, newData) => {
    setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, ...newData } : m));
  };

  // Generate next month from a given source month
  const handleGenerateFrom = async (fromM, fromY) => {
    setGenerating(true);
    try {
      const r = await api.post('/deductions/generate-next-month', { fromMonth: fromM, fromYear: fromY });
      toast(r.data.message);
      // Navigate to the generated month
      setMonth(r.data.month);
      setYear(r.data.year);
    } catch (err) {
      toast(err.response?.data?.error || 'Generation failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Prev / next month helpers
  const prevMonth = month === 1  ? 12       : month - 1;
  const prevYear  = month === 1  ? year - 1 : year;
  const nextMonth = month === 12 ? 1        : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.full_name?.toLowerCase().includes(q) ||
      m.ledger_no?.toLowerCase().includes(q) ||
      m.staff_no?.toLowerCase().includes(q)
    );
  });
  // Reset to page 1 when search changes (effect)
  useEffect(() => { setPage(1); }, [search]);

  // Columns to display in table (exclude total_deduction — it has its own dedicated column)
  const displayColumns = columns.filter((c) => c.key !== 'total_deduction');

  // Compute TOTAL DEDUCTION for a row: use stored value if present, else sum deduction keys only
  const rowTotal = (m) => {
    const stored = parseFloat(m.total_deduction);
    if (!isNaN(stored) && stored > 0) return stored;
    return displayColumns.reduce((s, c) => {
      if (!DEDUCTION_KEYS.has(c.key)) return s;
      return s + (parseFloat(m[c.key]) || 0);
    }, 0);
  };

  // ── Column totals (over all filtered, not just page) ──────────────────────
  const tot = (key) => filtered.reduce((s, m) => s + (parseFloat(m[key]) || 0), 0);

  // ── Pagination slice ──────────────────────────────────────────────────────
  const pageStart = (page - 1) * PAGE_SIZE;
  const paginated = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // ── CSV export ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['S/N', 'MONTH', 'L/No', 'NAME', 'STAFF No',
      ...displayColumns.map((c) => c.label.toUpperCase()), 'NARRATION', 'TOTAL DEDUCTION'];
    const monthLabel = `${MONTHS[month - 1].toUpperCase()}, ${year}`;
    const body = filtered.map((m, i) => [
      i + 1,
      `"${monthLabel}"`,
      m.ledger_no,
      `"${m.full_name}"`,
      m.staff_no || '',
      ...displayColumns.map((c) => {
        const v = parseFloat(m[c.key]);
        return isNaN(v) ? '0.00' : v.toFixed(2);
      }),
      `"${m.narration || ''}"`,
      rowTotal(m).toFixed(2),
    ]);
    // Totals row
    body.push(['', '', '', 'TOTAL', '',
      ...displayColumns.map((c) => tot(c.key).toFixed(2)),
      '',
      filtered.reduce((s, m) => s + rowTotal(m), 0).toFixed(2),
    ]);
    const csv = [headers, ...body].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `deductions_${MONTHS[month - 1].toLowerCase()}_${year}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Layout title="Monthly Deductions">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Reports</div>
          <div className="page-title">Monthly Deductions</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="form-input"
            style={{ width: 140 }}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
          </select>
          <input
            className="form-input"
            type="number"
            style={{ width: 90 }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min="2000" max="2100"
          />
          <button className="btn btn-primary" onClick={() => setUploading(true)}>
            Upload CSV
          </button>
          {hasData && (
            <button
              className="btn btn-secondary"
              onClick={() => handleGenerateFrom(month, year)}
              disabled={generating}
              title={`Auto-calculate ${MONTHS[nextMonth - 1]} ${nextYear} from this month`}
            >
              {generating ? 'Generating…' : `Generate ${MONTHS[nextMonth - 1]} ${nextYear}`}
            </button>
          )}
          <button className="btn btn-secondary" onClick={exportCSV} disabled={loading || !hasData}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Month banner */}
      <div style={{
        background: 'rgba(200,168,75,.06)', border: '1px solid rgba(200,168,75,.2)',
        borderRadius: 4, padding: '10px 18px', marginBottom: 14,
        fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', letterSpacing: 1,
      }}>
        {MONTHS[month - 1].toUpperCase()} {year}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {!loading && hasData && (
          <div style={{
            padding: '12px 18px', borderBottom: '1px solid var(--border)',
            display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <input
              className="form-input"
              placeholder="Search name, ledger no, staff no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              {filtered.length} member{filtered.length !== 1 ? 's' : ''}
            </span>
            {filtered.length !== members.length && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')} style={{ fontSize: 11 }}>Clear</button>
            )}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: 36 }}>#</th>
                <th style={{ minWidth: 110 }}>L/No</th>
                <th style={{ minWidth: 210 }}>Name</th>
                <th style={{ minWidth: 100 }}>Staff No</th>
                {displayColumns.map((c) => (
                  <th key={c.key} style={{ minWidth: 130, textAlign: 'right' }}>{c.label}</th>
                ))}
                <th style={{ minWidth: 180 }}>Narration</th>
                <th style={{ minWidth: 140, textAlign: 'right' }}>TOTAL DEDUCTION</th>
                <th style={{ minWidth: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={displayColumns.length + 6} style={{ textAlign: 'center', padding: 50, color: 'var(--muted)' }}>
                    Loading…
                  </td>
                </tr>
              ) : !hasData ? (
                <tr>
                  <td colSpan={displayColumns.length + 6} style={{ textAlign: 'center', padding: 60 }}>
                    <div style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 14 }}>
                      No data for {MONTHS[month - 1]} {year}.
                    </div>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={() => setUploading(true)}>
                        Upload Opening CSV
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleGenerateFrom(prevMonth, prevYear)}
                        disabled={generating}
                        title={`Auto-calculate from ${MONTHS[prevMonth - 1]} ${prevYear}`}
                      >
                        {generating ? 'Generating…' : `Generate from ${MONTHS[prevMonth - 1]} ${prevYear}`}
                      </button>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 11, color: 'var(--faint)' }}>
                      Upload a CSV to set opening balances, or auto-generate from the previous month.
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={displayColumns.length + 6} style={{ textAlign: 'center', padding: 50, color: 'var(--muted)' }}>
                    No members match your search.
                  </td>
                </tr>
              ) : (
                paginated.map((m, i) => (
                  <tr key={m.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{pageStart + i + 1}</td>
                    <td>
                      <Link to={`/ledger/${m.id}`} style={{ color: 'var(--gold)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {m.ledger_no}
                      </Link>
                    </td>
                    <td style={{ fontWeight: 500 }}>{m.full_name}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{m.staff_no || '—'}</td>
                    {displayColumns.map((c) => {
                      const v = parseFloat(m[c.key]);
                      return (
                        <td key={c.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13 }}>
                          {v === null || v === undefined || isNaN(v)
                            ? <span style={{ color: 'var(--faint)' }}>—</span>
                            : v === 0 ? <span style={{ color: 'var(--faint)' }}>0.00</span> : fmtNGN(v)}
                        </td>
                      );
                    })}
                    <td
                      style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                      title={m.narration || 'Click to add note'}
                      onClick={() => setEditing(m)}
                    >
                      {m.narration || <span style={{ color: 'var(--faint)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--gold)' }}>
                      {(() => {
                        const t = rowTotal(m);
                        return t > 0 ? fmtNGN(t) : <span style={{ color: 'var(--faint)' }}>—</span>;
                      })()}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        title="Edit this member's entry"
                        onClick={() => setEditingEntry(m)}
                      >Edit</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {!loading && hasData && filtered.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={4} style={{ textAlign: 'right', fontSize: 11, letterSpacing: 1 }}>TOTALS</td>
                  {displayColumns.map((c) => (
                    <td key={c.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmtNGN(tot(c.key))}
                    </td>
                  ))}
                  <td />
                  <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--gold)', fontWeight: 700 }}>
                    {fmtNGN(filtered.reduce((s, m) => s + rowTotal(m), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={(p) => { setPage(p); window.scrollTo(0,0); }} />
      </div>

      {uploading && (
        <UploadModal
          month={month}
          year={year}
          onDone={handleUploadDone}
          onClose={() => setUploading(false)}
        />
      )}

      {editing && (
        <NarrationModal
          member={editing}
          month={month}
          year={year}
          onSave={handleSavedNarration}
          onClose={() => setEditing(null)}
        />
      )}

      {editingEntry && (
        <EditEntryModal
          member={editingEntry}
          month={month}
          year={year}
          onSave={handleSavedEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </Layout>
  );
}

