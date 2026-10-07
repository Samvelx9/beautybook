// End-to-end checks of the API against a real Postgres: the schema is rebuilt
// from the migrations, a server is started on a spare port, and every test
// talks to it over HTTP the way the two frontends do.
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/beautybook_test npm test
//
// The database named there is wiped. The point above all is tenant isolation:
// one master must never see or touch another's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) {
  console.error('Set TEST_DATABASE_URL to a database this test may wipe.');
  process.exit(1);
}

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/api`;
const DOMAIN = 'bb.test';
const WEBHOOK_SECRET = 'test-webhook-secret';
let server;
let db;

before(async () => {
  db = new pg.Client({ connectionString: DB });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  execFileSync('npx', ['node-pg-migrate', 'up'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: DB },
    stdio: 'ignore',
  });

  server = spawn('node', ['src/index.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      PORT: String(PORT),
      DATABASE_URL: DB,
      JWT_SECRET: 'test-jwt-secret',
      PLATFORM_DOMAIN: DOMAIN,
      LEMONSQUEEZY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) resolve();
    });
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(async () => {
  server?.kill();
  await db?.end();
});

// A request as a master's admin (token) or as a guest on a master's page (slug).
async function call(method, url, { token, slug, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  if (slug) h['X-Forwarded-Host'] = `${slug}.${DOMAIN}`;
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function signup(slug, extra = {}) {
  const res = await call('POST', '/auth/signup', {
    body: {
      email: `${slug}@example.com`,
      password: 'correct horse battery',
      slug,
      displayName: `Master ${slug}`,
      languages: ['ru', 'en'],
      defaultLang: 'ru',
      ...extra,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.token;
}

// The next date (in the master's zone, from tomorrow on) that falls on a given
// weekday — far enough ahead to clear the booking cutoff.
function nextWeekday(dow) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function makeZone(token, { price = 5000, minutes = 30 } = {}) {
  const cat = await call('POST', '/admin/categories', { token, body: { nameRu: 'Ногти' } });
  assert.equal(cat.status, 201, JSON.stringify(cat.body));
  const svc = await call('POST', '/admin/services', {
    token,
    body: { nameRu: 'Маникюр', categoryId: cat.body.id, durationMinutes: minutes, price },
  });
  assert.equal(svc.status, 201, JSON.stringify(svc.body));
  return { categoryId: cat.body.id, serviceId: svc.body.id };
}

let tokenA;
let tokenB;
let zoneA;
let zoneB;

test('sign-up validates and refuses taken or reserved addresses', async () => {
  tokenA = await signup('anna', { templates: ['nails'] });
  tokenB = await signup('bella', { timezone: 'Europe/Berlin', currency: 'EUR' });

  const dupSlug = await call('POST', '/auth/signup', {
    body: { email: 'x@example.com', password: 'long enough pw', slug: 'anna', displayName: 'X' },
  });
  assert.equal(dupSlug.status, 409);
  assert.equal(dupSlug.body.error, 'slug_taken');

  const dupEmail = await call('POST', '/auth/signup', {
    body: { email: 'ANNA@example.com', password: 'long enough pw', slug: 'anna2', displayName: 'X' },
  });
  assert.equal(dupEmail.status, 409);
  assert.equal(dupEmail.body.error, 'email_taken');

  const reserved = await call('POST', '/auth/signup', {
    body: { email: 'y@example.com', password: 'long enough pw', slug: 'admin', displayName: 'Y' },
  });
  assert.equal(reserved.body.error, 'slug_reserved');

  const badTz = await call('POST', '/auth/signup', {
    body: { email: 'z@example.com', password: 'long enough pw', slug: 'zed', displayName: 'Z', timezone: 'Mars/Base' },
  });
  assert.equal(badTz.body.error, 'invalid_timezone');

  const slugCheck = await call('GET', '/auth/slug?slug=anna');
  assert.deepEqual(slugCheck.body, { available: false, reason: 'slug_taken' });
  assert.equal((await call('GET', '/auth/slug?slug=free-name')).body.available, true);
});

test('login works and a wrong password does not', async () => {
  const ok = await call('POST', '/auth/login', {
    body: { email: 'Anna@Example.com', password: 'correct horse battery' },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const bad = await call('POST', '/auth/login', { body: { email: 'anna@example.com', password: 'nope nope' } });
  assert.equal(bad.status, 401);
  const nobody = await call('POST', '/auth/login', { body: { email: 'ghost@example.com', password: 'nope nope' } });
  assert.equal(nobody.status, 401);
});

test('account reports the trial and settings', async () => {
  const { body } = await call('GET', '/admin/account', { token: tokenB });
  assert.equal(body.master.slug, 'bella');
  assert.equal(body.master.timezone, 'Europe/Berlin');
  assert.equal(body.master.currency, 'EUR');
  assert.equal(body.access.state, 'trial');
  assert.equal(body.access.hasAccess, true);
  assert.equal(body.isPlatformAdmin, false);
});

test('a template adds hidden, unpriced zones the guest page does not show', async () => {
  const services = await call('GET', '/admin/services', { token: tokenA });
  assert.ok(services.body.length > 0);
  assert.ok(services.body.every((s) => s.price === 0 && s.is_active === false));
  // Only the languages the master offers are filled in.
  assert.ok(services.body.every((s) => s.name_hy === '' && s.name_ru && s.name_en));

  const guest = await call('GET', '/categories', { slug: 'anna' });
  assert.equal(guest.status, 200);
  assert.ok(guest.body.every((c) => c.services.length === 0));

  // Applying it again adds nothing.
  const again = await call('POST', '/admin/templates/nails', { token: tokenA });
  assert.equal(again.body.added, 0);
});

test("one master's admin cannot see or change another's price list", async () => {
  zoneA = await makeZone(tokenA);
  zoneB = await makeZone(tokenB);

  const listB = await call('GET', '/admin/services', { token: tokenB });
  assert.ok(!listB.body.some((s) => s.id === zoneA.serviceId));

  assert.equal((await call('PATCH', `/admin/services/${zoneA.serviceId}`, { token: tokenB, body: { price: 1 } })).status, 404);
  assert.equal((await call('DELETE', `/admin/services/${zoneA.serviceId}`, { token: tokenB })).status, 404);
  assert.equal((await call('PATCH', `/admin/categories/${zoneA.categoryId}`, { token: tokenB, body: { isActive: false } })).status, 404);

  // A zone filed under someone else's treatment is refused by the database.
  const sneaky = await call('POST', '/admin/services', {
    token: tokenB,
    body: { nameEn: 'Sneaky', categoryId: zoneA.categoryId, durationMinutes: 30, price: 1 },
  });
  assert.equal(sneaky.status, 400);
  assert.equal(sneaky.body.error, 'invalid_category');

  const moved = await call('PATCH', `/admin/services/${zoneB.serviceId}`, {
    token: tokenB,
    body: { categoryId: zoneA.categoryId },
  });
  assert.equal(moved.status, 400);
});

test('guest pages are resolved by host and show only their own master', async () => {
  const a = await call('GET', '/categories', { slug: 'anna' });
  const b = await call('GET', '/categories', { slug: 'bella' });
  const idsA = a.body.flatMap((c) => c.services.map((s) => s.id));
  const idsB = b.body.flatMap((c) => c.services.map((s) => s.id));
  assert.ok(idsA.includes(zoneA.serviceId) && !idsA.includes(zoneB.serviceId));
  assert.ok(idsB.includes(zoneB.serviceId) && !idsB.includes(zoneA.serviceId));

  const site = await call('GET', '/site', { slug: 'bella' });
  assert.deepEqual(
    { currency: site.body.currency, timezone: site.body.timezone, open: site.body.open, languages: site.body.languages },
    { currency: 'EUR', timezone: 'Europe/Berlin', open: true, languages: ['ru', 'en'] }
  );

  assert.equal((await call('GET', '/categories', { slug: 'nobody' })).status, 404);
  assert.equal((await call('GET', '/categories')).status, 404);
});

let bookingA;
const date = nextWeekday(2); // a Tuesday: open 10:00–19:00 by default

test('a guest books, and both masters can be booked at the same hour', async () => {
  const a = await call('POST', '/bookings', {
    slug: 'anna',
    body: { date, time: '11:00', customerName: 'Guest', customerPhone: '+37400000001', items: [{ serviceId: zoneA.serviceId }], lang: 'ru' },
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.priceAtBooking, 5000);
  assert.match(a.body.guestToken, /^[A-Za-z0-9_-]{32}$/);
  bookingA = a.body;

  const b = await call('POST', '/bookings', {
    slug: 'bella',
    body: { date, time: '11:00', customerName: 'Gast', customerPhone: '+4900000001', items: [{ serviceId: zoneB.serviceId }] },
  });
  assert.equal(b.status, 201, JSON.stringify(b.body));

  // But one master can't be double-booked.
  const clash = await call('POST', '/bookings', {
    slug: 'anna',
    body: { date, time: '11:00', customerName: 'Other', customerPhone: '+37400000002', items: [{ serviceId: zoneA.serviceId }] },
  });
  assert.equal(clash.status, 409);

  // Nor booked with another master's zone.
  const foreign = await call('POST', '/bookings', {
    slug: 'anna',
    body: { date, time: '15:00', customerName: 'X', customerPhone: '1', items: [{ serviceId: zoneB.serviceId }] },
  });
  assert.equal(foreign.status, 404);

  // Outside opening hours.
  const late = await call('POST', '/bookings', {
    slug: 'anna',
    body: { date, time: '21:00', customerName: 'X', customerPhone: '1', items: [{ serviceId: zoneA.serviceId }] },
  });
  assert.equal(late.status, 409);
});

test('slots follow the master’s own timezone', async () => {
  const { body } = await call('GET', '/slots?durationMinutes=30', { slug: 'bella' });
  const day = body.days.find((d) => d.date === date);
  assert.ok(day, 'the booked day is within the next week');
  const all = [...day.slots, ...day.unavailable.map((u) => u.time)].sort();
  assert.equal(all[0], '10:00');
  assert.equal(all.at(-1), '18:30');
  assert.ok(day.unavailable.some((u) => u.time === '11:00' && u.reason === 'booked'));

  // The stored instant is 11:00 Berlin time.
  const { rows } = await db.query(
    `SELECT to_char(start_time AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS t FROM bookings b
     JOIN masters m ON m.id = b.master_id WHERE m.slug = 'bella'`
  );
  assert.equal(rows[0].t, '11:00');
});

test("one master's admin cannot see or change another's bookings", async () => {
  const listB = await call('GET', '/admin/bookings', { token: tokenB });
  assert.ok(!listB.body.some((b) => b.id === bookingA.id));
  assert.equal(
    (await call('PATCH', `/admin/bookings/${bookingA.id}`, { token: tokenB, body: { customerName: 'Hacked' } })).status,
    404
  );
  assert.equal(
    (await call('PATCH', `/admin/bookings/${bookingA.id}/status`, { token: tokenB, body: { status: 'cancelled' } })).status,
    404
  );
  const del = await call('DELETE', '/admin/bookings', { token: tokenB, body: { ids: [bookingA.id] } });
  assert.equal(del.body.deleted, 0);

  const listA = await call('GET', '/admin/bookings', { token: tokenA });
  assert.ok(listA.body.some((b) => b.id === bookingA.id && b.customer_name === 'Guest'));
});

test('guests must prove a booking is theirs to change it', async () => {
  const bare = await call('POST', `/bookings/${bookingA.id}/cancel`, { slug: 'anna', body: {} });
  assert.equal(bare.status, 404);
  const wrongPhone = await call('POST', `/bookings/${bookingA.id}/cancel`, { slug: 'anna', body: { phone: '+999' } });
  assert.equal(wrongPhone.status, 404);
  // The right phone, but on another master's page.
  const otherPage = await call('POST', `/bookings/${bookingA.id}/cancel`, { slug: 'bella', body: { phone: '+37400000001' } });
  assert.equal(otherPage.status, 404);

  const moved = await call('POST', `/bookings/${bookingA.id}/reschedule`, {
    slug: 'anna',
    body: { date, time: '12:00', token: bookingA.guestToken },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));

  const lookup = await call('POST', '/bookings/lookup', { slug: 'anna', body: { phone: '+37400000001' } });
  assert.equal(lookup.body.length, 1);
  assert.equal((await call('POST', '/bookings/lookup', { slug: 'bella', body: { phone: '+37400000001' } })).body.length, 0);

  const manage = await call('POST', '/bookings/manage', { slug: 'bella', body: { token: bookingA.guestToken } });
  assert.equal(manage.status, 404);
  const ics = await call('GET', `/calendar/${bookingA.guestToken}.ics`, { slug: 'bella' });
  assert.equal(ics.status, 404);
  const icsOwn = await call('GET', `/calendar/${bookingA.guestToken}.ics`, { slug: 'anna' });
  assert.equal(icsOwn.status, 200);
  assert.match(icsOwn.body, /BEGIN:VCALENDAR/);
});

test('financials and expenses stay per master', async () => {
  await call('PATCH', `/admin/bookings/${bookingA.id}/status`, { token: tokenA, body: { status: 'completed' } });
  const exp = await call('POST', '/admin/expenses', {
    token: tokenA,
    body: { category: 'Supplies', amount: 1200, date },
  });
  assert.equal(exp.status, 201);

  const finA = await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: tokenA });
  assert.equal(finA.body.income.total, 5000);
  assert.equal(finA.body.expenses.total, 1200);
  const finB = await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: tokenB });
  assert.equal(finB.body.income.total, 0);
  assert.equal(finB.body.expenses.total, 0);
  assert.equal((await call('DELETE', `/admin/expenses/${exp.body.id}`, { token: tokenB })).status, 404);
});

test('an expired trial closes the page to bookings but not the admin', async () => {
  await db.query(`UPDATE masters SET trial_ends_at = now() - interval '1 day' WHERE slug = 'bella'`);

  assert.equal((await call('GET', '/site', { slug: 'bella' })).body.open, false);
  const closed = await call('POST', '/bookings', {
    slug: 'bella',
    body: { date, time: '14:00', customerName: 'Late', customerPhone: '1', items: [{ serviceId: zoneB.serviceId }] },
  });
  assert.equal(closed.status, 403);
  assert.equal(closed.body.error, 'page_closed');

  const account = await call('GET', '/admin/account', { token: tokenB });
  assert.equal(account.body.access.state, 'expired');
  assert.equal((await call('GET', '/admin/bookings', { token: tokenB })).status, 200);
});

function signed(payload) {
  const raw = JSON.stringify(payload);
  return {
    raw,
    signature: createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
  };
}

test('a Lemon Squeezy webhook reopens the page; a forged one is refused', async () => {
  const { rows } = await db.query(`SELECT id FROM masters WHERE slug = 'bella'`);
  const payload = {
    meta: { event_name: 'subscription_created', custom_data: { master_id: String(rows[0].id) } },
    data: {
      type: 'subscriptions',
      id: '999',
      attributes: {
        status: 'active',
        customer_id: 42,
        renews_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        ends_at: null,
        urls: { customer_portal: 'https://example.lemonsqueezy.com/billing' },
      },
    },
  };
  const { raw, signature } = signed(payload);

  const forged = await fetch(`${BASE}/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'deadbeef' },
    body: raw,
  });
  assert.equal(forged.status, 401);
  assert.equal((await call('GET', '/site', { slug: 'bella' })).body.open, false);

  const real = await fetch(`${BASE}/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
    body: raw,
  });
  assert.equal(real.status, 200);
  assert.equal((await call('GET', '/site', { slug: 'bella' })).body.open, true);
  const account = await call('GET', '/admin/account', { token: tokenB });
  assert.equal(account.body.access.state, 'active');
  assert.equal(account.body.access.customerPortalUrl, 'https://example.lemonsqueezy.com/billing');

  // Cancelled: open until the paid period ends.
  const cancelled = signed({
    ...payload,
    meta: { ...payload.meta, event_name: 'subscription_cancelled' },
    data: { ...payload.data, attributes: { ...payload.data.attributes, status: 'cancelled', ends_at: new Date(Date.now() + 5 * 86400000).toISOString() } },
  });
  await fetch(`${BASE}/billing/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': cancelled.signature },
    body: cancelled.raw,
  });
  assert.equal((await call('GET', '/site', { slug: 'bella' })).body.open, true);
  assert.equal((await call('GET', '/admin/account', { token: tokenB })).body.access.state, 'cancelled');
});

