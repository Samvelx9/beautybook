import { useEffect, useState } from 'react';
import { DEFAULT_LANG, STRINGS, setCurrency, setMasterLanguages } from './i18n.js';
import { setTimeZone } from 'salon-shared/time';
import { api, ApiError, setCalendar } from './api.js';
import { useAdminAuth } from './useAdminAuth.js';
import { goToTab, readRoute } from './route.js';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import SignupScreen from './components/SignupScreen.jsx';
import PrivacyScreen from './components/PrivacyScreen.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import DashboardScreen from './components/DashboardScreen.jsx';
import BookingsScreen from './components/BookingsScreen.jsx';
import ServicesScreen from './components/ServicesScreen.jsx';
import AvailabilityScreen from './components/AvailabilityScreen.jsx';
import ProfileScreen from './components/ProfileScreen.jsx';
import CategoriesScreen from './components/CategoriesScreen.jsx';
import SettingsScreen from './components/SettingsScreen.jsx';
import PlatformScreen from './components/PlatformScreen.jsx';
import OperatorSettingsScreen from './components/OperatorSettingsScreen.jsx';
import MastersScreen from './components/MastersScreen.jsx';
import TaxesScreen from './components/TaxesScreen.jsx';
import MasterPicker from './components/MasterPicker.jsx';

const SCREENS = {
  dashboard: DashboardScreen,
  bookings: BookingsScreen,
  masters: MastersScreen,
  taxes: TaxesScreen,
  categories: CategoriesScreen,
  services: ServicesScreen,
  availability: AvailabilityScreen,
  profile: ProfileScreen,
  settings: SettingsScreen,
  platform: PlatformScreen,
};

const PUBLIC_PAGES = ['welcome', 'login', 'signup'];
const LANG_STORAGE_KEY = 'admin_lang';
const CALENDAR_STORAGE_KEY = 'admin_calendar';
// The screens that show one master's calendar; a salon's owner picks whose.
const CALENDAR_TABS = ['bookings', 'availability', 'profile'];

function storedCalendar() {
  try {
    const value = localStorage.getItem(CALENDAR_STORAGE_KEY);
    return value === 'all' ? 'all' : Number(value) || null;
  } catch {
    return null;
  }
}

function routeTab() {
  return readRoute().tab;
}

function storedLang() {
  try {
    const value = localStorage.getItem(LANG_STORAGE_KEY);
    if (value && STRINGS[value]) return value;
  } catch {
    // Storage unavailable: the default.
  }
  // Armenian unless the visitor has chosen otherwise — not the browser's
  // language, which in Armenia is mostly English or Russian.
  return DEFAULT_LANG;
}

