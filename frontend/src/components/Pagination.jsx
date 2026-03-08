export default function Pagination({ page, pageSize, total, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  // Show up to 7 page buttons: first, last, current ±2, with ellipsis
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 || i === totalPages ||
      (i >= page - 2 && i <= page + 2)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const btn = (label, target, disabled = false, active = false) => (
    <button
      key={`${label}-${target}`}
      onClick={() => typeof target === 'number' && onChange(target)}
      disabled={disabled || typeof target !== 'number'}
      style={{
        minWidth: 32, height: 32, padding: '0 8px',
        borderRadius: 4,
        border: active ? 'none' : '1px solid var(--border)',
        background: active ? 'var(--gold)' : 'transparent',
        color: active ? '#000' : disabled ? 'var(--faint)' : 'var(--text)',
        fontFamily: 'var(--mono)', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
        fontWeight: active ? 700 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 18px', borderTop: '1px solid var(--border)',
      gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
        Showing {from}–{to} of {total}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        {btn('‹', page - 1, page === 1)}
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`ell-${i}`} style={{ minWidth: 32, height: 32, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--faint)' }}>…</span>
            : btn(p, p, false, p === page)
        )}
        {btn('›', page + 1, page === totalPages)}
      </div>
    </div>
  );
}
