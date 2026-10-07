import { useEffect, useState } from 'react';
import { DEFAULT_LANG, STRINGS, setCurrency, setMasterLanguages } from './i18n.js';
import { setTimeZone } from 'salon-shared/time';
import { api, ApiError } from './api.js';
import { useAdminAuth } from './useAdminAuth.js';
import { goToTab, readRoute } from './route.js';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import SignupScreen from './components/SignupScreen.jsx';
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

const SCREENS = {
  dashboard: DashboardScreen,
  bookings: BookingsScreen,
  categories: CategoriesScreen,
  services: ServicesScreen,
  availability: AvailabilityScreen,
  profile: ProfileScreen,
  settings: SettingsScreen,
  platform: PlatformScreen,
};

const PUBLIC_PAGES = ['welcome', 'login', 'signup'];
const LANG_STORAGE_KEY = 'admin_lang';

function routeTab() {
  return readRoute().tab;
}

function storedLang() {
  try {
    const value = localStorage.getItem(LANG_STORAGE_KEY);
    if (value && STRINGS[value]) return value;
  } catch {
    // fall through to the browser's language
  }
  const browser = (navigator.language || '').slice(0, 2);
  return STRINGS[browser] ? browser : DEFAULT_LANG;
}

export default function App() {
  const [lang, setLangState] = useState(storedLang);
  const [tab, setTabState] = useState(routeTab);
  const auth = useAdminAuth();
  // The logged-in master's account (GET /api/admin/account): their page,
  // settings and subscription. `platformOnly` for an operator login with no
  // booking page of its own.
  const [account, setAccount] = useState(null);

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
      // Formatting follows the master: set before the screens render prices,
      // dates or language fields.
      setCurrency(next.master.currency);
      setTimeZone(next.master.timezone);
      setMasterLanguages(next.master.languages);
      setAccount(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_master') {
        setAccount({ platformOnly: true });
      } else if (!auth.handleAuthError(err)) {
        setAccount({ loadError: true });
      }
    }
  }

  useEffect(() => {
    setAccount(null);
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

  const tabs = account.platformOnly
    ? ['platform', 'settings']
    : ['dashboard', 'bookings', 'categories', 'services', 'availability', 'profile', 'settings',
       ...(account.isPlatformAdmin ? ['platform'] : [])];
  const current = tabs.includes(tab) ? tab : tabs[0];
  // Arriving from the login or sign-up page (or an old link), the address bar
  // still names that page; it's replaced with the screen actually showing.
  if (current !== tab) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${current}`);
  }
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
      <Screen
        key={current}
        T={T}
        lang={lang}
        onAuthError={auth.handleAuthError}
        account={account}
        refreshAccount={refreshAccount}
        setTab={setTab}
        setSessionToken={auth.setSessionToken}
        onLogout={auth.logout}
      />
    </AdminLayout>
  );
}
