import { useEffect, useRef, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import api from '../api';
import { useToast } from '../context/ToastContext';

const PAGE_SIZE = 100;

const fmtNum = (val) =>
  (parseFloat(val) || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Group columns by their group label for the spanning header row
function groupColumns(columns) {
  const groups = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last && last.label === col.group) {
      last.cols.push(col);
    } else {
      groups.push({ label: col.group || '', cols: [col] });
    }
  }
  return groups;
}

export default function Balances() {
  const toast   = useToast();
  const fileRef = useRef();

  const [columns,   setColumns]   = useState([]);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search,    setSearch]    = useState('');
  const [dataMonth, setDataMonth] = useState(null);
  const [dataYear,  setDataYear]  = useState(null);
  const [viewMonth, setViewMonth] = useState(null);
  const [viewYear,  setViewYear]  = useState(null);
  const [page,      setPage]      = useState(1);

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

  useEffect(() => { fetchBalances(); }, []);

  useEffect(() => {
    if (viewMonth && viewYear) fetchBalances(viewMonth, viewYear);
  }, [viewMonth, viewYear]);

  const filtered = useMemo(() => members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.full_name?.toLowerCase().includes(q) ||
      m.ledger_no?.toLowerCase().includes(q)  ||
      m.staff_no?.toLowerCase().includes(q)
    );
  }), [members, search]);

  useEffect(() => { setPage(1); }, [search]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows  = useMemo(
    () => filtered.slice(pageStart, pageStart + PAGE_SIZE),
    [filtered, pageStart]
  );

  const colTotals = useMemo(() => columns.reduce((acc, col) => {
    acc[col.key] = filtered.reduce((s, m) => s + (parseFloat(m[col.key]) || 0), 0);
    return acc;
  }, {}), [columns, filtered]);

  const columnGroups = useMemo(() => groupColumns(columns), [columns]);

  // ── CSV export ────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['S/N', 'Ledger No', 'Staff No', 'Full Name', ...columns.map(c => c.label)];
    const body = filtered.map((m, i) => [
      i + 1, m.ledger_no, m.staff_no || '', `"${m.full_name}"`,
      ...columns.map(c => (parseFloat(m[c.key]) || 0).toFixed(2)),
    ]);
    body.push(['', '', '', 'TOTAL', ...columns.map(c => (colTotals[c.key] || 0).toFixed(2))]);
    const csv = [headers, ...body].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `member_balances_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── CSV template (custom columns only) ───────────────────────────
  const downloadTemplate = () => {
    const customCols = columns.filter(c => c.type === 'custom');
    if (!customCols.length) {
      toast('No custom columns are enabled. Add them in Settings first.', 'error');
      return;
    }
    const headers = ['LEDGER NO', 'STAFF NO', 'FULL NAME', ...customCols.map(c => c.label.toUpperCase())];
    const blob = new Blob(['\uFEFF' + headers.join(',') + '\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'balances_upload_template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── CSV upload ────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const customCols = columns.filter(c => c.type === 'custom');
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
      if (r.data.imported > 0) parts.push(`${r.data.imported} record${r.data.imported !== 1 ? 's' : ''} updated`);
      if (r.data.skipped  > 0) parts.push(`${r.data.skipped} skipped`);
      toast(
        (parts.length ? parts.join(', ') : 'No records processed') + (hasErrors ? ' (see errors below)' : ''),
        parts.length === 0 ? 'info' : hasErrors ? 'warning' : 'success'
      );
      if (hasErrors) toast(r.data.errors.slice(0, 5).join('\n'), 'error');
      setTimeout(() => fetchBalances(viewMonth, viewYear), 500);
    } catch (err) {
      toast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const customColCount = columns.filter(c => c.type === 'custom').length;

  return (
    <Layout title="Member Balances">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Reports</div>
          <div className="page-title">Member Balances</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input" style={{ width: 140 }}
            value={viewMonth || ''}
            onChange={e => setViewMonth(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Month</option>
            {MONTHS.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}
          </select>
          <input
            className="form-input" type="number" style={{ width: 90 }}
            value={viewYear || ''}
            onChange={e => setViewYear(e.target.value ? Number(e.target.value) : null)}
            min="2000" max="2100" placeholder="Year"
          />
          <button className="btn btn-secondary" onClick={() => { setViewMonth(null); setViewYear(null); fetchBalances(); }} disabled={loading}>
            Latest
          </button>
          <button className="btn btn-secondary" onClick={downloadTemplate}>Download Template</button>
          <label className="btn btn-secondary" style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Upload CSV'}
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
          </label>
          <button className="btn btn-primary" onClick={exportCSV} disabled={loading}>Export CSV</button>
        </div>
      </div>

      {/* ── Banner ──────────────────────────────────────────────────── */}
      {dataMonth && dataYear && (
        <div style={{
          background: 'rgba(200,168,75,.06)', border: '1px solid rgba(200,168,75,.2)',
          borderRadius: 4, padding: '10px 18px', marginBottom: 14,
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', letterSpacing: 1,
        }}>
          BALANCES AS OF {MONTHS[dataMonth - 1].toUpperCase()} {dataYear}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="form-input" placeholder="Search by name or ledger no…"
            value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 300 }}
          />
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {filtered.length} member{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              {/* Row 1: group headers */}
              <tr>
                <th colSpan={3} style={{ textAlign: 'center', borderRight: '1px solid var(--border)' }}></th>
                {columnGroups.map((g, gi) => (
                  <th
                    key={gi}
                    colSpan={g.cols.length}
                    style={{
                      textAlign: 'center',
                      background: 'rgba(200,168,75,.08)',
                      borderRight: '1px solid var(--border)',
                      fontSize: 10,
                      letterSpacing: 1,
                      color: 'var(--gold)',
                      padding: '6px 8px',
                    }}
                  >
                    {g.label.toUpperCase()}
                  </th>
                ))}
              </tr>
              {/* Row 2: individual column headers */}
              <tr>
                <th style={{ minWidth: 40 }}>#</th>
                <th style={{ minWidth: 110 }}>Ledger No</th>
                <th style={{ minWidth: 200 }}>Full Name</th>
                {columns.map(col => (
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
                <tr><td colSpan={columns.length + 3} style={{ textAlign: 'center', padding: 50, color: 'var(--muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={columns.length + 3} style={{ textAlign: 'center', padding: 50, color: 'var(--muted)' }}>
                  {search ? 'No members match your search.' : 'No members found.'}
                </td></tr>
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
                    {columns.map(col => (
                      <td key={col.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 13 }}>
                        {fmtNum(m[col.key] || 0)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>

            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3} style={{ textAlign: 'right', letterSpacing: 1, fontSize: 11 }}>TOTALS</td>
                  {columns.map(col => (
                    <td key={col.key} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmtNum(colTotals[col.key] || 0)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={p => { setPage(p); window.scrollTo(0, 0); }} />
      </div>

      {customColCount > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ color: 'var(--gold)' }}>✦</span> Custom columns — values are set via CSV upload.
        </div>
      )}
    </Layout>
  );
}