import TopNav from './TopNav';

export default function Layout({ title, actions, children }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

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
