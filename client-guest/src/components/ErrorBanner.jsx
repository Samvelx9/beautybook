import { rem } from '../lib/rem.js';

export default function ErrorBanner({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        margin: '0 24px 8px',
        padding: '10px 14px',
        borderRadius: 12,
        background: 'var(--terracotta-light)',
        color: 'var(--terracotta)',
        fontSize: rem(12.5),
        fontWeight: 500,
      }}
    >
      {text}
    </div>
  );
}
