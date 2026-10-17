// Above a salon owner's calendar screens: whose calendar is showing. On
// Bookings it also offers every master at once; on the landing page, the
// salon page itself.
export default function MasterPicker({ T, masters, value, allowAll, allowSalon, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '16px 20px 0' }}>
      <label htmlFor="master-picker" style={{ fontSize: 13, color: 'var(--muted)' }}>
        {T.pickerLabel}
      </label>
      <select
        id="master-picker"
        className="field-input"
        style={{ width: 'auto', minWidth: 200 }}
        value={String(value)}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'all' || v === 'salon' ? v : Number(v));
        }}
      >
        {allowAll && <option value="all">{T.pickerAll}</option>}
        {allowSalon && <option value="salon">{T.pickerSalonPage}</option>}
        {masters.map((m) => (
          <option key={m.id} value={String(m.id)}>
            {(m.name || m.slug) + (m.isOwner ? ` (${T.pickerYou})` : '')}
          </option>
        ))}
      </select>
    </div>
  );
}
