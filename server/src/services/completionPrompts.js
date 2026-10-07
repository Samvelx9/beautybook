import { pool } from '../db.js';
import { getBookingWithItems } from './bookings.js';
import { getMasterById } from './masters.js';
import { askIfCompleted } from './telegram.js';

const CHECK_EVERY_MS = 60_000;

// Once a confirmed visit's booked time has run out, its master is asked on
// Telegram whether it happened; the answer comes back through
// routes/telegram.js. Only masters who have linked a chat are asked.
//
// The check reads the database rather than keeping a timer per booking, so a
// restart or a deploy only delays a question, never loses one.
//
// `completion_asked_at` records when the master was asked. A booking is due
// when it has ended and they haven't been asked since it ended — so a visit
// moved to a later time after they were asked is asked about again at its new
// end. Only the last day is considered, so a visit written in after the fact as
// `confirmed` gets one question, and a Telegram outage doesn't turn into a
// backlog of old ones.
async function claimDueBookings() {
  const { rows } = await pool.query(
    `UPDATE bookings SET completion_asked_at = now()
      WHERE id IN (
        SELECT b.id FROM bookings b
          JOIN masters m ON m.id = b.master_id
         WHERE b.status = 'confirmed'
           AND m.telegram_chat_id IS NOT NULL
           AND m.suspended_at IS NULL
           AND b.end_time <= now()
           AND b.end_time > now() - interval '1 day'
           AND (b.completion_asked_at IS NULL OR b.completion_asked_at < b.end_time)
         ORDER BY b.end_time
         LIMIT 50
         FOR UPDATE OF b SKIP LOCKED
      )
      RETURNING id, master_id`
  );
  return rows;
}

async function checkOnce() {
  for (const { id, master_id: masterId } of await claimDueBookings()) {
    const master = await getMasterById(masterId);
    const booking = master && (await getBookingWithItems(masterId, id));
    if (!booking) continue;
    if (!(await askIfCompleted(master, booking))) {
      // Not sent, so it's handed back to the next check to try again.
      await pool.query('UPDATE bookings SET completion_asked_at = NULL WHERE id = $1', [id]);
    }
  }
}

export function startCompletionPrompts() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await checkOnce();
    } catch (err) {
      console.error('Completion prompt check failed:', err.message);
    } finally {
      running = false;
    }
  };
  setInterval(tick, CHECK_EVERY_MS);
  tick();
}
