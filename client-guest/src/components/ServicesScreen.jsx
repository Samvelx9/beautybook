import LangSwitcher from './LangSwitcher.jsx';
import { formatPrice, pluralize, localName } from '../i18n.js';
import { formatDuration } from 'salon-shared/booking';
import { ClockIcon, ChevronLeftIcon, CategoryIcon } from './Icons.jsx';

// The price list for one treatment. Zones toggle rather than replace one
// another: a visit often covers several, and going back to the landing page for
// another treatment keeps everything already chosen.
export default function ServicesScreen(f) {
  const { T, lang, selectedCategory, servicesLoading, toggleService, continueToCalendar, backToLanding } = f;

  const zones = selectedCategory?.services ?? [];
  // The length of an hourly booking is chosen on the next screen, against the
  // real schedule — see CalendarScreen. Here the rate is all that's shown.
  const isHourly = Boolean(selectedCategory?.is_hourly);
  const chosen = f.selectedServiceIds;

  return (
    <>
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ position: 'relative', padding: '20px 24px 8px' }}>
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <div
              style={{
                position: 'absolute',
                top: -70,
                right: -50,
                width: 190,
                height: 190,
                borderRadius: '50%',
                background: 'var(--sage-light)',
                opacity: 0.55,
              }}
            />
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={backToLanding}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <ChevronLeftIcon size={19} color="var(--ink)" strokeWidth={2} />
            </button>
            <span style={{ flex: 1 }} />
            <LangSwitcher
              lang={f.lang}
              langMenuOpen={f.langMenuOpen}
              toggleLangMenu={f.toggleLangMenu}
              setLang={f.setLang}
              bg="var(--white)"
            />
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: 15,
                background: 'var(--white)',
                border: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CategoryIcon slug={selectedCategory?.slug} size={24} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.2 }}>
                {selectedCategory ? localName(selectedCategory, lang) : ''}
              </h2>
              {localName(selectedCategory, lang, 'description') && (
                <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
                  {localName(selectedCategory, lang, 'description')}
                </p>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 24px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--muted)', textTransform: 'uppercase' }}>
            {T.step1of3}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage)' }} />
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--line)' }} />
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--line)' }} />
          </div>
        </div>

        <div style={{ padding: '12px 24px 8px' }}>
          <h3 style={{ fontSize: 19, fontWeight: 500 }}>{T.chooseZone}</h3>
        </div>

        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {servicesLoading && <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T.loading}</span>}
          {!servicesLoading && zones.length === 0 && (
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T.noZonesYet}</span>
          )}
          {zones.map((s) => {
            const selected = chosen.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleService(s.id)}
                style={{
                  textAlign: 'left',
                  width: '100%',
                  padding: 16,
                  borderRadius: 16,
                  border: selected ? '1.5px solid var(--sage)' : '1px solid var(--line)',
                  background: selected ? 'var(--sage-light)' : 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  transition: 'background 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: "'Newsreader',serif", fontSize: 16, color: 'var(--ink)' }}>{localName(s, lang)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' }}>
                    <ClockIcon size={13} color="var(--muted)" strokeWidth={2} />
                    {isHourly ? T.byTheHour : `${s.duration_minutes} ${T.minUnit}`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--terracotta)' }}>
                    {formatPrice(s.price, lang)}
                    {isHourly && <span style={{ fontSize: 11, fontWeight: 500 }}> {T.perHourSuffix}</span>}
                  </span>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      border: selected ? '1.5px solid var(--sage)' : '1.5px solid var(--line)',
                      background: selected ? 'var(--sage)' : 'transparent',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selected && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--white)', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                        <path d="M5 13L9.5 17.5L19 7"></path>
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {chosen.length > 0 && (
        <BasketBar T={T} lang={lang} basket={f.basket} onContinue={continueToCalendar} onAddMore={backToLanding} />
      )}
    </>
  );
}

// What the visit adds up to so far, and the two ways forward: another treatment
// or a time. Shown on the zone list and on the landing page, so the basket is
// never out of sight once something is in it.
export function BasketBar({ T, lang, basket, onContinue, onAddMore }) {
  return (
    <div style={{ padding: '12px 24px 18px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {basket.zones.length} {pluralize(basket.zones.length, lang, 'zones')} · {formatDuration(basket.minutes, T.hourUnit, T.minUnit)}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--terracotta)' }}>
          {formatPrice(basket.price, lang)}
        </span>
      </div>
      {onAddMore && (
        <button
          onClick={onAddMore}
          style={{
            width: '100%',
            padding: 12,
            borderRadius: 999,
            border: '1px solid var(--line)',
            background: 'var(--white)',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: 8,
          }}
        >
          {T.addAnotherTreatment}
        </button>
      )}
      <button
        onClick={onContinue}
        style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600 }}
      >
        {T.continueBtn}
      </button>
    </div>
  );
}
