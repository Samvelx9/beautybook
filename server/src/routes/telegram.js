import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import {
  callTelegram,
  masterText,
  telegramToken,
  webhookSecret,
  COMPLETION_ANSWERS,
} from '../services/telegram.js';
import { handleGuestCallback, handleGuestMessage } from '../services/guestNotifications.js';
import { MASTER_COLUMNS, masterSiteUrl } from '../services/masters.js';

export const telegramRouter = Router();

function hasValidSecret(req, token) {
  const expected = Buffer.from(webhookSecret(token));
  const given = Buffer.from(String(req.get('X-Telegram-Bot-Api-Secret-Token') ?? ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function masterByChat(chatId) {
  const { rows } = await pool.query(
    `SELECT ${MASTER_COLUMNS} FROM masters m WHERE m.telegram_chat_id = $1`,
    [chatId]
  );
  return rows[0] ?? null;
}

// "/start m_<token>" from a master's "Connect Telegram" link: this chat becomes
// where that master's notifications go. The token is single-use.
async function connectMaster(message, token) {
  const chatId = message.chat.id;
  const { rows } = await pool.query(
    `UPDATE masters m SET telegram_chat_id = $2, telegram_connect_token = NULL
      WHERE telegram_connect_token = $1
      RETURNING ${MASTER_COLUMNS}`,
    [token, chatId]
  );
  const master = rows[0];
  const T = masterText(master ?? { notify_lang: 'ru' });
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: master ? T.connected(masterSiteUrl(master)) : T.connectExpired,
    disable_web_page_preview: true,
  });
}

// Everything Telegram sends the platform bot arrives here:
//
// - "/start m_<token>": a master connecting their chat (above);
// - "/start <guest token>" or anything else a guest types — see
//   services/guestNotifications.js;
// - a button on a guest's reminder (callback data "g:…") — same file;
// - a master's answer to "did this visit happen?" (callback data
//   "done:<id>" / "noshow:<id>"), below. It only counts from the chat of the
//   master the booking belongs to, and only moves a booking still
//   `confirmed`: if the master already set it in the admin panel, or it was
//   cancelled, a late tap doesn't overwrite that.
telegramRouter.post('/webhook', asyncHandler(async (req, res) => {
  const token = telegramToken();
  if (!token || !hasValidSecret(req, token)) {
    return res.sendStatus(401);
  }

  const incoming = req.body?.message;
  if (incoming) {
    if (!incoming.chat?.id || incoming.chat.type !== 'private') return res.sendStatus(200);
    const text = String(incoming.text ?? '').trim();
    const [command, param] = text.split(/\s+/);

    if (command === '/start' && param?.startsWith('m_')) {
      await connectMaster(incoming, param);
      return res.sendStatus(200);
    }

    // A master's own chat: only a guest-style "/start <token>" means anything
    // (they may well try a guest link themselves); anything else gets a note
    // about what this chat is for.
    const master = await masterByChat(incoming.chat.id);
    if (master && !(command === '/start' && param)) {
      await callTelegram('sendMessage', {
        chat_id: incoming.chat.id,
        text: masterText(master).masterHelp(masterSiteUrl(master)),
        disable_web_page_preview: true,
      });
      return res.sendStatus(200);
    }

    await handleGuestMessage(incoming);
    return res.sendStatus(200);
  }

  const query = req.body?.callback_query;
  const message = query?.message;
  if (!query || !message) return res.sendStatus(200);

  if (String(query.data ?? '').startsWith('g:')) {
    await handleGuestCallback(query);
    return res.sendStatus(200);
  }

  const [answer, rawId] = String(query.data ?? '').split(':');
  const status = COMPLETION_ANSWERS[answer];
  const id = Number(rawId);
  const master = await masterByChat(message.chat?.id);
  if (!status || !Number.isInteger(id) || !master) {
    await callTelegram('answerCallbackQuery', { callback_query_id: query.id });
    return res.sendStatus(200);
  }

  const T = masterText(master);
  const { rows: updated } = await pool.query(
    `UPDATE bookings SET status = $3
      WHERE id = $1 AND master_id = $2 AND status = 'confirmed' RETURNING status`,
    [id, master.id, status]
  );
  let outcome;
  if (updated[0]) {
    outcome = status === 'completed' ? T.markedDone : T.markedNoShow;
  } else {
    const { rows } = await pool.query('SELECT status FROM bookings WHERE id = $1 AND master_id = $2', [
      id,
      master.id,
    ]);
    outcome = rows[0] ? T.unchanged(T.statuses[rows[0].status] ?? rows[0].status) : T.deleted;
  }

  await callTelegram('answerCallbackQuery', { callback_query_id: query.id, text: outcome });
  // Editing the text without a reply_markup is also what removes the buttons.
  await callTelegram('editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: `${message.text ?? ''}\n\n${outcome}`,
  });

  res.sendStatus(200);
}));