test('platform screens are for the platform admin only', async () => {
  assert.equal((await call('GET', '/platform/masters', { token: tokenA })).status, 403);
  assert.equal((await call('GET', '/platform/masters')).status, 401);

  await db.query(`UPDATE users SET is_platform_admin = true WHERE email = 'anna@example.com'`);
  const list = await call('GET', '/platform/masters', { token: tokenA });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((m) => m.slug).sort(), ['anna', 'bella']);

  const bella = list.body.find((m) => m.slug === 'bella');
  assert.equal((await call('PATCH', `/platform/masters/${bella.id}`, { token: tokenA, body: { suspended: true } })).status, 200);
  assert.equal((await call('GET', '/site', { slug: 'bella' })).body.open, false);
  await call('PATCH', `/platform/masters/${bella.id}`, { token: tokenA, body: { suspended: false } });

  // A custom domain resolves to the master's page.
  await call('PATCH', `/platform/masters/${bella.id}`, { token: tokenA, body: { customDomain: 'bella-beauty.com' } });
  const viaDomain = await call('GET', '/site', { headers: { 'X-Forwarded-Host': 'www.bella-beauty.com' } });
  assert.equal(viaDomain.body.slug, 'bella');

  const reset = await call('POST', `/platform/masters/${bella.id}/reset-password`, { token: tokenA });
  assert.equal(reset.status, 200);
  // The old session ended with the reset; the new password works.
  assert.equal((await call('GET', '/admin/account', { token: tokenB })).status, 401);
  const login = await call('POST', '/auth/login', { body: { email: 'bella@example.com', password: reset.body.password } });
  assert.equal(login.status, 200);
  tokenB = login.body.token;
});

