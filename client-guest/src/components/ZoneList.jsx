import { localName } from '../i18n.js';
// Shared by the confirmation, manage and cancel screens.
// A booking's zones, one per line — a visit covering three of them shouldn't be
// squeezed onto a single row.
export default function ZoneList({ items, lang }) {
  const zones = items ?? [];
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      {zones.map((z, i) => (
        <span key={`${z.service_id}-${i}`} style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>
          {localName(z, lang)}
        </span>
      ))}
    </span>
  );
}
