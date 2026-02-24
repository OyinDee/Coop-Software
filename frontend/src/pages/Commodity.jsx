import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Commodity() {
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const now = new Date();
  const [form, setForm] = useState({ member_id: '', amount: '', description: '', month: now.getMonth() + 1, year: now.getFullYear() });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/commodity'), api.get('/members')])
      .then(([cr, mr]) => { setItems(cr.data.commodity); setMembers(mr.data.members); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm({ member_id: '', amount: '', description: '', month: now.getMonth() + 1, year: now.getFullYear() }); setEditItem(null); setAddOpen(true); };
  const openEdit = (item) => { setForm({ member_id: item.member_id, amount: item.amount, description: item.description || '', month: item.month, year: item.year }); setEditItem(item); setAddOpen(true); };

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (editItem) {
        await api.put(`/commodity/${editItem.id}`, { amount: form.amount, description: form.description });
        toast('Updated');
      } else {
        await api.post('/commodity', form);
        toast('Commodity added');
      }
      setAddOpen(false); load();
    } catch (err) { toast(err.response?.data?.error || 'Error', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this record?')) return;
    try { await api.delete(`/commodity/${id}`); toast('Deleted'); load(); }
    catch { toast('Error', 'error'); }
  };

  const total = items.reduce((s, r) => s + parseFloat(r.amount), 0);

  return (
    <Layout
      title="Commodity"
      actions={
        <button className="btn btn-primary btn-sm" onClick={openAdd}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Commodity
        </button>
      }
    >
      <div className="page-header">
        <div><div className="page-eyebrow">Records</div><div className="page-title">Commodity</div></div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <div className="stat-card blue">
          <div className="stat-label">Total Commodity</div>
          <div className="stat-value">{fmtNGN(total)}</div>
          <div className="stat-sub">{items.length} records</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Members Recorded</div>
          <div className="stat-value" style={{ color: 'var(--text)' }}>{new Set(items.map((i) => i.member_id)).size}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div> : (
          <table>
            <thead>
              <tr><th>Ledger No</th><th>Member</th><th>Amount</th><th>Period</th><th>Description</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="td-mono td-gold">{item.ledger_no}</td>
                  <td>{item.full_name}</td>
                  <td style={{ color: 'var(--blue)' }}>{fmtNGN(item.amount)}</td>
                  <td className="td-muted">{MONTHS[item.month - 1]} {item.year}</td>
                  <td className="td-muted">{item.description || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No commodity records</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <Modal title={editItem ? 'Edit Commodity' : 'Add Commodity'} onClose={() => setAddOpen(false)}>
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
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Add Commodity'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
