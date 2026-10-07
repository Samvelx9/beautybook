// Primitives shared between client-guest and client-admin: language
// metadata, locale tags, and the date/price formatting helpers that don't
// belong to either app's own UI copy. Each app keeps its own STRINGS dict
// for screen-specific text.

export const LANG_ORDER = ['hy', 'ru', 'en'];
// `code` is what the switcher shows. The flag emoji it used to show falls back
// to the country's letter pair on systems without an emoji flag font — so
// English read as "GB" — and a language is better labelled by its own code
// anyway: English is EN wherever it's spoken.
export const LANG_META = {
  hy: { code: 'HY', flag: '🇦🇲', name: 'Հայերեն' },
  ru: { code: 'RU', flag: '🇷🇺', name: 'Русский' },
  en: { code: 'EN', flag: '🇬🇧', name: 'English' },
};
export const LOCALE_TAG = { hy: 'hy-AM', ru: 'ru-RU', en: 'en-US' };
export const DEFAULT_LANG = 'ru';

export const WEEKDAY_SHORT = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  hy: ['Կիր', 'Երկ', 'Երք', 'Չրք', 'Հնգ', 'Ուրբ', 'Շաբ'],
};
export const WEEKDAY_FULL = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ru: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  hy: ['Կիրակի', 'Երկուշաբթի', 'Երեքշաբթի', 'Չորեքշաբթի', 'Հինգշաբթի', 'Ուրբաթ', 'Շաբաթ'],
};
export const TODAY_TMRW = {
  en: { today: 'Today', tomorrow: 'Tmrw' },
  ru: { today: 'Сегодня', tomorrow: 'Завтра' },
  hy: { today: 'Այսօր', tomorrow: 'Վաղը' },
};
export const MONTH_SHORT = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  hy: ['հունվ.', 'փետր.', 'մարտ', 'ապր.', 'մայիս', 'հունիս', 'հուլիս', 'օգս.', 'սեպտ.', 'հոկտ.', 'նոյ.', 'դեկ.'],
};

// Full month names, for calendar headings. Same reasoning as the short forms:
// built here rather than pulled from ICU, which has no Armenian data in some
// browser builds.
export const MONTH_FULL = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  hy: ['Հունվար', 'Փետրվար', 'Մարտ', 'Ապրիլ', 'Մայիս', 'Հունիս', 'Հուլիս', 'Օգոստոս', 'Սեպտեմբեր', 'Հոկտեմբեր', 'Նոյեմբեր', 'Դեկտեմբեր'],
};

// Counted nouns: Russian picks between three forms by the last digits, Armenian
// keeps the singular after a numeral, English just adds an -s. Without this a
// count reads as "12 зон(ы)" or "1 записей", which is the kind of thing that
// makes a dashboard feel machine-translated.
const PLURAL_FORMS = {
  bookings: {
    en: ['booking', 'bookings'],
    ru: ['запись', 'записи', 'записей'],
    hy: ['գրանցում'],
  },
  zones: {
    en: ['zone', 'zones'],
    ru: ['зона', 'зоны', 'зон'],
    hy: ['գոտի'],
  },
};

export function pluralize(count, lang, noun) {
  const forms = PLURAL_FORMS[noun][lang];
  if (forms.length === 1) return forms[0];
  if (lang === 'ru') {
    const tens = count % 100;
    if (tens >= 11 && tens <= 14) return forms[2];
    const ones = count % 10;
    if (ones === 1) return forms[0];
    if (ones >= 2 && ones <= 4) return forms[1];
    return forms[2];
  }
  return count === 1 ? forms[0] : forms[1];
}

// Every master prices in their own currency (masters.currency, an ISO code).
// Each app calls setCurrency() once it knows whose page or panel it is.
const CURRENCY_SYMBOL = {
  AMD: '֏', RUB: '₽', EUR: '€', USD: '$', GBP: '£', GEL: '₾', KZT: '₸', UAH: '₴',
  BYN: 'Br', AZN: '₼', TRY: '₺', AED: 'AED', ILS: '₪', PLN: 'zł', CZK: 'Kč',
};
let currency = 'AMD';
export function setCurrency(code) {
  if (typeof code === 'string' && /^[A-Z]{3}$/.test(code)) currency = code;
}
export function currencySymbol() {
  return CURRENCY_SYMBOL[currency] ?? currency;
}

// An amount in a given currency — for screens that show several masters'
// money side by side (the operator's), where the one set currency won't do.
export function formatAmount(amount, lang, code) {
  const symbol = CURRENCY_SYMBOL[code] ?? code;
  const number = Number(amount).toLocaleString(LOCALE_TAG[lang]);
  return ['$', '£'].includes(symbol) ? `${symbol}${number}` : `${number} ${symbol}`;
}

export function formatPrice(amount, lang) {
  return formatAmount(amount, lang, currency);
}

// A name in the language asked for, or in whichever language the master did
// fill in — a master working only in Russian leaves the other two blank.
// `field` is the column prefix: 'name', 'description', 'owner_name', or a
// camelCase one such as 'ownerName' for profile objects.
export function localName(row, lang, field = 'name') {
  if (!row) return '';
  const key = (l) => (field.includes('_') || field === 'name' || field === 'description'
    ? `${field}_${l}`
    : `${field}${l[0].toUpperCase()}${l.slice(1)}`);
  return row[key(lang)] || row[key('ru')] || row[key('en')] || row[key('hy')] || '';
}

// dateStr: 'YYYY-MM-DD'. Constructed from explicit parts (not `new Date(dateStr)`)
// so the viewer's browser timezone can't shift which calendar day this represents —
// the date is already a calendar day in the master's own timezone.
export function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Built from our own WEEKDAY_SHORT/MONTH_SHORT tables rather than
// `toLocaleDateString(LOCALE_TAG[lang], ...)` — some browser/runtime ICU
// builds (confirmed on at least one headless Chromium build used in testing)
// have no Armenian locale data at all and silently fall back to English
// weekday/month names for 'hy-AM', which would be a real, hard-to-notice
// correctness bug for Armenian-speaking users. Building the string ourselves
// removes that dependency entirely.
function formatDatePart(dateObj, lang) {
  const weekday = WEEKDAY_SHORT[lang][dateObj.getDay()];
  const month = MONTH_SHORT[lang][dateObj.getMonth()];
  const day = dateObj.getDate();
  if (lang === 'en') return `${weekday}, ${month} ${day}`;
  return `${weekday}, ${day} ${month}`; // ru/hy: day-before-month
}

export function formatDateAt(dateObj, time, lang) {
  const dateStr = formatDatePart(dateObj, lang);
  if (lang === 'ru') return dateStr + ', в ' + time;
  if (lang === 'hy') return dateStr + ', ժամը ' + time;
  return dateStr + ' at ' + time;
}

export function formatDate(dateObj, lang) {
  return formatDatePart(dateObj, lang);
}

export function dayLabel(dateObj, index, lang) {
  if (index === 0) return TODAY_TMRW[lang].today;
  if (index === 1) return TODAY_TMRW[lang].tomorrow;
  return WEEKDAY_SHORT[lang][dateObj.getDay()];
}
