import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: 400, background: 'var(--surface)', border: '1px solid var(--border2)',
        borderRadius: 6, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,.7)',
      }}>
        {/* Header */}
        <div style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)', padding: '30px 36px 24px' }}>
          <div style={{
            width: 36, height: 36, border: '1.5px solid var(--gold-dim)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14, fontSize: 14, color: 'var(--gold)', fontFamily: 'var(--serif)',
          }}>
            ✦
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 3, color: 'var(--gold)', textTransform: 'uppercase', marginBottom: 4 }}>
            SSANU · FUOYE
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 20, color: 'var(--text)' }}>Cooperative Society</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Administrator Portal</div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: '32px 36px' }}>
          {error && (
            <div style={{
              background: 'rgba(241,96,96,.1)', border: '1px solid rgba(241,96,96,.3)',
              borderRadius: 3, padding: '10px 14px', fontSize: 12, color: 'var(--red)', marginBottom: 18,
            }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 12, letterSpacing: 2 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div style={{ marginTop: 14, fontSize: 10, color: 'var(--faint)', textAlign: 'center', fontFamily: 'var(--mono)', letterSpacing: .5 }}>
            Demo: admin / admin123
          </div>
        </form>
      </div>
    </div>
  );
}
