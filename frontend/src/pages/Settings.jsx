import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Settings() {
  const toast = useToast();
  const { admin } = useAuth();
  const isSuperadmin = admin?.role === 'superadmin';

  // ── Loan interest rate ───────────────────────────────────────────────────
  const [rate, setRate]       = useState('');
  const [penaltyRate, setPenaltyRate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // ── Balance columns ──────────────────────────────────────────────────────
  const [columns, setColumns]         = useState([]);
  const [colsLoading, setColsLoading] = useState(true);
  const [newColLabel, setNewColLabel] = useState('');
  const [addingCol, setAddingCol]     = useState(false);
  const [togglingKey, setTogglingKey] = useState(null);
  const [editingKey, setEditingKey]   = useState(null);
  const [editLabel, setEditLabel]     = useState('');

  // ── Monthly transaction columns ──────────────────────────────────────────
  const [transColumns,      setTransColumns]      = useState([]);
  const [transColsLoading,  setTransColsLoading]  = useState(true);
  const [togglingTransKey,  setTogglingTransKey]  = useState(null);

  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [deletingAdminId, setDeletingAdminId] = useState(null);
  const [deletingMembers, setDeletingMembers] = useState(false);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminFullName, setNewAdminFullName] = useState('');
  const [newAdminRole, setNewAdminRole] = useState('admin');

  useEffect(() => {
    api.get('/settings').then((r) => {
      setRate(r.data.settings.loan_interest_rate ?? '5');
      setPenaltyRate(r.data.settings.loan_penalty_rate ?? '10');
    }).finally(() => setLoading(false));

    api.get('/settings/columns').then((r) => {
      setColumns(r.data.columns);
    }).finally(() => setColsLoading(false));

    api.get('/deductions/columns').then((r) => {
      setTransColumns(r.data.columns);
    }).finally(() => setTransColsLoading(false));

    if (isSuperadmin) {
      setAdminsLoading(true);
      api.get('/admin/admins')
        .then((r) => setAdmins(r.data.admins || []))
        .catch((err) => toast(err.response?.data?.error || 'Error loading admins', 'error'))
        .finally(() => setAdminsLoading(false));
    }
  }, []);

  // ── Save loan interest rate ──────────────────────────────────────────────
  const handleSaveRate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/settings', { 
        loan_interest_rate: rate,
        loan_penalty_rate: penaltyRate 
      });
      toast('Settings saved');
    } catch (err) {
      toast(err.response?.data?.error || 'Error saving settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle column enabled ────────────────────────────────────────────────
  const toggleColumn = async (key, currentEnabled) => {
    setTogglingKey(key);
    try {
      const r = await api.put(`/settings/columns/${key}`, { enabled: !currentEnabled });
      setColumns((prev) => prev.map((c) => (c.key === key ? r.data.column : c)));
    } catch (err) {
      toast(err.response?.data?.error || 'Error updating column', 'error');
    } finally {
      setTogglingKey(null);
    }
  };

  // ── Rename column label (custom only) ────────────────────────────────────
  const startEdit = (col) => { setEditingKey(col.key); setEditLabel(col.label); };
  const cancelEdit = () => { setEditingKey(null); setEditLabel(''); };
  const saveEdit = async (key) => {
    if (!editLabel.trim()) return;
    try {
      const r = await api.put(`/settings/columns/${key}`, { label: editLabel.trim() });
      setColumns((prev) => prev.map((c) => (c.key === key ? r.data.column : c)));
      toast('Column renamed');
    } catch (err) {
      toast(err.response?.data?.error || 'Error renaming column', 'error');
    } finally {
      setEditingKey(null); setEditLabel('');
    }
  };

  // ── Add custom column ────────────────────────────────────────────────────
  const addColumn = async (e) => {
    e.preventDefault();
    if (!newColLabel.trim()) return;
    setAddingCol(true);
    try {
      const r = await api.post('/settings/columns', { label: newColLabel.trim() });
      setColumns((prev) => [...prev, r.data.column]);
      setNewColLabel('');
      toast('Column added');
    } catch (err) {
      toast(err.response?.data?.error || 'Error adding column', 'error');
    } finally {
      setAddingCol(false);
    }
  };

  // ── Toggle trans column enabled ────────────────────────────────────────────
  const toggleTransColumn = async (key, currentEnabled) => {
    setTogglingTransKey(key);
    try {
      const r = await api.put(`/deductions/columns/${key}`, { enabled: !currentEnabled });
      setTransColumns((prev) => prev.map((c) => (c.key === key ? r.data.column : c)));
    } catch (err) {
      toast(err.response?.data?.error || 'Error updating column', 'error');
    } finally {
      setTogglingTransKey(null);
    }
  };

  const refreshAdmins = async () => {
    const r = await api.get('/admin/admins');
    setAdmins(r.data.admins || []);
  };

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    setCreatingAdmin(true);
    try {
      await api.post('/admin/admins', {
        username: newAdminUsername.trim(),
        password: newAdminPassword,
        full_name: newAdminFullName.trim() || null,
        role: newAdminRole,
      });
      await refreshAdmins();
      setNewAdminUsername('');
      setNewAdminPassword('');
      setNewAdminFullName('');
      setNewAdminRole('admin');
      toast('Admin created');
    } catch (err) {
      toast(err.response?.data?.error || 'Error creating admin', 'error');
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleDeleteAdmin = async (adminRow) => {
    if (!window.confirm(`Delete admin "${adminRow.username}"?`)) return;
    setDeletingAdminId(adminRow.id);
    try {
      await api.delete(`/admin/admins/${adminRow.id}`);
      await refreshAdmins();
      toast('Admin deleted');
    } catch (err) {
      toast(err.response?.data?.error || 'Error deleting admin', 'error');
    } finally {
      setDeletingAdminId(null);
    }
  };

  const handleDeleteAllMembers = async () => {
    if (!window.confirm('Delete all members? This will also remove linked records through database cascades.')) return;
    setDeletingMembers(true);
    try {
      const r = await api.delete('/admin/members');
      toast(`${r.data.deleted || 0} members deleted`);
    } catch (err) {
      toast(err.response?.data?.error || 'Error deleting members', 'error');
    } finally {
      setDeletingMembers(false);
    }
  };

  // ── Delete custom column ─────────────────────────────────────────────────
  const deleteColumn = async (key, label) => {
    if (!window.confirm(`Delete "${label}"? All stored values for this column will be permanently removed.`)) return;
    try {
      await api.delete(`/settings/columns/${key}`);
      setColumns((prev) => prev.filter((c) => c.key !== key));
      toast('Column deleted');
    } catch (err) {
      toast(err.response?.data?.error || 'Error deleting column', 'error');
    }
  };

  return (
    <Layout title="Settings">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Administration</div>
          <div className="page-title">Settings</div>
        </div>
      </div>

      {/* ── Loan Interest Rate ─────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div className="card" style={{ maxWidth: 480, marginBottom: 28 }}>
          <div className="card-title">Loan Settings</div>
          <form onSubmit={handleSaveRate}>
            <div className="info-box" style={{ marginBottom: 18 }}>
              These rates are applied to all <strong>new loans</strong>. Existing loans are unaffected.
              Interest is calculated as a flat percentage of principal, spread equally across all
              repayment months. Penalty is applied when a monthly payment is missed.
            </div>
            <div className="form-group">
              <label className="form-label">Interest Rate (%)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  style={{ width: 120 }}
                  required
                />
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>%</span>
                <span style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 6 }}>
                  e.g. 5 = 5% of principal added as interest
                </span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Penalty Rate (%)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={penaltyRate}
                  onChange={(e) => setPenaltyRate(e.target.value)}
                  style={{ width: 120 }}
                  required
                />
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>%</span>
                <span style={{ color: 'var(--faint)', fontSize: 11, marginLeft: 6 }}>
                  Applied to remaining interest when payment is missed
                </span>
              </div>
            </div>
            <div style={{ marginTop: 20 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Balance Columns ────────────────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-title">Balance Sheet Columns</div>
        <div className="info-box" style={{ marginBottom: 20 }}>
          Toggle columns on/off to control what appears on the{' '}
          <strong>Member Balances</strong> page and which fields are accepted when uploading a
          balances CSV. <strong>Fixed</strong> columns are computed from recorded transactions;
          <strong> Custom</strong> columns (marked ✦) are set via CSV upload and represent
          miscellaneous deductions/balances (e.g. Form Fee, Welfare Fund).
        </div>

        {colsLoading ? (
          <div style={{ color: 'var(--muted)', padding: '16px 0' }}>Loading columns…</div>
        ) : (
          <div>
            {/* Column list */}
            <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 20 }}>
              {columns.map((col, idx) => (
                <div
                  key={col.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 16px',
                    borderBottom: idx < columns.length - 1 ? '1px solid var(--border)' : 'none',
                    background: col.enabled ? 'transparent' : 'var(--surface-alt, rgba(0,0,0,0.03))',
                    opacity: col.enabled ? 1 : 0.55,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {/* Toggle switch */}
                  <button
                    type="button"
                    onClick={() => toggleColumn(col.key, col.enabled)}
                    disabled={togglingKey === col.key}
                    title={col.enabled ? 'Click to disable' : 'Click to enable'}
                    style={{
                      width: 38, height: 20, borderRadius: 10, padding: 0, border: 'none',
                      background: col.enabled ? 'var(--gold)' : 'var(--border)',
                      cursor: togglingKey === col.key ? 'wait' : 'pointer',
                      position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 2,
                      left: col.enabled ? 20 : 2,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                    }} />
                  </button>

                  {/* Label / edit field */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingKey === col.key ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          className="form-input"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          style={{ height: 30, fontSize: 13, padding: '0 8px', width: 200 }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(col.key);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => saveEdit(col.key)}>Save</button>
                        <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={cancelEdit}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{col.label}</span>
                        {col.type === 'custom' && (
                          <span style={{ fontSize: 9, color: 'var(--gold)', fontWeight: 700 }}>✦ CUSTOM</span>
                        )}
                        {col.type === 'fixed' && (
                          <span style={{ fontSize: 9, color: 'var(--muted)' }}>FIXED</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions (only for custom columns and not in edit mode) */}
                  {col.type === 'custom' && editingKey !== col.key && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={() => startEdit(col)}
                      >
                        Rename
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 10px', fontSize: 12, color: 'var(--danger, #e74c3c)' }}
                        onClick={() => deleteColumn(col.key, col.label)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add custom column */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text)' }}>
                Add Custom Column (Other)
              </div>
              <form onSubmit={addColumn} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  className="form-input"
                  placeholder="e.g. Form Fee, Welfare Fund, Special Levy…"
                  value={newColLabel}
                  onChange={(e) => setNewColLabel(e.target.value)}
                  style={{ flex: 1, maxWidth: 320 }}
                  required
                />
                <button className="btn btn-primary" type="submit" disabled={addingCol || !newColLabel.trim()}>
                  {addingCol ? 'Adding…' : 'Add Column'}
                </button>
              </form>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                Custom columns can be populated via CSV upload on the Member Balances page.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Monthly Transaction Columns ────────────────────────────────── */}
      <div className="card" style={{ maxWidth: 640, marginTop: 28 }}>
        <div className="card-title">Monthly Transaction Columns</div>
        <div className="info-box" style={{ marginBottom: 20 }}>
          These columns are auto-registered when you upload a monthly CSV on the{' '}
          <strong>Monthly Deductions</strong> page. Toggle them on or off to control which
          columns are displayed in the deductions table and CSV export.
        </div>

        {transColsLoading ? (
          <div style={{ color: 'var(--muted)', padding: '16px 0' }}>Loading columns…</div>
        ) : transColumns.length === 0 ? (
          <div className="info-box">
            No columns yet — upload a monthly CSV on the Deductions page to auto-register all fields.
          </div>
        ) : (
          <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {transColumns.map((col, idx) => (
              <div
                key={col.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 16px',
                  borderBottom: idx < transColumns.length - 1 ? '1px solid var(--border)' : 'none',
                  background: col.enabled ? 'transparent' : 'var(--surface-alt, rgba(0,0,0,0.03))',
                  opacity: col.enabled ? 1 : 0.5,
                  transition: 'opacity 0.15s',
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleTransColumn(col.key, col.enabled)}
                  disabled={togglingTransKey === col.key}
                  title={col.enabled ? 'Click to disable' : 'Click to enable'}
                  style={{
                    width: 38, height: 20, borderRadius: 10, padding: 0, border: 'none',
                    background: col.enabled ? 'var(--gold)' : 'var(--border)',
                    cursor: togglingTransKey === col.key ? 'wait' : 'pointer',
                    position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2,
                    left: col.enabled ? 20 : 2,
                    width: 16, height: 16, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                  }} />
                </button>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{col.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isSuperadmin && (
        <div className="card" style={{ maxWidth: 760, marginTop: 28 }}>
          <div className="card-title">Superadmin Controls</div>
          <div className="info-box" style={{ marginBottom: 20 }}>
            Create and remove admin accounts, or clear every member and all cascading records from the database.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
            <form onSubmit={handleCreateAdmin} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <div className="card-title" style={{ marginBottom: 12 }}>Create Admin</div>
              <div className="form-group">
                <label className="form-label">Username</label>
                <input className="form-input" value={newAdminUsername} onChange={(e) => setNewAdminUsername(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-input" value={newAdminFullName} onChange={(e) => setNewAdminFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-input" value={newAdminRole} onChange={(e) => setNewAdminRole(e.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="superadmin">Superadmin</option>
                </select>
              </div>
              <button className="btn btn-primary" type="submit" disabled={creatingAdmin}>
                {creatingAdmin ? 'Creating…' : 'Create Admin'}
              </button>
            </form>

            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <div className="card-title" style={{ marginBottom: 12 }}>Admin Accounts</div>
              {adminsLoading ? (
                <div style={{ color: 'var(--muted)', padding: '12px 0' }}>Loading admins…</div>
              ) : admins.length === 0 ? (
                <div className="info-box">No admins found.</div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {admins.map((adminRow) => (
                    <div key={adminRow.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{adminRow.username}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {adminRow.full_name || 'No name'} · {adminRow.role || 'admin'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ color: 'var(--danger, #e74c3c)' }}
                        disabled={deletingAdminId === adminRow.id || adminRow.username === admin?.username}
                        onClick={() => handleDeleteAdmin(adminRow)}
                      >
                        {deletingAdminId === adminRow.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>Danger Zone</div>
            <div className="info-box" style={{ marginBottom: 12 }}>
              Permanently delete every member and all dependent records.
            </div>
            <button className="btn btn-secondary" type="button" onClick={handleDeleteAllMembers} disabled={deletingMembers} style={{ color: 'var(--danger, #e74c3c)' }}>
              {deletingMembers ? 'Deleting…' : 'Delete All Members'}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}

