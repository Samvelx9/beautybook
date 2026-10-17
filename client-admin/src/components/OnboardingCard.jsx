import { useEffect, useState } from 'react';
import { api } from '../api.js';

// The first things a new account has to do before it's worth sharing, at the
// top of the dashboard until the ones that can be checked are done.
//
// - A master: a photo or intro, at least one priced zone switched on (unless
//   the price list is a salon owner's to keep), and Telegram. Hours and
//   sharing can't be checked, so they're offered as links throughout.
// - A salon's owner: the masters, the price list, and the salon's Telegram.
export default function OnboardingCard({ T, account, salon, setTab }) {
  const [state, setState] = useState(null);
  const isSalonOwner = account.organization.kind === 'salon' && account.role === 'owner';
  const ownsPriceList = account.role === 'owner';

  useEffect(() => {
    let cancelled = false;
    Promise.all([isSalonOwner ? null : api.getProfile(), api.getServices()])
      .then(([profile, services]) => {
        if (cancelled) return;
        setState({
          profile: Boolean(profile && (profile.photoVersion || profile.aboutEn || profile.aboutRu || profile.aboutHy)),
          services: services.some((s) => s.is_active && s.price > 0),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSalonOwner]);

  if (!state) return null;

  let steps;
  if (isSalonOwner) {
    const telegramDone = account.organization.telegramConnected;
    steps = [
      { key: 'masters', label: T.stepMasters, done: (salon?.masters.length ?? 0) > 0, go: () => setTab('masters') },
      { key: 'services', label: T.stepServices, done: state.services, go: () => setTab('categories') },
      ...(account.telegramAvailable
        ? [{ key: 'telegram', label: T.stepSalonTelegram, done: telegramDone, go: () => setTab('settings') }]
        : []),
    ];
    if (steps.every((step) => step.done)) return null;
  } else {
    const telegram = account.master.telegramConnected || !account.telegramAvailable;
    if (state.profile && (state.services || !ownsPriceList) && telegram) return null;
    steps = [
      { key: 'profile', label: T.stepProfile, done: state.profile, go: () => setTab('profile') },
      ...(ownsPriceList
        ? [{ key: 'services', label: T.stepServices, done: state.services, go: () => setTab('categories') }]
        : []),
      { key: 'hours', label: T.stepHours, done: null, go: () => setTab('availability') },
      ...(account.telegramAvailable
        ? [{ key: 'telegram', label: T.stepTelegram, done: account.master.telegramConnected, go: () => setTab('settings') }]
        : []),
      { key: 'share', label: T.stepShare, done: null, href: account.master.siteUrl },
    ];
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--sage)' }}>
      <h3 style={{ fontSize: 18, fontWeight: 500 }}>{T.onboardingTitle}</h3>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => (
          <li key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
            <span
              aria-hidden="true"
              style={{
                width: 24,
                height: 24,
                flexShrink: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                background: step.done ? 'var(--sage)' : 'var(--sage-light)',
                color: step.done ? 'var(--white)' : 'var(--ink)',
              }}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <span style={{ flex: 1, color: step.done ? 'var(--muted)' : 'var(--ink)', textDecoration: step.done ? 'line-through' : 'none' }}>
              {step.label}
            </span>
            {!step.done &&
              (step.href ? (
                <a href={step.href} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600 }}>
                  {T.openPage} ↗
                </a>
              ) : (
                <button onClick={step.go} style={{ fontSize: 13, fontWeight: 600, color: 'var(--sage)' }}>
                  {T.stepGo} →
                </button>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
