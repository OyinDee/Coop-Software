import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const EMPTY_MEMBER = {
  ledger_no: '', staff_no: '', gifmis_no: '', full_name: '', gender: 'Male',
  marital_status: 'Married', phone: '', email: '', date_of_admission: '',
  bank: '', account_number: '', department: '', next_of_kin: '', next_of_kin_relation: '',
};

export default function Members() {
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editMember, setEditMember] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();
  const toast = useToast();
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
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api.post('/members/import/csv', fd);
      toast(`${r.data.imported} members imported`, 'success');
      setImportOpen(false); load();
    } catch (err) {
      toast(err.response?.data?.error || 'Import failed', 'error');
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
                  <th>Ledger No</th><th>Name</th><th>Staff No</th><th>Department</th>
                  <th>Bank</th><th>Savings</th><th>Loan Balance</th><th>Interest Due</th>
                  <th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="td-mono td-gold">{m.ledger_no}</td>
                    <td>{m.full_name}</td>
                    <td className="td-mono td-muted" style={{ fontSize: 11 }}>{m.staff_no || '—'}</td>
                    <td className="td-muted">{m.department || '—'}</td>
                    <td>{m.bank || '—'}</td>
                    <td className="td-green">{parseFloat(m.total_savings) > 0 ? fmtNGN(m.total_savings) : '—'}</td>
                    <td className={parseFloat(m.loan_balance) > 0 ? 'td-red' : 'td-muted'}>{parseFloat(m.loan_balance) > 0 ? fmtNGN(m.loan_balance) : '—'}</td>
                    <td className={parseFloat(m.interest_due) > 0 ? 'td-amber' : 'td-muted'}>{parseFloat(m.interest_due) > 0 ? fmtNGN(m.interest_due) : '—'}</td>
                    <td>{loanBadge(m)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/ledger/${m.id}`)}>View</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(m)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(m.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan="10" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No members found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
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
        <Modal title="Import Members from CSV" onClose={() => setImportOpen(false)}>
          <div className="info-box">
            Expected columns:<br />
            <code>S/N, LEDGER No, GIFMIS No, Staff No, Name, Gender, Phone No., FUOYE E-mail Address, Date of Admission, MARITAL STATUS, BANK, ACCOUNT NUMBER, DEPARTMENT</code><br /><br />
            Duplicate ledger numbers will be skipped automatically.
          </div>
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
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setImportOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
