import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import AuthShell from '../components/AuthShell';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setMessage('Your password has been changed. You can now sign in with it.');
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset the password. Request a new link.');
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Reset link is incomplete" subtitle="This page needs the link from your reset email.">
        <div className="info-box" style={{ marginBottom: 18 }}>
          The reset link is missing its token. Request a new link to continue.
        </div>
        <Link to="/forgot-password" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }}>
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Use at least 6 characters. Avoid your ledger number and date of birth."
      footer={<Link to="/login" style={{ color: 'var(--gold)' }}>← Back to sign in</Link>}
    >
      {message ? (
        <>
          <div className="info-box" role="status" style={{ marginBottom: 18 }}>{message}</div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }} onClick={() => navigate('/login')}>
            Go to sign in
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="info-box" role="alert" style={{ borderColor: 'rgba(241,96,96,.4)', color: 'var(--red)', marginBottom: 18 }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              className="form-input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 12, letterSpacing: 2 }}
          >
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