export default function App() {
  const [lang, setLangState] = useState(storedLang);

  // Screen readers pick a voice, and browsers decide whether to offer
  // translation, from <html lang> — so it follows the language on screen
  // rather than staying at index.html's "en".
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const [tab, setTabState] = useState(routeTab);
  const auth = useAdminAuth();
  // The logged-in account (GET /api/admin/account): its organization, its own
  // calendar if it has one, settings and subscription. `platformOnly` for an
  // operator login with no booking page of its own.
  const [account, setAccount] = useState(null);
  // A salon's owner: the salon and its masters (GET /api/salon).
  const [salon, setSalon] = useState(null);
  // Whose calendar the owner is looking at: a master's id, or 'all' (bookings).
  const [calendarChoice, setCalendarChoice] = useState(storedCalendar);

  // Back / Forward between tabs and public pages.
  useEffect(() => {
    const onPopState = () => setTabState(routeTab());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setTab = (next) => {
    if (next === tab) return;
    goToTab(next);
    setTabState(next);
  };

  async function refreshAccount() {
    try {
      const next = await api.getAccount();
      // Formatting follows the organization (its masters share one locale):
      // set before the screens render prices, dates or language fields.
      setCurrency(next.organization.currency);
      setTimeZone(next.organization.timezone);
      setMasterLanguages(next.organization.languages);
      if (next.organization.kind === 'salon' && next.role === 'owner') {
        setSalon(await api.getSalon());
      }
      setAccount(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_master') {
        setAccount({ platformOnly: true });
      } else if (!auth.handleAuthError(err)) {
        setAccount({ loadError: true });
      }
    }
  }

  async function refreshSalon() {
    try {
      setSalon(await api.getSalon());
    } catch (err) {
      auth.handleAuthError(err);
    }
  }

  useEffect(() => {
    setAccount(null);
    setSalon(null);
    if (auth.loggedIn) refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);

  const setLang = (next) => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the language just won't survive a reload.
    }
  };
  const T = STRINGS[lang];

  // The privacy policy is for everyone: visitors, masters, and clients who
  // follow the link in a booking page's footer — logged in or not.
  if (tab === 'privacy') {
    const go = (page) => setTab(auth.loggedIn && page === 'welcome' ? 'dashboard' : page);
    return <PrivacyScreen lang={lang} setLang={setLang} go={go} />;
  }

  if (!auth.loggedIn) {
    const page = PUBLIC_PAGES.includes(tab) ? tab : 'welcome';
    const common = { T, lang, setLang, go: setTab };
    if (page === 'login') {
      return (
        <LoginScreen
          {...common}
          login={auth.login}
          loginError={auth.loginError}
          loggingIn={auth.loggingIn}
        />
      );
    }
    if (page === 'signup') {
      return <SignupScreen {...common} onSignedUp={(token) => { goToTab('dashboard'); setTabState('dashboard'); auth.setSessionToken(token); }} />;
    }
    return <WelcomeScreen {...common} />;
  }

  if (!account) {
    return <p style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{T.loading}</p>;
  }
  if (account.loadError) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--terracotta)' }}>{T.genericError}</p>
        <button className="btn-outline" onClick={() => { setAccount(null); refreshAccount(); }}>↻</button>
      </div>
    );
  }

  const isSalon = account.organization?.kind === 'salon';
  const isSalonOwner = isSalon && account.role === 'owner';
  // A salon's masters, working ones first, for the picker.
  const salonMasters = isSalonOwner ? (salon?.masters ?? []).filter((m) => m.active) : [];
  const hasCalendars = isSalonOwner ? salonMasters.length > 0 : Boolean(account.master);

  let tabs;
  if (account.platformOnly) {
    tabs = ['platform', 'settings'];
  } else if (isSalonOwner) {
    // The landing page tab is there from the start: the salon's own page.
    tabs = ['dashboard', ...(hasCalendars ? ['bookings'] : []), 'masters', 'categories', 'services',
            ...(hasCalendars ? ['availability'] : []), 'profile', 'taxes', 'settings'];
  } else if (isSalon) {
    // A salon's master: their own calendar, and the part of the salon's price
    // list that is theirs alone (the rest is the owner's).
    tabs = ['dashboard', 'bookings', 'categories', 'services', 'availability', 'profile', 'settings'];
  } else {
    tabs = ['dashboard', 'bookings', 'categories', 'services', 'availability', 'profile', 'taxes', 'settings'];
  }
  if (account.isPlatformAdmin && !tabs.includes('platform')) tabs.push('platform');
  const current = tabs.includes(tab) ? tab : tabs[0];
  // Arriving from the login or sign-up page (or an old link), the address bar
  // still names that page; it's replaced with the screen actually showing.
  if (current !== tab) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${current}`);
  }

  // The calendar the screens act on. Others' logins: their own. A salon's
  // owner: the master they picked. 'all' only makes sense for bookings and
  // 'salon' (the salon page) only for the landing page; elsewhere the pick
  // falls back to the owner's own calendar or the first master.
  let calendar = null;
  if (isSalonOwner) {
    const fallback = salonMasters.find((m) => m.isOwner)?.id ?? salonMasters[0]?.id ?? 'salon';
    let picked = ['all', 'salon'].includes(calendarChoice) || salonMasters.some((m) => m.id === calendarChoice)
      ? calendarChoice
      : fallback;
    if (picked === 'all' && current !== 'bookings') picked = current === 'profile' ? 'salon' : fallback;
    if (picked === 'salon' && current !== 'profile') picked = fallback;
    calendar = picked;
  }
  setCalendar(calendar);
  const calendarMaster = typeof calendar === 'number' ? salonMasters.find((m) => m.id === calendar) : null;
  const pickCalendar = (next) => {
    setCalendarChoice(next);
    try {
      localStorage.setItem(CALENDAR_STORAGE_KEY, String(next));
    } catch {
      // The choice just won't survive a reload.
    }
  };

  // An operator with no booking page has their own, much shorter Settings.
  const Screen = current === 'settings' && account.platformOnly ? OperatorSettingsScreen : SCREENS[current];

  return (
    <AdminLayout
      T={T}
      lang={lang}
      setLang={setLang}
      tabs={tabs}
      tab={current}
      setTab={setTab}
      onLogout={auth.logout}
      account={account}
    >
      {isSalonOwner && CALENDAR_TABS.includes(current) && (hasCalendars || current === 'profile') && (
        <MasterPicker
          T={T}
          masters={salonMasters}
          value={calendar}
          allowAll={current === 'bookings'}
          allowSalon={current === 'profile'}
          onChange={pickCalendar}
        />
      )}
      <Screen
        // A different master's calendar is a different screen: it loads afresh.
        // Only the calendar screens, though — the Masters screen mustn't lose
        // a new master's one-time password because adding them changed the pick.
        key={CALENDAR_TABS.includes(current) ? `${current}:${calendar ?? ''}` : current}
        T={T}
        lang={lang}
        onAuthError={auth.handleAuthError}
        account={account}
        refreshAccount={refreshAccount}
        salon={salon}
        refreshSalon={refreshSalon}
        // The master whose calendar is showing, for a salon's owner (null on
        // 'all' and for everyone else, whose calendar is their own).
        calendarMaster={calendarMaster}
        allMasters={calendar === 'all'}
        setTab={setTab}
        setSessionToken={auth.setSessionToken}
        onLogout={auth.logout}
      />
    </AdminLayout>
  );
}
