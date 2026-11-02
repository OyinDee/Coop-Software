import { useNavigate } from 'react-router-dom';
import TopNav from './TopNav';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

function MemberHeader({ actions }) {
  const { admin, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 10,
      padding: '10px 20px',
      minHeight: 56,
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 'auto' }}>
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: 2,
          color: 'var(--gold)',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}>
          SSANU FUOYE
        </div>
        <div style={{
          fontFamily: 'var(--serif)',
          fontSize: 16,
          lineHeight: 1.2,
          color: 'var(--text)',
        }}>
          Co-op
        </div>
      </div>

      {/* Period selector */}
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}

      {/* Account */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          title={admin?.fullName || admin?.username || 'Member'}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--surface2)',
            border: '1px solid var(--border2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: 'var(--gold)',
            fontWeight: 600,
          }}
        >
          {(admin?.fullName || admin?.username || 'M')[0].toUpperCase()}
        </div>

        <button
          onClick={toggle}
          className="btn btn-ghost btn-sm"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ padding: '6px' }}
        >
          {theme === 'dark' ? (
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
            </svg>
          ) : (
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>

        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
          </svg>
          Sign out
        </button>
      </div>
    </header>
  );
}

export default function Layout({ title, actions, children, variant = 'admin' }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Member portal: a single page with no app navigation at all.
  if (variant === 'member') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <MemberHeader actions={actions} />
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{
            maxWidth: 1040,
            width: '100%',
            margin: '0 auto',
            padding: '28px 20px 48px',
            paddingLeft: 'max(20px, env(safe-area-inset-left))',
            paddingRight: 'max(20px, env(safe-area-inset-right))',
          }}>
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav />
      
      {/* Page Header */}
      <div style={{
        padding: '0 28px', height: 52, borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--surface)', flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 17 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: 1 }}>{dateStr}</span>
          {actions}
        </div>
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 28px' }}>
        {children}
      </div>
    </div>
  );
}
