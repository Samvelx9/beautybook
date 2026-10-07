export default function ProgressDots({ step }) {
  const dot2 = true; // Header only renders this on the calendar/details steps
  const dot3 = step === 'details';
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage)' }} />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot2 ? 'var(--sage)' : 'var(--line)' }} />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot3 ? 'var(--sage)' : 'var(--line)' }} />
    </div>
  );
}
