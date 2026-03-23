import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const PAGE_SIZE = 50; // Increased page size for better performance

const EMPTY_MEMBER = {
  ledger_no: '', staff_no: '', gifmis_no: '', full_name: '', gender: 'Male',
  marital_status: 'Married', phone: '', email: '', date_of_admission: '',
  bank: '', account_number: '', department: '', next_of_kin: '', next_of_kin_relation: '',
};

// Debounce function for search
function useDebounce(callback, delay) {
  const timeoutRef = useRef();
  return useCallback((...args) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);
}

export default function Members() {
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [balImportOpen, setBalImportOpen] = useState(false);
  const [balImporting, setBalImporting] = useState(false);
  const [balImportResult, setBalImportResult] = useState(null);
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();
  const balFileRef = useRef();
  const toast = useToast();
  const navigate = useNavigate();

  // Debounced search function
  const debouncedLoad = useDebounce((q = '') => {
    setLoading(true);
    api.get('/members', { params: q ? { search: q, limit: 1000 } : {} })
      .then((r) => { setMembers(r.data.members); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  }, 300);

  // Memoized filtered members for better performance
  const filteredMembers = useMemo(() => {
    if (!search) return members;
    const q = search.toLowerCase();
    return members.filter(m => 
      m.full_name?.toLowerCase().includes(q) ||
      m.ledger_no?.toLowerCase().includes(q) ||
      m.staff_no?.toLowerCase().includes(q) ||
      m.department?.toLowerCase().includes(q)
    );
  }, [members, search]);

  // Paginated members
  const pageMembers = useMemo(() => {
    const pageStart = (page - 1) * PAGE_SIZE;
    return filteredMembers.slice(pageStart, pageStart + PAGE_SIZE);
  }, [filteredMembers, page]);

  useEffect(() => { debouncedLoad(''); }, []);
  useEffect(() => { 
    debouncedLoad(search); 
    setPage(1); 
  }, [search]);

  const openAdd = () => { setForm(EMPTY_MEMBER); setEditMember(null); setAddOpen(true); };
  const openEdit = (m) => {
    setForm({
      ledger_no: m.ledger_no || '', staff_no: m.staff_no || '', gifmis_no: m.gifmis_no || '',
      full_name: m.full_name || '', gender: m.gender || 'Male', marital_status: m.marital_status || 'Married',
      phone: m.phone || '', email: m.email || '',
      date_of_admission: m.date_of_admission ? m.date_of_admission.split('T')[0] : '',
      bank: m.bank || '', account_number: m.account_number || '', department: m.department || '',
      next_of_kin: m.next_of_kin || '', next_of_kin_relation: m.next_of_kin_relation || '',
    });
    setEditMember(m);
    setAddOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editMember) {
        await api.put(`/members/${editMember.id}`, form);
        toast('Member updated');
      } else {
        await api.post('/members', form);
        toast('Member added');
      }
      setAddOpen(false); load(search);
    } catch (err) {
      toast(err.response?.data?.error || 'Error saving member', 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Deactivate this member?')) return;
    try {
      await api.delete(`/members/${id}`);
      toast('Member deactivated'); load(search);
    } catch { toast('Error', 'error'); }
  };

  const handleImport = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api.post('/members/import/csv', fd);
      setImportResult({ ok: true, ...r.data });
      load();
    } catch (err) {
      setImportResult({ ok: false, message: err.response?.data?.error || 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  const handleBalanceImport = async (file) => {
    if (!file) return;
    setBalImporting(true);
    setBalImportResult(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api.post('/members/import/balances', fd);
      setBalImportResult({ ok: true, ...r.data });
      load();
    } catch (err) {
      setBalImportResult({ ok: false, message: err.response?.data?.error || 'Import failed' });
    } finally {
      setBalImporting(false);
    }
  };

  const loanBadge = (m) => {
    const n = parseInt(m.active_loans);
    if (!n) return <span className="badge badge-green">Clear</span>;
    if (n >= 2) return <span className="badge badge-red">{n} Loans</span>;
    const bal = parseFloat(m.loan_balance);
    return <span className={bal > 1000000 ? 'badge badge-red' : 'badge badge-amber'}>Loan</span>;
  };

  return (
    <Layout
      title="Members"
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <polyline points="21 15 21 19 3 19 3 15" /><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 8 12 3 17 8" />
            </svg>
            Import CSV
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setBalImportOpen(true)}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            Import Balances
          </button>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Member
          </button>
        </>
      }
    >
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Registry</div>
          <div className="page-title">Members</div>
        </div>
      </div>

      <div className="search-bar">
        <svg width="14" height="14" fill="none" stroke="var(--faint)" strokeWidth="1.8" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          placeholder="Search by name, ledger number, or staff number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)' }}>{total} results</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Ledger No</th>
                  <th>Name</th>
                  <th>Staff No</th>
                  <th>GIFMIS No</th>
                  <th>Email</th>
                  <th>GSM No</th>
                  <th>Bank</th>
                  <th>Acct. No</th>
                  <th>Next of kin</th>
                  <th>Relation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pageMembers.map((m) => (
                  <tr key={m.id}>
                    <td className="td-mono td-gold">{m.ledger_no}</td>
                    <td>{m.full_name}</td>
                    <td className="td-mono td-muted" style={{ fontSize: 11 }}>{m.staff_no || '—'}</td>
                    <td className="td-mono td-muted" style={{ fontSize: 11 }}>{m.gifmis_no || '—'}</td>
                    <td>{m.email || '—'}</td>
                    <td>{m.phone || '—'}</td>
                    <td>{m.bank || '—'}</td>
                    <td>{m.account_number || '—'}</td>
                    <td>{m.next_of_kin || '—'}</td>
                    <td>{m.next_of_kin_relation || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(m)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(m.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan="11" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No members found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={members.length} onChange={(p) => { setPage(p); window.scrollTo(0, 0); }} />
      </div>

      {/* Add/Edit Member Modal */}
      {addOpen && (
        <Modal title={editMember ? 'Edit Member' : 'Add New Member'} onClose={() => setAddOpen(false)} width={520}>
          <form onSubmit={handleSave}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Ledger No *</label>
                <input className="form-input" placeholder="SCMS/XXX" value={form.ledger_no} onChange={(e) => setForm({ ...form, ledger_no: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Staff No *</label>
                <input className="form-input" placeholder="SS0000" value={form.staff_no} onChange={(e) => setForm({ ...form, staff_no: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Full Name * — SURNAME, First Middle</label>
              <input className="form-input" placeholder="ADEBAYO, JOHN OBI" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">GIFMIS No</label>
                <input className="form-input" placeholder="FUO00000" value={form.gifmis_no} onChange={(e) => setForm({ ...form, gifmis_no: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Gender</label>
                <select className="form-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option>Male</option><option>Female</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Marital Status</label>
                <select className="form-input" value={form.marital_status} onChange={(e) => setForm({ ...form, marital_status: e.target.value })}>
                  <option>Married</option><option>Single</option><option>Divorced</option><option>Widowed</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" placeholder="080xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">FUOYE Email</label>
                <input className="form-input" placeholder="name@fuoye.edu.ng" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Bank</label>
                <input className="form-input" placeholder="FIDELITY" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Account Number</label>
                <input className="form-input" placeholder="0000000000" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Department</label>
                <input className="form-input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Admission Date</label>
                <input className="form-input" type="date" value={form.date_of_admission} onChange={(e) => setForm({ ...form, date_of_admission: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Next of Kin</label>
                <input className="form-input" value={form.next_of_kin} onChange={(e) => setForm({ ...form, next_of_kin: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Relation</label>
                <input className="form-input" placeholder="Wife, Husband, Son…" value={form.next_of_kin_relation} onChange={(e) => setForm({ ...form, next_of_kin_relation: e.target.value })} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editMember ? 'Save Changes' : 'Add Member'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Import CSV Modal */}
      {importOpen && (
        <Modal title="Import Members from CSV" onClose={() => { if (!importing) { setImportOpen(false); setImportResult(null); } }}>
          <div className="info-box">
            Expected columns:<br />
            <code>S/N, LEDGER No, GIFMIS No, Staff No, Name, Gender, Phone No., FUOYE E-mail Address, Date of Admission, MARITAL STATUS, BANK, ACCOUNT NUMBER, DEPARTMENT</code><br /><br />
            Duplicate ledger numbers will be skipped automatically.
          </div>

          {/* Uploading spinner */}
          {importing && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '28px 0' }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                border: '3px solid var(--border2)',
                borderTopColor: 'var(--gold)',
                animation: 'spin 0.8s linear infinite',
              }} />
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>Processing CSV…</div>
            </div>
          )}

          {/* Result summary */}
          {!importing && importResult && (
            <div style={{ margin: '4px 0 12px', padding: '14px 16px', borderRadius: 4, border: `1px solid ${importResult.ok ? 'rgba(62,207,142,.25)' : 'rgba(241,96,96,.25)'}`, background: importResult.ok ? 'rgba(62,207,142,.06)' : 'rgba(241,96,96,.06)' }}>
              <div style={{ fontWeight: 600, color: importResult.ok ? 'var(--green)' : 'var(--red)', marginBottom: 6 }}>
                {importResult.ok ? '✓ Import complete' : '✕ Import failed'}
              </div>
              <div style={{ fontSize: 13 }}>{importResult.message}</div>
              {importResult.ok && (
                <div style={{ marginTop: 8, display: 'flex', gap: 18, fontFamily: 'var(--mono)', fontSize: 11 }}>
                  <span style={{ color: 'var(--green)' }}>✓ {importResult.imported} imported</span>
                  {importResult.skipped > 0 && <span style={{ color: 'var(--amber)' }}>⚠ {importResult.skipped} skipped</span>}
                </div>
              )}
              {importResult.errors?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SKIPPED ROWS:</div>
                  <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                    {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Drop zone — hidden while importing or after result */}
          {!importing && !importResult && (
            <>
              <input type="file" accept=".csv" ref={fileRef} style={{ display: 'none' }} onChange={(e) => handleImport(e.target.files[0])} />
              <div
                className={`drop-zone ${dragging ? 'over' : ''}`}
                onClick={() => fileRef.current.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleImport(e.dataTransfer.files[0]); }}
              >
                <div className="dz-icon">
                  <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <polyline points="21 15 21 19 3 19 3 15" /><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 8 12 3 17 8" />
                  </svg>
                </div>
                <div className="dz-text">Click to select CSV file, or drag and drop</div>
                <div className="dz-sub">.csv files only</div>
              </div>
            </>
          )}

          <div className="modal-footer">
            {!importing && importResult ? (
              <>
                <button className="btn btn-ghost" onClick={() => setImportResult(null)}>Import Another</button>
                <button className="btn btn-primary" onClick={() => { setImportOpen(false); setImportResult(null); }}>Done</button>
              </>
            ) : (
              <button className="btn btn-ghost" disabled={importing} onClick={() => { setImportOpen(false); setImportResult(null); }}>Cancel</button>
            )}
          </div>
        </Modal>
      )}

      {/* Import Balances Modal */}
      {balImportOpen && (
        <Modal title="Import Opening Balances" onClose={() => { if (!balImporting) { setBalImportOpen(false); setBalImportResult(null); } }}>
          <div className="info-box">
            <strong>Step 1:</strong> Import member records first using <em>Import CSV</em> (name, email, bank, etc.).<br />
            <strong>Step 2:</strong> Import this file to set opening balances.<br /><br />
            <strong>Transaction sheet format</strong> (auto-detected via <code>L/No</code> column):<br />
            Reads <code>Savings B/F</code>, <code>ADD: Savings during the month</code>, <code>Loan Prin. Bal. B/F</code>, <code>LESS: Loan Principal Repayment</code>, <code>Loan Interest Balance B/F</code>, <code>Commodity Sales Bal. B/F</code>.<br /><br />
            <strong>Simple format:</strong> <code>LEDGER No, SAVINGS, LOAN, LN INT, COMM, OTHERS</code><br /><br />
            Members matched by Ledger No first, then Staff No. Re-importing updates existing records.
          </div>

          {balImporting && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '28px 0' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border2)', borderTopColor: 'var(--gold)', animation: 'spin 0.8s linear infinite' }} />
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>Processing balances…</div>
            </div>
          )}

          {!balImporting && balImportResult && (
            <div style={{ margin: '4px 0 12px', padding: '14px 16px', borderRadius: 4, border: `1px solid ${balImportResult.ok ? 'rgba(62,207,142,.25)' : 'rgba(241,96,96,.25)'}`, background: balImportResult.ok ? 'rgba(62,207,142,.06)' : 'rgba(241,96,96,.06)' }}>
              <div style={{ fontWeight: 600, color: balImportResult.ok ? 'var(--green)' : 'var(--red)', marginBottom: 6 }}>
                {balImportResult.ok ? '✓ Import complete' : '✕ Import failed'}
              </div>
              <div style={{ fontSize: 13 }}>{balImportResult.message}</div>
              {balImportResult.ok && (
                <div style={{ marginTop: 8, display: 'flex', gap: 18, fontFamily: 'var(--mono)', fontSize: 11 }}>
                  <span style={{ color: 'var(--green)' }}>✓ {balImportResult.imported} updated</span>
                  {balImportResult.skipped > 0 && <span style={{ color: 'var(--amber)' }}>⚠ {balImportResult.skipped} skipped</span>}
                </div>
              )}
              {balImportResult.errors?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>SKIPPED ROWS:</div>
                  <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                    {balImportResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {!balImporting && !balImportResult && (
            <>
              <input type="file" accept=".csv" ref={balFileRef} style={{ display: 'none' }} onChange={(e) => handleBalanceImport(e.target.files[0])} />
              <div
                className="drop-zone"
                onClick={() => balFileRef.current.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); handleBalanceImport(e.dataTransfer.files[0]); }}
              >
                <div className="dz-icon">
                  <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                </div>
                <div className="dz-text">Click to select balances CSV, or drag and drop</div>
                <div className="dz-sub">.csv files only</div>
              </div>
            </>
          )}

          <div className="modal-footer">
            {!balImporting && balImportResult ? (
              <>
                <button className="btn btn-ghost" onClick={() => setBalImportResult(null)}>Import Another</button>
                <button className="btn btn-primary" onClick={() => { setBalImportOpen(false); setBalImportResult(null); }}>Done</button>
              </>
            ) : (
              <button className="btn btn-ghost" disabled={balImporting} onClick={() => { setBalImportOpen(false); setBalImportResult(null); }}>Cancel</button>
            )}
          </div>
        </Modal>
      )}
    </Layout>
  );
}
