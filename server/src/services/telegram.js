import { createHash } from 'node:crypto';
import { formatDuration } from '../lib/booking.js';
import { formatLocalDateTime } from '../lib/time.js';
import { localName } from './bookings.js';

// One Telegram bot serves the whole platform. Each master links their own
// chat to it from the admin panel (masters.telegram_chat_id) and gets their
// bookings there; guests link a chat to one booking for reminders (see
// guestNotifications.js). The bot token is the platform's, set once in the
// environment — masters never deal with BotFather.

const MASTER_TEXT = {
  ru: {
    created: '🆕 Новая запись',
    rescheduled: '🔄 Перенос записи',
    ended: '⏰ Процедура завершилась?',
    guestConfirmed: '👍 Клиент подтвердил визит',
    cancelled: '❌ Отмена записи',
    cancelledViaTelegram: ' (клиент отменил в Telegram)',
    service: 'Услуга',
    date: 'Дата',
    was: 'Было',
    now: 'Стало',
    duration: 'Длительность',
    client: 'Клиент',
    phone: 'Телефон',
    h: 'ч',
    min: 'мин',
    doneBtn: '✅ Завершено',
    noShowBtn: '🚫 Неявка',
    markedDone: '✅ Отмечено: завершено',
    markedNoShow: '🚫 Отмечено: неявка',
    unchanged: (status) => `ℹ️ Не изменено — запись уже ${status}`,
    deleted: 'ℹ️ Запись удалена',
    statuses: { confirmed: 'подтверждена', completed: 'завершена', cancelled: 'отменена', no_show: 'неявка' },
    connected: (site) => `✅ Готово! Сюда будут приходить уведомления о записях на ${site}.`,
    connectExpired: 'Эта ссылка устарела. Откройте настройки в панели и нажмите «Подключить Telegram» ещё раз.',
    masterHelp: (site) => `Этот чат получает уведомления о записях на ${site}.`,
  },
  en: {
    created: '🆕 New booking',
    rescheduled: '🔄 Booking moved',
    ended: '⏰ Did this visit happen?',
    guestConfirmed: '👍 Client confirmed the visit',
    cancelled: '❌ Booking cancelled',
    cancelledViaTelegram: ' (client cancelled in Telegram)',
    service: 'Service',
    date: 'Date',
    was: 'Was',
    now: 'Now',
    duration: 'Duration',
    client: 'Client',
    phone: 'Phone',
    h: 'h',
    min: 'min',
    doneBtn: '✅ Completed',
    noShowBtn: '🚫 No-show',
    markedDone: '✅ Marked completed',
    markedNoShow: '🚫 Marked no-show',
    unchanged: (status) => `ℹ️ Not changed — the booking is already ${status}`,
    deleted: 'ℹ️ Booking deleted',
    statuses: { confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled', no_show: 'a no-show' },
    connected: (site) => `✅ Done! Booking notifications for ${site} will arrive here.`,
    connectExpired: 'This link has expired. Open Settings in your admin panel and press “Connect Telegram” again.',
    masterHelp: (site) => `This chat receives booking notifications for ${site}.`,
  },
  hy: {
    created: '🆕 Նոր գրանցում',
    rescheduled: '🔄 Գրանցումը տեղափոխվել է',
    ended: '⏰ Այցը կայացա՞վ',
    guestConfirmed: '👍 Հաճախորդը հաստատեց այցը',
    cancelled: '❌ Գրանցումը չեղարկվել է',
    cancelledViaTelegram: ' (հաճախորդը չեղարկեց Telegram-ում)',
    service: 'Ծառայություն',
    date: 'Ամսաթիվ',
    was: 'Նախկինում',
    now: 'Այժմ',
    duration: 'Տևողություն',
    client: 'Հաճախորդ',
    phone: 'Հեռախոս',
    h: 'ժ',
    min: 'ր',
    doneBtn: '✅ Կայացավ',
    noShowBtn: '🚫 Չեկավ',
    markedDone: '✅ Նշված է՝ կայացավ',
    markedNoShow: '🚫 Նշված է՝ չեկավ',
    unchanged: (status) => `ℹ️ Չի փոխվել — գրանցումն արդեն ${status} է`,
    deleted: 'ℹ️ Գրանցումը ջնջված է',
    statuses: { confirmed: 'հաստատված', completed: 'կայացած', cancelled: 'չեղարկված', no_show: 'բաց թողնված' },
    connected: (site) => `✅ Պատրաստ է։ ${site} կայքի գրանցումների ծանուցումներն այստեղ կգան։`,
    connectExpired: 'Այս հղումն այլևս վավեր չէ։ Բացեք կարգավորումները և կրկին սեղմեք «Միացնել Telegram»։',
    masterHelp: (site) => `Այս զրույցը ստանում է ${site} կայքի գրանցումների ծանուցումները։`,
  },
};

export function masterText(master) {
  return MASTER_TEXT[master?.notify_lang] ?? MASTER_TEXT.ru;
}

function formatMessage(master, event) {
  const T = masterText(master);
  const lang = master.notify_lang;
  const tz = master.timezone;
  const { booking } = event;
  const items = booking.items ?? [];
  // A visit can cover several zones, so they're listed one per line.
  const serviceName =
    items.length > 1
      ? '\n  · ' + items.map((i) => localName(i, lang)).join('\n  · ')
      : localName(items[0], lang);
  const when = formatLocalDateTime(booking.start_time, tz);
  const minutes =
    event.durationMinutes ??
    Math.round((new Date(booking.end_time) - new Date(booking.start_time)) / 60000);
  const duration = minutes ? `${T.duration}: ${formatDuration(minutes, T.h, T.min)}\n` : '';
  const client = `${T.client}: ${booking.customer_name}\n${T.phone}: ${booking.customer_phone}`;

  switch (event.type) {
    case 'booking_created':
      return `${T.created}\n${T.service}: ${serviceName}\n${T.date}: ${when}\n${duration}${client}`;
    // A guest moving their own visit is the one change the master doesn't
    // make themselves, so both times matter — they may have written down the
    // first one.
    case 'booking_rescheduled': {
      const before = formatLocalDateTime(event.previousStartTime, tz);
      return `${T.rescheduled}\n${T.service}: ${serviceName}\n${T.was}: ${before}\n${T.now}: ${when}\n${duration}${client}`;
    }
    case 'booking_ended':
      return `${T.ended}\n${T.service}: ${serviceName}\n${T.date}: ${when}\n${duration}${client}`;
    case 'guest_confirmed':
      return `${T.guestConfirmed}\n${T.service}: ${serviceName}\n${T.date}: ${when}\n${client}`;
    case 'booking_cancelled':
      return `${T.cancelled}${event.viaTelegram ? T.cancelledViaTelegram : ''}\n${T.service}: ${serviceName}\n${T.date}: ${when}\n${duration}${client}`;
    default:
      return null;
  }
}

export function telegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

// Telegram sends this back in a header on every webhook call, which is how the
// webhook tells a real update from anyone else posting to the URL. Derived from
// the bot token so there is no second secret to keep.
export function webhookSecret(token) {
  return createHash('sha256').update(`webhook:${token}`).digest('hex');
}

const TELEGRAM_TIMEOUT_MS = 10_000;

// One Bot API call. Never throws — Telegram being down must never break
// whatever called it. `ok` is false on any failure, and `status` is Telegram's
// HTTP status when it answered at all: a 403 is a user who has blocked the bot,
// which is worth telling apart from an outage.
export async function callTelegramDetailed(method, body) {
  const token = telegramToken();
  if (!token) return { ok: false, status: null, result: null };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`Telegram ${method} failed:`, res.status, await res.text());
      return { ok: false, status: res.status, result: null };
    }
    return { ok: true, status: res.status, result: (await res.json()).result ?? true };
  } catch (err) {
    console.error(`Telegram ${method} failed:`, err.message);
    return { ok: false, status: null, result: null };
  }
}

