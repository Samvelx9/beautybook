import Header from './Header.jsx';
import SummaryBanner from './SummaryBanner.jsx';
import SlotPicker from './SlotPicker.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import { formatPrice, localName } from '../i18n.js';
import {
  STEP_MINUTES,
  MIN_BOOKING_MINUTES,
  MAX_BOOKING_MINUTES,
  formatDuration,
} from 'salon-shared/booking';

// A stepper rather than a row of twelve pills: half-hour steps up to six hours
// is too many choices to lay out at phone width.
function StepButton({ label, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? 'plus' : 'minus'}
      style={{
        width: 42,
        height: 42,
        borderRadius: '50%',
        fontSize: 19,
        lineHeight: 1,
        border: '1px solid var(--line)',
        background: disabled ? 'var(--bg)' : 'var(--white)',
        color: disabled ? 'var(--line)' : 'var(--ink)',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

export default function CalendarScreen(f) {
  const { T, lang, backToServices, basket } = f;
  const zoneNames = basket.zones.map((z) => localName(z.service, lang)).join(' · ');
  const summary = `${formatDuration(basket.minutes, T.hourUnit, T.minUnit)} · ${formatPrice(basket.price, lang)}`;
  const hourlyZones = basket.zones.filter((z) => z.service.is_hourly);

  const errorText = f.bannerErrorKey ? T[f.bannerErrorKey] : null;

  return (
    <>
      <Header
        title={T.pickATime}
        onBack={backToServices}
        showDots
        dotStep="calendar"
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div style={{ padding: '0 24px 12px' }}>
        <SummaryBanner
          name={zoneNames}
          subtitle={summary}
          actionLabel={T.change}
          onAction={backToServices}
        />
      </div>

      <ErrorBanner text={errorText} />

      {/* The length sits above the times, not on the previous screen: the point
          of choosing it here is watching which slots survive it, so the guest
          can see straight away whether the master has that long free. */}
      {hourlyZones.map(({ service, minutes, price }) => (
        <div key={service.id} style={{ padding: '0 24px 8px' }}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 14,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {hourlyZones.length > 1 ? localName(service, lang) : T.howLong}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--terracotta)' }}>
                {formatPrice(price, lang)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <StepButton
                label="−"
                disabled={minutes <= MIN_BOOKING_MINUTES}
                onClick={() => f.stepMinutes(service.id, -STEP_MINUTES)}
              />
              <span style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>
                {formatDuration(minutes, T.hourUnit, T.minUnit)}
              </span>
              <StepButton
                label="+"
                disabled={minutes >= MAX_BOOKING_MINUTES}
                onClick={() => f.stepMinutes(service.id, STEP_MINUTES)}
              />
            </div>
          </div>
        </div>
      ))}

      <SlotPicker
        T={T}
        lang={lang}
        slotsData={f.slotsData}
        slotsLoading={f.slotsLoading}
        selectedDayIndex={f.selectedDayIndex}
        selectedSlot={f.selectedSlot}
        selectDay={f.selectDay}
        selectSlot={f.selectSlot}
      />

      {f.selectedSlot && (
        <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
          <button
            onClick={f.continueToDetails}
            style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600 }}
          >
            {T.continueBtn}
          </button>
        </div>
      )}
    </>
  );
}
