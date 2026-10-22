// Each master's colour on the salon's Bookings screen — the same eight the
// server allows (MASTER_COLORS in server/src/services/masters.js); the shades
// are CSS variables in index.css. The server answers every master with one
// (their chosen colour, or the automatic one for their place in the salon).
export const MASTER_COLORS = ['rose', 'orange', 'mustard', 'green', 'teal', 'blue', 'violet', 'magenta'];

export const masterColor = (key) => `var(--mc-${MASTER_COLORS.includes(key) ? key : 'teal'})`;
export const masterTint = (key) => `var(--mc-${MASTER_COLORS.includes(key) ? key : 'teal'}-light)`;

// A small round swatch, the master's mark wherever their name appears.
export function MasterDot({ color, size = 9, style, title }) {
  return (
    <span
      aria-hidden={title ? undefined : 'true'}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: masterColor(color),
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
