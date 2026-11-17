export default function AuthShell({ eyebrow, title, subtitle, children, footer }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{
        width: 400, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--border2)',
        borderRadius: 6, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,.7)',
      }}>
        <div style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)', padding: '30px 36px 24px' }}>
          <div style={{
            width: 36, height: 36, border: '1.5px solid var(--gold-dim)', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14, fontSize: 14, color: 'var(--gold)', fontFamily: 'var(--serif)',
          }}>
            ✦
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 3, color: 'var(--gold)', textTransform: 'uppercase', marginBottom: 4 }}>
            {eyebrow || 'SSANU · FUOYE'}
          </div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 20, color: 'var(--text)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>}
        </div>
        <div style={{ padding: '28px 36px' }}>
          {children}
          {footer && (
            <div style={{ marginTop: 18, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