test("the operator sees one master in depth, without their clients' details", async () => {
  const list = await call('GET', '/platform/masters', { token: tokenA });
  const anna = list.body.find((m) => m.slug === 'anna');

  const detail = await call('GET', `/platform/masters/${anna.id}`, { token: tokenA });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const { master, categories, stats, monthly } = detail.body;
  assert.equal(master.slug, 'anna');
  assert.equal(master.email, 'anna@example.com');

  // The zone booked and completed earlier shows what it sold.
  const zone = categories.flatMap((c) => c.services).find((s) => s.id === zoneA.serviceId);
  assert.deepEqual({ bookings: zone.bookings, completed: zone.completed, revenue: zone.revenue }, { bookings: 1, completed: 1, revenue: 5000 });
  // The template's zones are listed too, hidden and unpriced.
  assert.ok(categories.flatMap((c) => c.services).some((s) => !s.is_active && s.price === 0));

  assert.equal(stats.total, 1);
  assert.equal(stats.byStatus.completed, 1);
  assert.equal(stats.revenue, 5000);
  assert.equal(stats.online, 1);
  assert.equal(stats.clients, 1);
  assert.equal(stats.completionRate, 1);
  assert.equal(monthly.length, 6);

  // Aggregates only: no client's name or phone anywhere in the answer.
  const raw = JSON.stringify(detail.body);
  for (const needle of ['+37400000001', '"Guest"']) {
    assert.ok(!raw.includes(needle), `client details leaked: ${needle} in ${raw.slice(Math.max(0, raw.indexOf(needle) - 80), raw.indexOf(needle) + 40)}`);
  }

  assert.equal((await call('GET', '/platform/masters/999999', { token: tokenA })).status, 404);
  assert.equal((await call('GET', `/platform/masters/${anna.id}`, { token: tokenB })).status, 403);
});

