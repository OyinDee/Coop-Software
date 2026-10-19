import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import api from '../api';
import { fmtNGN } from '../utils/format';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 25;

export default function PersonalLedger() {
  const { admin } = useAuth();
  const isPayroll = admin?.role === 'payroll';
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [emailMonth, setEmailMonth] = useState(new Date().getMonth() + 1);
  const [emailYear, setEmailYear] = useState(new Date().getFullYear());
  const [sendingReports, setSendingReports] = useState(false);
  const [reportProgress, setReportProgress] = useState(null); // { sent: 0, skipped: 0, failed: 0, total: 0 }
  const navigate = useNavigate();
  const toast = useToast();

  const load = (q = '') => {
    setLoading(true);
    api.get('/members', { params: q ? { search: q } : {} })
      .then((r) => { setMembers(r.data.members); setTotal(r.data.total); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (!isPayroll) load(); }, [isPayroll]);
  useEffect(() => {
    if (isPayroll) return undefined;
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search, isPayroll]);

  useEffect(() => { setPage(1); }, [search]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageMembers = members.slice(pageStart, pageStart + PAGE_SIZE);

  const sendMonthlyReports = async () => {
    setSendingReports(true);
    setReportProgress(null);
    try {
      const preview = await api.post('/members/reports/email-monthly', {
        month: emailMonth,
        year: emailYear,
        preview: true,
      });
      const totalCount = preview.data.total_count || 0;

      if (totalCount === 0) {
        toast('No active members with email addresses found.', 'warning');
        setSendingReports(false);
        return;
      }

      if (!window.confirm(`Send monthly reports for ${emailMonth}/${emailYear} to ${totalCount} members with email addresses?`)) {
        setSendingReports(false);
        return;
      }

      const chunkSize = 10;
      let sentCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      setReportProgress({ sent: 0, skipped: 0, failed: 0, total: totalCount });

      for (let offset = 0; offset < totalCount; offset += chunkSize) {
        try {
          const response = await api.post('/members/reports/email-monthly', {
            month: emailMonth,
            year: emailYear,
            batch_offset: offset,
            batch_size: chunkSize,
          });
          const data = response.data;
          sentCount += data.sent_count || 0;
          skippedCount += data.skipped_count || 0;
          failedCount += data.failed_count || 0;
        } catch (err) {
          failedCount += Math.min(chunkSize, totalCount - offset);
          console.error('Error sending batch:', err);
        }

        setReportProgress({
          sent: sentCount,
          skipped: skippedCount,
          failed: failedCount,
          total: totalCount
        });
      }

      toast(`Finished sending reports. Sent: ${sentCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to send reports', 'error');
    } finally {
      setSendingReports(false);
      setReportProgress(null);
    }
  };

  if (isPayroll) {
    return (
      <Layout title="Email Reports">
        <div className="page-header">
          <div>
            <div className="page-eyebrow">Member communications</div>
            <div className="page-title">Email Monthly Reports</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="form-input" style={{ height: 34, minWidth: 72 }} value={emailMonth} onChange={(e) => setEmailMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
            <input className="form-input" type="number" min="2000" max="9999" style={{ height: 34, width: 92 }} value={emailYear} onChange={(e) => setEmailYear(Number(e.target.value || new Date().getFullYear()))} />
            <button className="btn btn-primary btn-sm" onClick={sendMonthlyReports} disabled={sendingReports}>
              {sendingReports ? (reportProgress ? `Sending (${reportProgress.sent + reportProgress.skipped + reportProgress.failed}/${reportProgress.total})...` : 'Starting...') : 'Email Monthly Reports'}
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Personal Ledger">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Select a member</div>
          <div className="page-title">Personal Ledger</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="form-input" style={{ height: 34, minWidth: 72 }} value={emailMonth} onChange={(e) => setEmailMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
          <input
            className="form-input"
            type="number"
            min="2000"
            max="9999"
            style={{ height: 34, width: 92 }}
            value={emailYear}
            onChange={(e) => setEmailYear(Number(e.target.value || new Date().getFullYear()))}
          />
          <button className="btn btn-primary btn-sm" onClick={sendMonthlyReports} disabled={sendingReports}>
            {sendingReports 
              ? (reportProgress 
                  ? `Sending (${reportProgress.sent + reportProgress.skipped + reportProgress.failed}/${reportProgress.total})...`
                  : 'Starting...')
              : 'Email Monthly Reports'}
          </button>
        </div>
      </div>

      <div className="search-bar">
        <svg width="14" height="14" fill="none" stroke="var(--faint)" strokeWidth="1.8" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          placeholder="Search member…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--faint)' }}>{total} members</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ledger No</th><th>Name</th><th>Staff No</th><th>Department</th>
                <th>Savings</th><th>Loan Balance</th><th>Interest Due</th><th>Loans</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pageMembers.map((m) => (
                <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/ledger/${m.id}`)}>
                  <td className="td-mono td-gold">{m.ledger_no}</td>
                  <td>{m.full_name}</td>
                  <td className="td-muted td-mono" style={{ fontSize: 11 }}>{m.staff_no || '—'}</td>
                  <td className="td-muted">{m.department || '—'}</td>
                  <td className="td-green">{parseFloat(m.total_savings) > 0 ? fmtNGN(m.total_savings) : '—'}</td>
                  <td className={parseFloat(m.loan_balance) > 0 ? 'td-red' : 'td-muted'}>{parseFloat(m.loan_balance) > 0 ? fmtNGN(m.loan_balance) : '—'}</td>
                  <td className={parseFloat(m.interest_due) > 0 ? 'td-amber' : 'td-muted'}>{parseFloat(m.interest_due) > 0 ? fmtNGN(m.interest_due) : '—'}</td>
                  <td>{parseInt(m.active_loans) > 0 ? <span className="badge badge-amber">{m.active_loans} active</span> : <span className="badge badge-green">Clear</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/ledger/${m.id}`); }}>Open</button></td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan="9" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)' }}>No members found</td></tr>}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={members.length} onChange={(p) => { setPage(p); window.scrollTo(0, 0); }} />
      </div>
    </Layout>
  );
}
