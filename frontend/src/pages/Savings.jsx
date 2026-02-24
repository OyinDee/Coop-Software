import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Savings() {
  const [savings, setSavings] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [form, setForm] = useState({ member_id: '', amount: '', month: now.getMonth() + 1, year: now.getFullYear(), description: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/savings', { params: { month: filterMonth, year: filterYear } }),
      api.get('/members'),
    ]).then(([sr, mr]) => {
      setSavings(sr.data.savings);
      setMembers(mr.data.members);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filterMonth, filterYear]);

  const openAdd = () => { setForm({ member_id: '', amount: '', month: filterMonth, year: filterYear, description: '' }); setEditItem(null); setAddOpen(true); };
  const openEdit = (s) => { setForm({ member_id: s.member_id, amount: s.amount, month: s.month, year: s.year, description: s.description || '' }); setEditItem(s); setAddOpen(true); };

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editItem) {
        await api.put(`/savings/${editItem.id}`, { amount: form.amount, description: form.description });
        toast('Savings updated');
      } else {
        await api.post('/savings', form);
        toast('Savings recorded');
      }
      setAddOpen(false); load();
    } catch (err) { toast(err.response?.data?.error || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this record?')) return;
    try { await api.delete(`/savings/${id}`); toast('Deleted'); load(); }
    catch { toast('Error', 'error'); }
  };

  const total = savings.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  const recorded   = savings.filter(r => r.id && !r.carried_forward).length;
  const carried    = savings.filter(r => r.carried_forward).length;
  const noSavings  = savings.filter(r => r.carried_forward === null && !r.id).length;

  return (
    <Layout
      title="Savings"
      actions={
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Savings
        </button>
      }
    >
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Monthly</div>
          <div className="page-title">Savings</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="form-input" style={{ width: 110 }} value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input className="form-input" type="number" style={{ width: 90 }} value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} min="2000" max="2100" />
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat-card green">
          <div className="stat-label">Total Savings</div>
          <div className="stat-value">{fmtNGN(total)}</div>
          <div className="stat-sub">{MONTHS[filterMonth - 1]} {filterYear}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Recorded This Month</div>
          <div className="stat-value" style={{ color: 'var(--blue)' }}>{recorded}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Carried Forward</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{carried}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">No Savings Yet</div>
          <div className="stat-value" style={{ color: 'var(--faint)' }}>{noSavings}</div>
        </div>
      </div>
      <div style={{ marginBottom: 12, padding: '8px 14px', background: 'rgba(200,168,75,.06)', border: '1px solid rgba(200,168,75,.18)', borderRadius: 4, fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', letterSpacing: .5 }}>
        AMBER rows = carry-forward from most recent past record. Editing sets a real record for that month.
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div> : (
          <table>
            <thead>
              <tr>
                <th>Ledger No</th><th>Member</th><th>Amount</th><th>Status</th><th>Description</th><th></th>
              </tr>
            </thead>
            <tbody>
              {savings.map((s, i) => {
                const isCarried = s.carried_forward === true;
                const isEmpty   = s.carried_forward === null && !s.id;
                return (
                  <tr key={s.id || `cf-${i}`} style={isCarried ? { opacity: .8, background: 'rgba(245,166,35,.04)' } : isEmpty ? { opacity: .5 } : {}}>
                    <td className="td-mono td-gold">{s.ledger_no}</td>
                    <td>{s.full_name}</td>
                    <td style={{ color: isEmpty ? 'var(--faint)' : 'var(--green)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {isEmpty ? '—' : fmtNGN(s.amount)}
                    </td>
                    <td>
                      {isCarried
                        ? <span className="badge badge-warning">carried fwd</span>
                        : s.id
                          ? <span className="badge badge-success">recorded</span>
                          : <span className="badge">-</span>}
                    </td>
                    <td className="td-muted">{s.description || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)}>Edit</button>
                        {s.id && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.id)}>✕</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {savings.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No savings data for this period</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <Modal title={editItem ? 'Edit Savings' : 'Add Savings'} onClose={() => setAddOpen(false)}>
          <form onSubmit={handleSave}>
            {!editItem && (
              <div className="form-group">
                <label className="form-label">Member *</label>
                <select className="form-input" value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })} required>
                  <option value="">Select member…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.ledger_no})</option>)}
                </select>
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Amount (₦) *</label>
                <input className="form-input" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              {!editItem && (
                <>
                  <div className="form-group">
                    <label className="form-label">Month</label>
                    <select className="form-input" value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
                      {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Year</label>
                    <input className="form-input" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} />
                  </div>
                </>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Add Savings'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
