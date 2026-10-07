import Header from './Header.jsx';
import SummaryBanner from './SummaryBanner.jsx';
import { formatDateAt, parseLocalDate, localName, formatNotice, getMinNotice } from '../i18n.js';

export default function DetailsScreen(f) {
  const { T, lang, basket, backToCalendar } = f;
  const zoneNames = basket.zones.map((z) => localName(z.service, lang)).join(' · ');
  const day = f.slotsData?.days[f.selectedDayIndex];
  const dateTimeSummary = day && f.selectedSlot ? formatDateAt(parseLocalDate(day.date), f.selectedSlot, lang) : '';

  return (
    <>
      <Header
        title={T.yourDetails}
        onBack={backToCalendar}
        showDots
        dotStep="details"
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div style={{ padding: '0 24px 12px' }}>
        <SummaryBanner
          name={zoneNames}
          subtitle={dateTimeSummary}
          actionLabel={T.edit}
          onAction={backToCalendar}
        />
      </div>

      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '6px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.nameLabel}</label>
          <input
            type="text"
            value={f.name}
            onChange={(e) => f.onNameChange(e.target.value)}
            placeholder={T.namePlaceholder}
            style={{ padding: 14, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 15, color: 'var(--ink)' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>{T.phoneLabel}</label>
          <input
            type="tel"
            value={f.phone}
            onChange={(e) => f.onPhoneChange(e.target.value)}
            placeholder="+ … … …"
            style={{ padding: 14, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', fontSize: 15, color: 'var(--ink)' }}
          />
        </div>

        {f.formError && (
          <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--terracotta)' }}>{T.formError}</p>
        )}
        {f.bannerErrorKey && (
          <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--terracotta)' }}>{T[f.bannerErrorKey]}</p>
        )}

        <p style={{ margin: '20px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{T.detailsCaption(getMinNotice() ? formatNotice(getMinNotice(), lang) : '')}</p>
      </div>

      <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <button
          onClick={f.confirmBooking}
          disabled={f.busy}
          style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600, opacity: f.busy ? 0.7 : 1 }}
        >
          {T.confirmBookingBtn}
        </button>
      </div>
    </>
  );
}
