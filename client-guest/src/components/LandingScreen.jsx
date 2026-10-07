import { useEffect, useRef } from 'react';
import LangSwitcher from './LangSwitcher.jsx';
import { api } from '../api.js';
import { splitLocalDateTime } from '../lib/time.js';
import { formatPrice, WEEKDAY_FULL, localName } from '../i18n.js';
import { BasketBar } from './ServicesScreen.jsx';
import {
  telHref,
  whatsappHref,
  telegramHref,
  instagramHref,
  emailHref,
  displayHandle,
} from '../lib/contacts.js';
import {
  HeartLeafIcon,
  ClockIcon,
  PhoneIcon,
  ChatIcon,
  SendIcon,
  CameraIcon,
  MailIcon,
  PinIcon,
  ChevronRightIcon,
  CategoryIcon,
} from './Icons.jsx';

// Business hours read Monday-first, the convention in Armenia, while the
// database keys weekly_hours by JS day number (0 = Sunday).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const hhmm = (time) => (time ? time.slice(0, 5) : '');

export default function LandingScreen(f) {
  const { T, lang, site, profile, categories, hours, servicesLoading, catalogueError, selectCategory, goToLookup } = f;
  const treatmentsRef = useRef(null);

  // Any of the master's languages will do when the one being read is blank.
  const localized = (key) => localName(profile, lang, key).trim();
  const ownerName = localized('ownerName') || T.brandName;
  // A page whose trial has run out (or that was switched off) still shows who
  // the master is and how to reach them — just not the booking flow.
  const open = site?.open !== false;

  useEffect(() => {
    if (localized('ownerName')) document.title = ownerName;
  });
  const tagline = localized('tagline') || T.tagline;
  const about = localized('about');
  const address = localized('address');

  // A category with no price list yet would be a dead end — the master may
  // have created it before filling in its zones.
  const bookableCategories = categories.filter((c) => c.services.length > 0);

  const contacts = [
    profile?.phone && { key: 'phone', Icon: PhoneIcon, label: T.callLabel, value: profile.phone, href: telHref(profile.phone) },
    profile?.whatsapp && { key: 'whatsapp', Icon: ChatIcon, label: T.whatsappLabel, value: profile.whatsapp, href: whatsappHref(profile.whatsapp) },
    profile?.telegram && { key: 'telegram', Icon: SendIcon, label: T.telegramLabel, value: displayHandle(profile.telegram), href: telegramHref(profile.telegram) },
    profile?.instagram && { key: 'instagram', Icon: CameraIcon, label: T.instagramLabel, value: displayHandle(profile.instagram), href: instagramHref(profile.instagram) },
    profile?.email && { key: 'email', Icon: MailIcon, label: T.emailLabel, value: profile.email, href: emailHref(profile.email) },
  ].filter(Boolean);

  const openDays = hours.filter((h) => h.is_open);
  // Today as the master's calendar has it, not the viewer's.
  const todayDow = splitLocalDateTime(new Date().toISOString()).dateObj.getDay();

  const scrollToTreatments = () =>
    treatmentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <>
    <div className="scrollarea" style={{ flex: 1, overflowY: 'auto' }}>
      {/* ---------------------------------------------------------------- hero */}
      <div style={{ position: 'relative', padding: '20px 24px 32px', overflow: 'visible' }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(170deg, var(--sage-light) 0%, var(--bg) 78%)',
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -80,
              right: -70,
              width: 220,
              height: 220,
              borderRadius: '50%',
              background: 'var(--terracotta-light)',
              opacity: 0.55,
            }}
          />
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <HeartLeafIcon size={22} />
            <span style={{ fontFamily: "'Newsreader',serif", fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ownerName}
            </span>
          </div>
          <LangSwitcher
            lang={f.lang}
            langMenuOpen={f.langMenuOpen}
            toggleLangMenu={f.toggleLangMenu}
            setLang={f.setLang}
            bg="var(--white)"
          />
        </div>

        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 26 }}>
          <Portrait photoVersion={profile?.photoVersion} ownerName={ownerName} />
          <h1 style={{ marginTop: 18, fontSize: 32, fontWeight: 500, lineHeight: 1.15, textAlign: 'center' }}>
            {ownerName}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.55, color: 'var(--muted)', textAlign: 'center', maxWidth: 340 }}>
            {tagline}
          </p>
          {!open && (
            <p role="status" style={{ marginTop: 22, padding: '12px 16px', borderRadius: 14, background: 'var(--terracotta-light)', fontSize: 14, lineHeight: 1.5, textAlign: 'center', maxWidth: 340 }}>
              {T.pageClosed}
            </p>
          )}
          {open && <button
            onClick={scrollToTreatments}
            style={{
              marginTop: 22,
              padding: '15px 34px',
              borderRadius: 999,
              background: 'var(--sage)',
              color: 'var(--white)',
              fontSize: 15,
              fontWeight: 600,
              boxShadow: '0 10px 24px -12px var(--sage)',
            }}
          >
            {T.bookAppointment}
          </button>}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              goToLookup();
            }}
            style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600 }}
          >
            {T.manageLink}
          </a>
        </div>
      </div>

      {/* --------------------------------------------------------------- about */}
      {about && (
        <Section title={T.aboutMe}>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.75, color: 'var(--ink)', whiteSpace: 'pre-line' }}>
            {about}
          </p>
        </Section>
      )}

      {/* ---------------------------------------------------------- treatments */}
      {open && <div ref={treatmentsRef} style={{ scrollMarginTop: 12 }}>
        <Section title={T.chooseTreatment} caption={T.chooseTreatmentCaption}>
          {servicesLoading && <span style={{ fontSize: 14, color: 'var(--muted)' }}>{T.loading}</span>}
          {catalogueError && (
            <span style={{ fontSize: 14, color: 'var(--terracotta)' }}>{T.genericError}</span>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {bookableCategories.map((category) => (
              <TreatmentCard
                key={category.id}
                T={T}
                lang={lang}
                category={category}
                onSelect={() => selectCategory(category.id)}
              />
            ))}
          </div>
        </Section>
      </div>}

      {/* ------------------------------------------------------------ contacts */}
      {contacts.length > 0 && (
        <Section title={T.getInTouch}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map(({ key, Icon, label, value, href }) => (
              <a
                key={key}
                href={href}
                target={href.startsWith('http') ? '_blank' : undefined}
                rel={href.startsWith('http') ? 'noreferrer' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 14px',
                  borderRadius: 14,
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: 'var(--sage-light)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={18} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {value}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* ----------------------------------------------------- address & hours */}
      {(address || openDays.length > 0) && (
        <Section title={T.whereToFindMe}>
          {address && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'var(--terracotta-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <PinIcon size={18} color="var(--terracotta)" />
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{address}</p>
                {profile?.mapUrl && (
                  <a
                    href={profile.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-block', marginTop: 6, fontSize: 13, fontWeight: 600 }}
                  >
                    {T.openInMaps} →
                  </a>
                )}
              </div>
            </div>
          )}

          {openDays.length > 0 && (
            <div
              style={{
                marginTop: address ? 18 : 0,
                padding: 16,
                borderRadius: 16,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <ClockIcon size={16} />
                <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  {T.openingHours}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {WEEK_ORDER.map((dow) => {
                  const row = hours.find((h) => h.day_of_week === dow);
                  if (!row) return null;
                  const isToday = dow === todayDow;
                  return (
                    <div
                      key={dow}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontSize: 13.5,
                        fontWeight: isToday ? 700 : 400,
                        color: isToday ? 'var(--ink)' : 'var(--muted)',
                      }}
                    >
                      <span>{WEEKDAY_FULL[lang][dow]}</span>
                      <span>
                        {row.is_open ? `${hhmm(row.start_time)} – ${hhmm(row.end_time)}` : T.closedDay}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>
      )}

      <div style={{ padding: '8px 24px 32px', textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.brandName}</span>
      </div>
    </div>
    {f.basket.zones.length > 0 && (
      <BasketBar T={T} lang={lang} basket={f.basket} onContinue={f.continueToCalendar} />
    )}
    </>
  );
}

function Portrait({ photoVersion, ownerName }) {
  const ring = {
    width: 138,
    height: 138,
    borderRadius: '50%',
    border: '4px solid var(--white)',
    boxShadow: '0 14px 34px -14px rgba(0,0,0,0.35)',
    objectFit: 'cover',
    display: 'block',
    background: 'var(--sage-light)',
  };

  if (photoVersion) {
    return <img src={api.photoUrl(photoVersion)} alt={ownerName} style={ring} />;
  }

  // No photo uploaded yet — a monogram keeps the hero composed rather than
  // leaving a hole in the layout.
  return (
    <div
      style={{
        ...ring,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Newsreader',serif",
        fontSize: 52,
        color: 'var(--sage)',
      }}
    >
      {ownerName.slice(0, 1)}
    </div>
  );
}

function Section({ title, caption, children }) {
  return (
    <div style={{ padding: '22px 24px 0' }}>
      <h3 style={{ fontSize: 19, fontWeight: 500, marginBottom: caption ? 4 : 12 }}>{title}</h3>
      {caption && <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)' }}>{caption}</p>}
      {children}
    </div>
  );
}

function TreatmentCard({ T, lang, category, onSelect }) {
  const fromPrice = Math.min(...category.services.map((s) => s.price));
  const description = localName(category, lang, 'description');

  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 16,
        borderRadius: 18,
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: 'var(--sage-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <CategoryIcon slug={category.slug} size={24} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: "'Newsreader',serif", fontSize: 17, color: 'var(--ink)' }}>
          {localName(category, lang)}
        </span>
        {description && (
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>{description}</span>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--terracotta)' }}>
          {T.fromPrice} {formatPrice(fromPrice, lang)}
        </span>
      </span>
      <ChevronRightIcon size={18} color="var(--muted)" />
    </button>
  );
}