test('an operator with no booking page can change their password', async () => {
  await db.query(
    `INSERT INTO users (email, password_hash, is_platform_admin)
     VALUES ('operator', $1, true)`,
    [(await import('bcryptjs')).default.hashSync('operator password 1', 4)]
  );
  const login = await call('POST', '/auth/login', { body: { email: 'operator', password: 'operator password 1' } });
  assert.equal(login.status, 200);
  assert.equal((await call('GET', '/admin/account', { token: login.body.token })).body.error, 'no_master');

  const weak = await call('POST', '/platform/password', {
    token: login.body.token,
    body: { currentPassword: 'operator password 1', newPassword: 'short' },
  });
  assert.equal(weak.body.error, 'weak_password');
  const wrong = await call('POST', '/platform/password', {
    token: login.body.token,
    body: { currentPassword: 'not it', newPassword: 'operator password 2' },
  });
  assert.equal(wrong.status, 403);

  const changed = await call('POST', '/platform/password', {
    token: login.body.token,
    body: { currentPassword: 'operator password 1', newPassword: 'operator password 2' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/platform/masters', { token: login.body.token })).status, 401);
  assert.equal((await call('GET', '/platform/masters', { token: changed.body.token })).status, 200);
  const relogin = await call('POST', '/auth/login', { body: { email: 'operator', password: 'operator password 2' } });
  assert.equal(relogin.status, 200);
});

test('changing the password ends other sessions', async () => {
  const wrong = await call('POST', '/admin/account/password', {
    token: tokenB,
    body: { currentPassword: 'nope', newPassword: 'another good password' },
  });
  assert.equal(wrong.status, 403);

  const before = await call('POST', '/auth/login', {
    body: { email: 'anna@example.com', password: 'correct horse battery' },
  });
  const changed = await call('POST', '/admin/account/password', {
    token: tokenA,
    body: { currentPassword: 'correct horse battery', newPassword: 'another good password' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await call('GET', '/admin/account', { token: before.body.token })).status, 401);
  assert.equal((await call('GET', '/admin/account', { token: changed.body.token })).status, 200);
});

test('deleting an account removes everything it owned', async () => {
  const token = await signup('gone');
  await makeZone(token);
  const del = await call('DELETE', '/admin/account', { token, body: { password: 'correct horse battery' } });
  assert.equal(del.status, 204);
  assert.equal((await call('GET', '/site', { slug: 'gone' })).status, 404);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'gone@example.com'`);
  assert.equal(rows[0].n, 0);
});