export async function callTelegram(method, body) {
  const { ok, result } = await callTelegramDetailed(method, body);
  return ok ? result : null;
}

// The bot's @username, for t.me links. Asked of Telegram once and kept; a
// failed lookup is retried next time.
let botUsername = null;
export async function getBotUsername() {
  if (botUsername) return botUsername;
  const me = await callTelegram('getMe', {});
  botUsername = me?.username ?? null;
  return botUsername;
}

// Best-effort: a Telegram outage or a master without a linked chat must never
// break the booking flow, so failures are logged, never thrown — which is also
// what lets the routes call this after answering, without awaiting it.
export async function notifyMaster(master, event) {
  try {
    if (!master?.telegram_chat_id) return;
    const text = formatMessage(master, event);
    if (!text) return;
    await callTelegram('sendMessage', { chat_id: master.telegram_chat_id, text });
  } catch (err) {
    console.error('Telegram notification failed:', err.message);
  }
}

// The buttons' callback data is "<answer>:<booking id>"; routes/telegram.js
// reads it back.
export const COMPLETION_ANSWERS = { done: 'completed', noshow: 'no_show' };

// Returns whether the question actually went out, so the caller can try again
// later if it didn't.
export async function askIfCompleted(master, booking) {
  if (!master?.telegram_chat_id) return false;
  const T = masterText(master);
  const result = await callTelegram('sendMessage', {
    chat_id: master.telegram_chat_id,
    text: formatMessage(master, { type: 'booking_ended', booking }),
    reply_markup: {
      inline_keyboard: [[
        { text: T.doneBtn, callback_data: `done:${booking.id}` },
        { text: T.noShowBtn, callback_data: `noshow:${booking.id}` },
      ]],
    },
  });
  return Boolean(result);
}

// Points Telegram at this server's webhook: button presses, and messages — a
// "/start <token>" from a master connecting or a guest opting in.
export async function registerWebhook(publicApiUrl) {
  const token = telegramToken();
  if (!token) return;

  const url = `${publicApiUrl.replace(/\/$/, '')}/api/telegram/webhook`;
  const ok = await callTelegram('setWebhook', {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ['callback_query', 'message'],
  });
  if (ok) console.log(`Telegram webhook set to ${url}`);
}
