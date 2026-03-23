import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';

const PAGE_SIZE = 100; // Increased for better performance with large datasets

export default function Balances() {
  const toast = useToast();
  const fileRef = useRef();

  const [columns, setColumns]     = useState([]);
  const [members, setMembers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch]       = useState('');
  const [dataMonth, setDataMonth] = useState(null);
  const [dataYear,  setDataYear]  = useState(null);
  const [viewMonth, setViewMonth] = useState(null);
  const [viewYear, setViewYear]   = useState(null);
  const [page, setPage]           = useState(1);

  const MONTHS = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  const fetchBalances = async (month = null, year = null) => {
    setLoading(true);
    try {
      const params = month && year ? { month, year } : undefined;
      const r = await api.get('/balances', params ? { params } : undefined);
      setColumns(r.data.columns);
      setMembers(r.data.members);
      setDataMonth(r.data.dataMonth || null);
      setDataYear(r.data.dataYear   || null);

      if (!month && !year && r.data.dataMonth && r.data.dataYear) {
        setViewMonth(r.data.dataMonth);
        setViewYear(r.data.dataYear);
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Error loading balances', 'error');
    } finally {
      setLoading(false);
    }
  };

  const location = useLocation();
  
  // Only fetch when location actually changes (not on every render)
  useEffect(() => { 
    if (!loading) fetchBalances(); 
  }, [location.pathname, location.search, loading]);

  // Only fetch when month/year actually changes
  useEffect(() => {
    if (!viewMonth || !viewYear || loading) return;
    fetchBalances(viewMonth, viewYear);
  }, [viewMonth, viewYear, loading]);

  // ── Filter ────────────────────────────────────────────────────────
  const filtered = useMemo(() => members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.full_name?.toLowerCase().includes(q) ||
      m.ledger_no?.toLowerCase().includes(q) ||
      m.staff_no?.toLowerCase().includes(q)
    );
  }), [members, search]);

  // Reset page on search change
  useEffect(() => { setPage(1); }, [search]);

  // ── Simple row filtering — no per-member totals needed ──
  const rows = filtered;

  // ── Pagination slice ─────────────────────────────────────────────
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows  = useMemo(() => rows.slice(pageStart, pageStart + PAGE_SIZE), [rows, pageStart]);

  // ── Column totals ─────────────────────────────────────────────────
  const colTotals = useMemo(() => columns.reduce((acc, col) => {
    acc[col.key] = filtered.reduce((s, m) => s + (parseFloat(m[col.key]) || 0), 0);
    return acc;
  }, {}), [columns, filtered]);

  // ── CSV export (all enabled columns) ─────────────────────────────────────
  const exportCSV = () => {
    const headers = ['S/N', 'Ledger No', 'Staff No', 'Full Name',
      ...columns.map((c) => c.label)];
    const body = rows.map((m, i) => [
      i + 1,
      m.ledger_no,
      m.staff_no || '',
      `"${m.full_name}"`,
      ...columns.map((c) => (parseFloat(m[c.key]) || 0).toFixed(2)),
    ]);
    body.push(['', '', '', 'TOTAL',
      ...columns.map((c) => (colTotals[c.key] || 0).toFixed(2))]);
    const csv = [headers, ...body].map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `member_balances_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── CSV template (only custom columns) ───────────────────────────────────
  const downloadTemplate = () => {
    const customCols = columns.filter((c) => c.type === 'custom');
    if (!customCols.length) {
      toast('No custom columns are enabled. Add them in Settings first.', 'error');
      return;
    }
    const headers = ['LEDGER NO', 'STAFF NO', 'FULL NAME',
      ...customCols.map((c) => c.label.toUpperCase())];
    const csv = headers.join(',') + '\n';
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'balances_upload_template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── CSV upload (custom columns only) ─────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const customCols = columns.filter((c) => c.type === 'custom');
    if (!customCols.length) {
      toast('No custom columns configured. Add them in Settings first.', 'error');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/balances/upload', fd);
      
      const hasErrors = r.data.errors?.length > 0;
      const parts = [];
      if (r.data.imported > 0) {
        parts.push(`${r.data.imported} record${r.data.imported !== 1 ? 's' : ''} updated`);
      }
      if (r.data.skipped > 0) {
        parts.push(`${r.data.skipped} skipped`);
      }
      if (parts.length === 0) {
        toast('No records processed', 'info');
      } else {
        const message = parts.join(', ');
        toast(message + (hasErrors ? ' (see errors below)' : ''), hasErrors ? 'warning' : 'success');
      }
      
      if (hasErrors) {
        const errorMsg = r.data.errors.slice(0, 5).join('\n');
        toast(errorMsg, 'error');
      }
      
      setTimeout(() => fetchBalances(), 500);
    } catch (err) {
      toast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const customColCount = columns.filter((c) => c.type === 'custom').length;
  const hasSelectedMonth = Boolean(viewMonth && viewYear);
  const missingSelectedData = hasSelectedMonth && (!dataMonth || !dataYear);

  return (
    <Layout title="Member Balances">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Reports</div>
          <div className="page-title">Member Balances</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ width: 140 }}
            value={viewMonth || ''}
            onChange={(e) => setViewMonth(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Month</option>
            {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
          </select>
          <input
            className="form-input"
            type="number"
            style={{ width: 90 }}
            value={viewYear || ''}
            onChange={(e) => {
              const val = e.target.value;
              setViewYear(val ? Number(val) : null);
            }}
            min="2000" max="2100"
            placeholder="Year"
          />
          <button
            className="btn btn-secondary"
            onClick={() => {
              setViewMonth(null);
              setViewYear(null);
              fetchBalances();
            }}
            disabled={loading}
          >
            Latest
          </button>
          <button className="btn btn-secondary" onClick={downloadTemplate}>
            Download Template
          </button>
          <label
            className="btn btn-secondary"
            style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}
          >
            {uploading ? 'Uploading…' : 'Upload CSV'}
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
          <button className="btn btn-primary" onClick={exportCSV} disabled={loading}>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────── */}
      {dataMonth && dataYear && (
        <div style={{
          background: 'rgba(200,168,75,.06)', border: '1px solid rgba(200,168,75,.2)',
          borderRadius: 4, padding: '10px 18px', marginBottom: 14,
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', letterSpacing: 1,
        }}>
          BALANCES AS OF {MONTHS[dataMonth - 1].toUpperCase()} {dataYear}
        </div>
      )}
      <div className="info-box" style={{ marginBottom: 18 }}>
        {dataMonth
          ? <>Showing C/F balances from <strong>{MONTHS[dataMonth - 1]} {dataYear}</strong>.</>
          : missingSelectedData
            ? <>No monthly data found for <strong>{MONTHS[viewMonth - 1]} {viewYear}</strong>. Showing live computed balances instead.</>
            : <><strong>Fixed columns</strong> are computed live from recorded transactions.</>
        }{' '}
        <strong>Custom columns</strong> (e.g. Form Fee, Welfare) are set via CSV upload.{' '}
        {customColCount === 0 && (
          <span>
            No custom columns yet —{' '}
            <Link to="/settings" style={{ color: 'var(--gold)' }}>add them in Settings</Link>.
          </span>
        )}
        {customColCount > 0 && (
          <span>
            You have <strong>{customColCount}</strong> custom column{customColCount > 1 ? 's' : ''}.
            Manage columns in{' '}
            <Link to="/settings" style={{ color: 'var(--gold)' }}>Settings</Link>.
          </span>
        )}
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <input
            className="form-input"
            placeholder="Search by name or ledger no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {filtered.length} member{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: 40 }}>#</th>
                <th style={{ minWidth: 110 }}>Ledger No</th>
                <th style={{ minWidth: 210 }}>Full Name</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    style={{ minWidth: 130, textAlign: 'right' }}
                    title={col.type === 'custom' ? 'Custom column — editable via CSV upload' : 'Computed from transactions'}
                  >
                    {col.label}
                    {col.type === 'custom' && (
                      <span style={{ fontSize: 9, color: 'var(--gold)', marginLeft: 4, verticalAlign: 'middle' }}>✦</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length + 3} style={{ textAlign: 'center', padding: 50, color: 'var(--muted)' }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 3} style={{ textAlign: 'center', padding: 50, color: 'var(--muted)' }}>
                    {search ? 'No members match your search.' : 'No members found.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((m, i) => (
                  <tr key={m.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{pageStart + i + 1}</td>
                    <td>
                      <Link to={`/ledger/${m.id}`} style={{ color: 'var(--gold)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {m.ledger_no}
                      </Link>
                    </td>
                    <td>{m.full_name}</td>
                    {columns.map((col) => (
                      <td key={col.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13 }}>
                        {fmtNGN(m[col.key] || 0)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>

            {!loading && rows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3} style={{ textAlign: 'right', letterSpacing: 1, fontSize: 11 }}>TOTALS</td>
                  {columns.map((col) => (
                    <td key={col.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmtNGN(colTotals[col.key] || 0)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onChange={(p) => { setPage(p); window.scrollTo(0,0); }} />
      </div>

      {customColCount > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ color: 'var(--gold)' }}>✦</span> Custom columns — values are set via CSV upload.
        </div>
      )}
    </Layout>
  );
}
