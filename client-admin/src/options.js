// Choices offered at sign-up and in Settings.

export const CURRENCIES = ['AMD', 'RUB', 'EUR', 'USD', 'GEL', 'KZT', 'UAH', 'BYN', 'AZN', 'GBP', 'TRY', 'AED'];

// Every IANA zone the browser knows, or a short list where it can't say.
const COMMON_ZONES = [
  'Asia/Yerevan', 'Europe/Moscow', 'Asia/Tbilisi', 'Asia/Baku', 'Europe/Kyiv', 'Europe/Minsk',
  'Asia/Almaty', 'Europe/Istanbul', 'Asia/Dubai', 'Europe/Berlin', 'Europe/Paris', 'Europe/London',
  'America/New_York', 'America/Los_Angeles',
];

export function timeZones() {
  try {
    const all = Intl.supportedValuesOf('timeZone');
    if (all.length) return all;
  } catch {
    // older browser
  }
  return COMMON_ZONES;
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Yerevan';
  } catch {
    return 'Asia/Yerevan';
  }
}

// A starting currency guessed from the timezone; the master can change it.
const CURRENCY_BY_ZONE = {
  'Asia/Yerevan': 'AMD', 'Europe/Moscow': 'RUB', 'Asia/Tbilisi': 'GEL', 'Asia/Baku': 'AZN',
  'Europe/Kyiv': 'UAH', 'Europe/Kiev': 'UAH', 'Europe/Minsk': 'BYN', 'Asia/Almaty': 'KZT',
  'Europe/Istanbul': 'TRY', 'Asia/Dubai': 'AED', 'Europe/London': 'GBP',
};
export function guessCurrency(zone) {
  if (CURRENCY_BY_ZONE[zone]) return CURRENCY_BY_ZONE[zone];
  if (zone.startsWith('Europe/')) return 'EUR';
  if (zone.startsWith('America/')) return 'USD';
  return 'AMD';
}
