import { useEffect, useState } from 'react';
import { api } from '../api.js';

// The first things a new master has to do before their page is worth sharing,
// at the top of the dashboard until the ones that can be checked are done: a
// photo or intro, at least one priced zone switched on, and Telegram. Hours
// and sharing can't be checked, so they're offered as links throughout.
export default function OnboardingCard({ T, account, setTab }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getProfile(), api.getServices()])
      .then(([profile, services]) => {
        if (cancelled) return;
        setState({
          profile: Boolean(profile.photoVersion || profile.aboutEn || profile.aboutRu || profile.aboutHy),
          services: services.some((s) => s.is_active && s.price > 0),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) return null;
  const telegram = account.master.telegramConnected || !account.telegramAvailable;
  if (state.profile && state.services && telegram) return null;

  const steps = [
    { key: 'profile', label: T.stepProfile, done: state.profile, go: () => setTab('profile') },
    { key: 'services', label: T.stepServices, done: state.services, go: () => setTab('categories') },
    { key: 'hours', label: T.stepHours, done: null, go: () => setTab('availability') },
    ...(account.telegramAvailable
      ? [{ key: 'telegram', label: T.stepTelegram, done: account.master.telegramConnected, go: () => setTab('settings') }]
      : []),
    { key: 'share', label: T.stepShare, done: null, href: account.master.siteUrl },
  ];

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
