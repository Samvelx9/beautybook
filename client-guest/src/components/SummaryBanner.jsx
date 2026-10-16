import { rem } from '../lib/rem.js';

export default function SummaryBanner({ name, subtitle, actionLabel, onAction }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: rem(14), fontWeight: 500 }}>{name}</span>
        <span style={{ fontSize: rem(12), color: 'var(--muted)' }}>{subtitle}</span>
      </div>
      <a href="#" onClick={(e) => { e.preventDefault(); onAction(); }} style={{ fontSize: rem(12), fontWeight: 600 }}>
        {actionLabel}
      </a>
    </div>
  );
}
