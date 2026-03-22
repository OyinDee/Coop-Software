import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const CORE_NAV = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Members', to: '/members' },
  { label: 'Ledger', to: '/ledger' },
  { label: 'Loans', to: '/loans' },
  { label: 'Savings', to: '/savings' },
];

const REPORTS_NAV = [
  { label: 'Transactions', to: '/transactions' },
  { label: 'Balances', to: '/balances' },
  { label: 'Deductions', to: '/deductions' },
];

const ADMIN_NAV = [
  { label: 'Commodity', to: '/commodity' },
  { label: 'Reactivate', to: '/reactivate' },
  { label: 'Settings', to: '/settings' },
];

function NavDropdown({ label, items }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          fontSize: 11,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: 'var(--muted)',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          transition: 'all .15s',
        }}
      >
        {label}
        <svg width="8" height="8" style={{ marginLeft: 4 }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          minWidth: 160,
          padding: '4px 0',
          marginTop: 2,
        }}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'block',
                padding: '8px 16px',
                fontSize: 11,
                color: isActive ? 'var(--gold)' : 'var(--text)',
                background: isActive ? 'rgba(200,168,75,.1)' : 'transparent',
                textDecoration: 'none',
                transition: 'all .15s',
              })}
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopNav() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  return (
    <nav style={{
      background: 'var(--surface)', 
      borderBottom: '1px solid var(--border)',
      padding: '0 20px',
      display: 'flex',
      alignItems: 'center',
      height: 56,
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        marginRight: 'auto',
        gap: 12
      }}>
        <div style={{ 
          fontFamily: 'var(--mono)', 
          fontSize: 10, 
          letterSpacing: 2, 
          color: 'var(--gold)', 
          textTransform: 'uppercase',
          lineHeight: 1
        }}>
          SSANU FUOYE
        </div>
        <div style={{ 
          fontFamily: 'var(--serif)', 
          fontSize: 16, 
          lineHeight: 1.2,
          color: 'var(--text)'
        }}>
          Co-op
        </div>
      </div>

      {/* Compact Navigation */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 4,
        marginRight: 16
      }}>
        {CORE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              padding: '8px 10px',
              fontSize: 11, 
              letterSpacing: 0.3, 
              textTransform: 'uppercase',
              color: isActive ? 'var(--gold)' : 'var(--muted)',
              background: isActive ? 'rgba(200,168,75,.1)' : 'transparent',
              borderRadius: 4,
              textDecoration: 'none', 
              transition: 'all .15s',
              whiteSpace: 'nowrap'
            })}
          >
            {item.label}
          </NavLink>
        ))}
        
        <NavDropdown label="Reports" items={REPORTS_NAV} />
        <NavDropdown label="Admin" items={ADMIN_NAV} />
      </div>

      {/* User Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
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
        }}>
          {admin?.username?.[0]?.toUpperCase() || 'A'}
        </div>
        
        <button
          onClick={toggle}
          className="btn btn-ghost btn-sm"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ padding: '6px' }}
        >
          {theme === 'dark' ? (
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
            </svg>
          ) : (
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
        
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="btn btn-ghost btn-sm"
          title="Sign out"
          style={{ padding: '6px' }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
