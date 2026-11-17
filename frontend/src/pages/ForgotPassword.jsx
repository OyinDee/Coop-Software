import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import AuthShell from '../components/AuthShell';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSending(true);
    try {
      const r = await api.post('/auth/forgot-password', { identifier: identifier.trim() });
      setMessage(r.data.message || 'If that account exists, a reset link is on its way.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the reset link. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your ledger number, staff number, email address or admin username."
      footer={<Link to="/login" style={{ color: 'var(--gold)' }}>← Back to sign in</Link>}
    >
      <form onSubmit={handleSubmit}>
        {message && (
          <div className="info-box" role="status" style={{ marginBottom: 18 }}>{message}</div>
        )}
        {error && (
          <div className="info-box" role="alert" style={{ borderColor: 'rgba(241,96,96,.4)', color: 'var(--red)', marginBottom: 18 }}>
            {error}
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="identifier">Ledger no, staff no, email or username</label>
          <input
            id="identifier"
            className="form-input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={sending}
          style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 12, letterSpacing: 2 }}
        >
          {sending ? 'Sending…' : 'Send reset link'}
        </button>

        <div style={{ marginTop: 14, fontSize: 10, color: 'var(--faint)', textAlign: 'center', lineHeight: 1.6 }}>
          No email on file? Ask the cooperative office for a temporary password.
        </div>
      </form>
    </AuthShell>
  );
}
