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
import http from 'node:http';
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

// A stand-in for Lemon Squeezy's API: it answers checkouts with a URL naming
// the variant asked for, accepts subscription changes, and keeps every call
// for the tests to look at.
const lsCalls = [];
const fakeLemonSqueezy = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    lsCalls.push({ method: req.method, url: req.url, body });
    res.setHeader('Content-Type', 'application/vnd.api+json');
    if (req.method === 'POST' && req.url === '/v1/checkouts') {
      const variant = body.data.relationships.variant.data.id;
      res.end(JSON.stringify({ data: { attributes: { url: `https://checkout.test/${variant}` } } }));
    } else if (req.method === 'PATCH' && req.url.startsWith('/v1/subscriptions/')) {
      res.end(JSON.stringify({ data: body.data }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
});
const VARIANTS = { individual: '100', salon_5: '105', salon_10: '110', salon_unlimited: '111' };

before(async () => {
  await new Promise((resolve) => fakeLemonSqueezy.listen(0, '127.0.0.1', resolve));
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
      LEMONSQUEEZY_API_URL: `http://127.0.0.1:${fakeLemonSqueezy.address().port}/v1`,
      LEMONSQUEEZY_API_KEY: 'test-key',
      LEMONSQUEEZY_STORE_ID: '1',
      LEMONSQUEEZY_VARIANT_ID: VARIANTS.individual,
      LEMONSQUEEZY_VARIANT_SALON_5: VARIANTS.salon_5,
      LEMONSQUEEZY_VARIANT_SALON_10: VARIANTS.salon_10,
      LEMONSQUEEZY_VARIANT_SALON_UNLIMITED: VARIANTS.salon_unlimited,
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
  fakeLemonSqueezy.close();
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
  await db.query(
    `UPDATE organizations SET trial_ends_at = now() - interval '1 day'
      WHERE id = (SELECT organization_id FROM masters WHERE slug = 'bella')`
  );

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

  // Links keep to the platform address until the server has put the domain live.
  const bellaRow = async () => (await call('GET', '/platform/masters', { token: tokenA })).body.find((m) => m.slug === 'bella');
  assert.deepEqual([(await bellaRow()).customDomainStatus, (await bellaRow()).siteUrl], ['pending', `https://bella.${DOMAIN}`]);
  await db.query(`UPDATE masters SET custom_domain_status = 'active' WHERE slug = 'bella'`);
  assert.equal((await bellaRow()).siteUrl, 'https://bella-beauty.com');
  for (const bad of ['not a domain', 'x.' + DOMAIN, DOMAIN, '-bad.com', 'a'.repeat(64) + '.com']) {
    const refused = await call('PATCH', `/platform/masters/${bella.id}`, { token: tokenA, body: { customDomain: bad } });
    assert.equal(refused.body.error, 'invalid_domain', bad);
  }

  const reset = await call('POST', `/platform/masters/${bella.id}/reset-password`, { token: tokenA });
  assert.equal(reset.status, 200);
  // The old session ended with the reset; the new password works.
  assert.equal((await call('GET', '/admin/account', { token: tokenB })).status, 401);
  const login = await call('POST', '/auth/login', { body: { email: 'bella@example.com', password: reset.body.password } });
  assert.equal(login.status, 200);
  tokenB = login.body.token;
});

test('the platform price and support email: anyone can read them, only the operator can change them', async () => {
  const info = await call('GET', '/auth/platform');
  assert.equal(info.status, 200);
  assert.deepEqual(info.body, { priceMonthlyMinor: 1000, priceCurrency: 'USD', supportEmail: null, salonPricesMinor: { salon_5: 3000, salon_10: 5000, salon_unlimited: 8000 } });

  assert.equal((await call('PATCH', '/platform/settings', { token: tokenB, body: { priceMonthlyMinor: 1 } })).status, 403);
  assert.equal((await call('PATCH', '/platform/settings', { body: { priceMonthlyMinor: 1 } })).status, 401);
  for (const body of [{ priceMonthlyMinor: -5 }, { priceMonthlyMinor: 9.5 }, { priceCurrency: 'dollars' }, { supportEmail: 'not-an-email' }]) {
    assert.equal((await call('PATCH', '/platform/settings', { token: tokenA, body })).status, 400, JSON.stringify(body));
  }

  // tokenA was made platform admin by the test above.
  const saved = await call('PATCH', '/platform/settings', {
    token: tokenA,
    body: { priceMonthlyMinor: 1299, priceCurrency: 'eur', supportEmail: ' help@bb.test ' },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { priceMonthlyMinor: 1299, priceCurrency: 'EUR', supportEmail: 'help@bb.test', salonPricesMinor: { salon_5: 3000, salon_10: 5000, salon_unlimited: 8000 } });
  assert.deepEqual((await call('GET', '/auth/platform')).body, saved.body);
  // The salon plans' prices are the operator's to change too.
  const salonPrice = await call('PATCH', '/platform/settings', {
    token: tokenA, body: { salonPricesMinor: { salon_10: 5500 } },
  });
  assert.equal(salonPrice.body.salonPricesMinor.salon_10, 5500);
  assert.equal(
    (await call('PATCH', '/platform/settings', { token: tokenA, body: { salonPricesMinor: { salon_5: -1 } } })).body.error,
    'invalid_price'
  );
  await call('PATCH', '/platform/settings', { token: tokenA, body: { salonPricesMinor: { salon_10: 5000 } } });

  const cleared = await call('PATCH', '/platform/settings', { token: tokenA, body: { priceMonthlyMinor: 1000, priceCurrency: 'USD', supportEmail: null } });
  assert.deepEqual(cleared.body, { priceMonthlyMinor: 1000, priceCurrency: 'USD', supportEmail: null, salonPricesMinor: { salon_5: 3000, salon_10: 5000, salon_unlimited: 8000 } });
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

test('deleting an account removes everything it owned, bookings included', async () => {
  const token = await signup('gone');
  const zone = await makeZone(token);
  // A booked zone is what used to make the cascade fail.
  const booked = await call('POST', '/bookings', {
    slug: 'gone',
    body: { date, time: '12:00', customerName: 'G', customerPhone: '9', items: [{ serviceId: zone.serviceId }] },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  // Deleting that zone on its own is still refused.
  assert.equal((await call('DELETE', `/admin/services/${zone.serviceId}`, { token })).body.error, 'service_has_bookings');

  const del = await call('DELETE', '/admin/account', { token, body: { password: 'correct horse battery' } });
  assert.equal(del.status, 204);
  assert.equal((await call('GET', '/site', { slug: 'gone' })).status, 404);
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'gone@example.com'`);
  assert.equal(rows[0].n, 0);
  const { rows: left } = await db.query(
    `SELECT (SELECT COUNT(*) FROM bookings WHERE customer_name = 'G')::int AS bookings,
            (SELECT COUNT(*) FROM services WHERE id = $1)::int AS services`,
    [zone.serviceId]
  );
  assert.deepEqual(left[0], { bookings: 0, services: 0 });
});

test("each master sets their own minimum booking notice", async () => {
  const token = await signup('notice');
  const zone = await makeZone(token);
  assert.equal((await call('GET', '/site', { slug: 'notice' })).body.minNoticeMinutes, 90);

  const bad = await call('PATCH', '/admin/account/settings', { token, body: { minNoticeMinutes: 77 } });
  assert.equal(bad.body.error, 'invalid_min_notice');

  // Two days' notice: anything tomorrow (in the master's own timezone) is too soon.
  const set = await call('PATCH', '/admin/account/settings', { token, body: { minNoticeMinutes: 2880 } });
  assert.equal(set.status, 200);
  assert.equal(set.body.master.minNoticeMinutes, 2880);
  assert.equal((await call('GET', '/site', { slug: 'notice' })).body.minNoticeMinutes, 2880);

  const { rows } = await db.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Yerevan')::date + 1, 'YYYY-MM-DD') AS d`);
  const tomorrow = rows[0].d;
  const early = await call('POST', '/bookings', {
    slug: 'notice',
    body: { date: tomorrow, time: '18:00', customerName: 'N', customerPhone: '5', items: [{ serviceId: zone.serviceId }] },
  });
  assert.equal(early.status, 400);
  assert.deepEqual(early.body, { error: 'too_soon', minNoticeMinutes: 2880 });

  const slots = await call('GET', '/slots?durationMinutes=30', { slug: 'notice' });
  const day = slots.body.days.find((d) => d.date === tomorrow);
  assert.equal(day.slots.length, 0, 'nothing bookable tomorrow with two days of notice');

  // Other masters keep their own setting.
  assert.equal((await call('GET', '/site', { slug: 'anna' })).body.minNoticeMinutes, 90);

  // No notice at all: the next open slot today or later is offered again.
  await call('PATCH', '/admin/account/settings', { token, body: { minNoticeMinutes: 0 } });
  const open = await call('GET', '/slots?durationMinutes=30', { slug: 'notice' });
  assert.ok(open.body.days.some((d) => d.slots.length > 0));
});

test('each master sets how far ahead clients can book, and the API enforces it', async () => {
  const token = await signup('window');
  const zone = await makeZone(token);
  const site = await call('GET', '/site', { slug: 'window' });
  assert.equal(site.body.bookingWindowDays, 7);
  assert.equal((await call('GET', '/slots?durationMinutes=30', { slug: 'window' })).body.days.length, 7);

  // A Tuesday (open 10:00–19:00 by default) 8–14 days out, in the master's timezone.
  const { rows } = await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS d FROM generate_series(
       (now() AT TIME ZONE 'Asia/Yerevan')::date + 8, (now() AT TIME ZONE 'Asia/Yerevan')::date + 14, interval '1 day') d
     WHERE extract(isodow FROM d) = 2`
  );
  const later = rows[0].d;
  const body = { date: later, time: '11:00', customerName: 'W', customerPhone: '7', items: [{ serviceId: zone.serviceId }] };

  // Outside the default week: refused, even though the page never offers it.
  const far = await call('POST', '/bookings', { slug: 'window', body });
  assert.equal(far.status, 400);
  assert.deepEqual(far.body, { error: 'too_far', bookingWindowDays: 7 });

  assert.equal(
    (await call('PATCH', '/admin/account/settings', { token, body: { bookingWindowDays: 45 } })).body.error,
    'invalid_booking_window'
  );
  const set = await call('PATCH', '/admin/account/settings', { token, body: { bookingWindowDays: 30 } });
  assert.equal(set.body.master.bookingWindowDays, 30);
  assert.equal((await call('GET', '/slots?durationMinutes=30', { slug: 'window' })).body.days.length, 30);

  // Inside the 30-day window the same booking goes through, and can't be
  // moved beyond it.
  const ok = await call('POST', '/bookings', { slug: 'window', body });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const { rows: beyond } = await db.query(
    `SELECT to_char((now() AT TIME ZONE 'Asia/Yerevan')::date + 40, 'YYYY-MM-DD') AS d`
  );
  const moved = await call('POST', `/bookings/${ok.body.id}/reschedule`, {
    slug: 'window',
    body: { date: beyond[0].d, time: '11:00', token: ok.body.guestToken },
  });
  assert.equal(moved.body.error, 'too_far');

  // Other masters keep their own window.
  assert.equal((await call('GET', '/site', { slug: 'anna' })).body.bookingWindowDays, 7);
});

test("the database keeps a booking to its own organization's price list", async () => {
  const { rows } = await db.query(
    `SELECT b.id AS booking_id, b.master_id, b.organization_id,
            (SELECT s.id FROM services s WHERE s.organization_id <> b.organization_id LIMIT 1) AS foreign_service
     FROM bookings b JOIN masters m ON m.id = b.master_id WHERE m.slug = 'bella' LIMIT 1`
  );
  const b = rows[0];
  assert.ok(b.foreign_service, 'another organization has a service to try');
  await assert.rejects(
    db.query(
      `INSERT INTO booking_items (booking_id, master_id, organization_id, service_id, duration_minutes, price_at_booking)
       VALUES ($1, $2, $3, $4, 30, 0)`,
      [b.booking_id, b.master_id, b.organization_id, b.foreign_service]
    ),
    { code: '23503' }
  );
});

test('only the owner can delete the organization or subscribe', async () => {
  // A salon's master: their own calendar in the owner's organization. There's
  // no API to add one yet, so they're written in directly.
  const owner = await signup('salon-owner');
  const { rows } = await db.query(
    `SELECT m.id, m.organization_id FROM masters m WHERE m.slug = 'salon-owner'`
  );
  const bcrypt = (await import('bcryptjs')).default;
  await db.query(
    `INSERT INTO users (organization_id, master_id, role, email, password_hash)
     VALUES ($1, $2, 'master', 'staff@example.com', $3)`,
    [rows[0].organization_id, rows[0].id, bcrypt.hashSync('staff password 1', 4)]
  );
  const staff = (await call('POST', '/auth/login', {
    body: { email: 'staff@example.com', password: 'staff password 1' },
  })).body.token;

  assert.equal((await call('GET', '/admin/bookings', { token: staff })).status, 200);
  const del = await call('DELETE', '/admin/account', { token: staff, body: { password: 'staff password 1' } });
  assert.equal(del.status, 403);
  assert.equal(del.body.error, 'not_owner');
  assert.equal((await call('POST', '/admin/billing/checkout', { token: staff })).body.error, 'not_owner');

  // The owner deleting the organization takes the staff login with it.
  const gone = await call('DELETE', '/admin/account', { token: owner, body: { password: 'correct horse battery' } });
  assert.equal(gone.status, 204);
  const { rows: left } = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'staff@example.com'`);
  assert.equal(left[0].n, 0);
});

// ---------------------------------------------------------------------------
// Salons
// ---------------------------------------------------------------------------

// Sign-ups are rate limited per address; the salon tests sign up from their own.
const SALON_IP = { 'X-Real-IP': '198.51.100.7' };

async function signupSalon(name, extra = {}) {
  const res = await call('POST', '/auth/signup', {
    headers: SALON_IP,
    body: {
      accountType: 'salon',
      salonName: name,
      salonSlug: `${name.toLowerCase()}-salon`,
      email: `${name.toLowerCase()}@salon.example`,
      password: 'correct horse battery',
      languages: ['ru', 'en'],
      defaultLang: 'ru',
      timezone: 'Asia/Yerevan',
      ...extra,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.token;
}

// Logins are rate limited per address (20 in 15 minutes); the tests log in
// more often than that, each from its own.
let loginAddress = 0;
const login = async (email, password) => {
  loginAddress += 1;
  const headers = { 'X-Real-IP': `203.0.113.${loginAddress}` };
  return (await call('POST', '/auth/login', { headers, body: { email, password } })).body.token;
};

const salon = {};

test('a salon signs up; its owner runs it without a calendar of their own', async () => {
  salon.owner = await signupSalon('Rose');

  const account = await call('GET', '/admin/account', { token: salon.owner });
  assert.equal(account.status, 200);
  assert.equal(account.body.role, 'owner');
  assert.deepEqual(account.body.organization.kind, 'salon');
  assert.equal(account.body.master, null);
  assert.equal(account.body.access.state, 'trial');
  assert.equal((await call('GET', '/admin/bookings', { token: salon.owner })).body.error, 'no_master');

  // The price list is the salon's, whether or not the owner is a master.
  const cat = await call('POST', '/admin/categories', { token: salon.owner, body: { nameRu: 'Ногти' } });
  assert.equal(cat.status, 201);
  const svc = (nameRu, price) =>
    call('POST', '/admin/services', {
      token: salon.owner,
      body: { nameRu, categoryId: cat.body.id, durationMinutes: 60, price },
    });
  salon.manicure = (await svc('Маникюр', 8000)).body.id;
  salon.pedicure = (await svc('Педикюр', 10000)).body.id;

  const body = (await call('GET', '/salon', { token: salon.owner })).body;
  assert.equal(body.organization.name, 'Rose');
  assert.deepEqual(body.masters, []);

  // An individual master's account isn't a salon.
  assert.equal((await call('GET', '/salon', { token: tokenB })).body.error, 'not_a_salon');
  // A salon needs a name.
  const nameless = await call('POST', '/auth/signup', {
    headers: SALON_IP,
    body: { accountType: 'salon', salonSlug: 'nameless-salon', email: 'x@salon.example', password: 'correct horse battery' },
  });
  assert.equal(nameless.body.error, 'missing_salon_name');
});

test('the owner adds masters, and can become one', async () => {
  const add = (slug, email) =>
    call('POST', '/salon/masters', {
      token: salon.owner,
      body: { slug, email, displayName: `Master ${slug}` },
    });
  const nina = await add('rose-nina', 'nina@salon.example');
  assert.equal(nina.status, 201, JSON.stringify(nina.body));
  assert.equal(nina.body.email, 'nina@salon.example');
  assert.ok(nina.body.password.length >= 10);
  // Every service the salon has so far.
  assert.deepEqual(nina.body.master.serviceIds, [salon.manicure, salon.pedicure].sort((a, b) => a - b));
  salon.nina = { id: nina.body.master.id, token: await login('nina@salon.example', nina.body.password) };

  const lilit = await add('rose-lilit', 'lilit@salon.example');
  salon.lilit = { id: lilit.body.master.id, token: await login('lilit@salon.example', lilit.body.password) };

  assert.equal((await add('rose-nina', 'other@salon.example')).body.error, 'slug_taken');
  assert.equal((await add('rose-x', 'nina@salon.example')).body.error, 'email_taken');

  const self = await call('POST', '/salon/masters', {
    token: salon.owner,
    body: { self: true, slug: 'rose-owner', displayName: 'Owner' },
  });
  assert.equal(self.status, 201, JSON.stringify(self.body));
  assert.equal(self.body.master.isOwner, true);
  salon.ownerMasterId = self.body.master.id;
  assert.equal((await call('GET', '/admin/account', { token: salon.owner })).body.master.slug, 'rose-owner');
  assert.equal(
    (await call('POST', '/salon/masters', { token: salon.owner, body: { self: true, slug: 'rose-o2', displayName: 'O' } })).body.error,
    'already_a_master'
  );

  // A service added now goes to every working master.
  const cats = (await call('GET', '/admin/categories', { token: salon.owner })).body;
  const brows = await call('POST', '/admin/services', {
    token: salon.owner,
    body: { nameRu: 'Брови', categoryId: cats[0].id, durationMinutes: 30, price: 3000 },
  });
  salon.brows = brows.body.id;
  const body = (await call('GET', '/salon', { token: salon.owner })).body;
  assert.equal(body.activeMasters, 3);
  assert.equal(body.plan, 'salon_5');
  for (const m of body.masters) assert.ok(m.serviceIds.includes(salon.brows), m.slug);
});

test("a master's page offers only what they perform", async () => {
  const set = await call('PATCH', `/salon/masters/${salon.nina.id}`, {
    token: salon.owner,
    body: { serviceIds: [salon.manicure] },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.serviceIds, [salon.manicure]);

  const ninaServices = (await call('GET', '/services', { slug: 'rose-nina' })).body.map((s) => s.id);
  assert.deepEqual(ninaServices, [salon.manicure]);
  const ninaCats = (await call('GET', '/categories', { slug: 'rose-nina' })).body;
  assert.deepEqual(ninaCats[0].services.map((s) => s.id), [salon.manicure]);
  assert.equal(
    (await call('GET', `/services/${salon.pedicure}/slots`, { slug: 'rose-nina' })).status,
    404
  );

  const book = (slug, serviceId, time) =>
    call('POST', '/bookings', {
      slug,
      body: { date, time, customerName: 'Ani', customerPhone: '+37491000001', items: [{ serviceId }] },
    });
  assert.equal((await book('rose-nina', salon.pedicure, '12:00')).body.error, 'service_not_found');
  const ok = await book('rose-lilit', salon.pedicure, '12:00');
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  salon.lilitBooking = ok.body.id;
  assert.equal((await book('rose-nina', salon.manicure, '12:00')).status, 201);

  // Not one of the salon's services.
  const foreign = await call('PATCH', `/salon/masters/${salon.nina.id}`, {
    token: salon.owner,
    body: { serviceIds: [salon.manicure, zoneA.serviceId] },
  });
  assert.equal(foreign.body.error, 'invalid_service_ids');
});

test("a salon's master works their own calendar; the salon's business is the owner's", async () => {
  const nina = salon.nina.token;
  const mine = (await call('GET', '/admin/bookings', { token: nina })).body;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].customer_name, 'Ani');

  assert.equal((await call('GET', '/admin/services', { token: nina })).status, 200);
  // Her own part of the price list is hers (see the test further down); a
  // whole starter list for the salon is not.
  assert.equal((await call('POST', '/admin/templates/nails', { token: nina })).body.error, 'not_owner');
  assert.equal((await call('GET', '/admin/expenses', { token: nina })).body.error, 'not_owner');
  assert.equal((await call('GET', '/salon', { token: nina })).body.error, 'not_owner');
  assert.equal(
    (await call('PATCH', '/admin/account/settings', { token: nina, body: { currency: 'USD' } })).body.error,
    'not_owner'
  );
  const own = await call('PATCH', '/admin/account/settings', { token: nina, body: { minNoticeMinutes: 60 } });
  assert.equal(own.status, 200);
  assert.equal(own.body.master.minNoticeMinutes, 60);

  // The salon's currency is everyone's.
  const changed = await call('PATCH', '/salon', { token: salon.owner, body: { currency: 'USD', name: 'Rose Studio' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await call('GET', '/site', { slug: 'rose-nina' })).body.currency, 'USD');
  assert.equal((await call('GET', '/site', { slug: 'rose-owner' })).body.currency, 'USD');
});

test("the owner sees and manages every master's bookings", async () => {
  const all = (await call('GET', '/salon/bookings', { token: salon.owner })).body;
  assert.deepEqual(all.map((b) => b.master_id).sort(), [salon.nina.id, salon.lilit.id].sort());
  const ninaOnly = (await call('GET', `/salon/bookings?masterId=${salon.nina.id}`, { token: salon.owner })).body;
  assert.equal(ninaOnly.length, 1);

  // Through a master's calendar, as the master would.
  const made = await call('POST', `/salon/masters/${salon.nina.id}/bookings`, {
    token: salon.owner,
    body: { date, time: '15:00', customerName: 'Phone', customerPhone: '+37491000002', items: [{ serviceId: salon.manicure }] },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal((await call('GET', '/admin/bookings', { token: salon.nina.token })).body.length, 2);

  // Handed to Lilit, who's free then.
  const moved = await call('PATCH', `/salon/masters/${salon.nina.id}/bookings/${made.body.id}`, {
    token: salon.owner,
    body: { masterId: salon.lilit.id },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((await call('GET', '/admin/bookings', { token: salon.nina.token })).body.length, 1);
  assert.equal((await call('GET', '/admin/bookings', { token: salon.lilit.token })).body.length, 2);

  // Back onto Lilit's own 12:00 visit is refused by the overlap rule.
  const clash = await call('PATCH', `/salon/masters/${salon.lilit.id}/bookings/${made.body.id}`, {
    token: salon.owner,
    body: { masterId: salon.nina.id, time: '12:00' },
  });
  assert.equal(clash.body.error, 'slot_taken');

  // Each master's notice and window are set on their own calendar.
  const window = await call('PATCH', `/salon/masters/${salon.lilit.id}/availability/settings`, {
    token: salon.owner,
    body: { bookingWindowDays: 30 },
  });
  assert.deepEqual(window.body, { minNoticeMinutes: 90, bookingWindowDays: 30 });
  assert.equal((await call('GET', '/site', { slug: 'rose-lilit' })).body.bookingWindowDays, 30);
  assert.equal((await call('GET', '/site', { slug: 'rose-owner' })).body.bookingWindowDays, 7);

  // A master can't hand their visit on; nor reach another master's calendar.
  const byMaster = await call('PATCH', `/admin/bookings/${made.body.id}`, {
    token: salon.lilit.token,
    body: { masterId: salon.nina.id },
  });
  assert.equal(byMaster.body.error, 'not_owner');

  // Another salon's owner sees none of it.
  const other = await signupSalon('Lily');
  assert.equal((await call('GET', `/salon/masters/${salon.nina.id}/bookings`, { token: other })).status, 404);
  assert.equal((await call('PATCH', `/salon/masters/${salon.nina.id}`, { token: other, body: { active: false } })).status, 404);
  assert.deepEqual((await call('GET', '/salon/bookings', { token: other })).body, []);
  // Nor can a booking be handed to another salon's master.
  const { rows } = await db.query(`SELECT id FROM masters WHERE slug = 'anna'`);
  const away = await call('PATCH', `/salon/masters/${salon.lilit.id}/bookings/${made.body.id}`, {
    token: salon.owner,
    body: { masterId: rows[0].id },
  });
  assert.equal(away.body.error, 'invalid_master');
});

test("the owner's financials cover the salon; a master's only their own visits", async () => {
  await call('PATCH', `/salon/masters/${salon.lilit.id}/bookings/${salon.lilitBooking}/status`, {
    token: salon.owner,
    body: { status: 'completed' },
  });
  const ninaVisit = (await call('GET', '/admin/bookings', { token: salon.nina.token })).body[0];
  await call('PATCH', `/admin/bookings/${ninaVisit.id}/status`, {
    token: salon.nina.token,
    body: { status: 'completed' },
  });
  await call('POST', '/admin/expenses', {
    token: salon.owner,
    body: { category: 'Rent', amount: 50000, date },
  });

  // The salon's default split: 40% to the master, 60% to the salon.
  const owner = (await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: salon.owner })).body;
  assert.equal(owner.income.total, 18000);
  assert.equal(owner.income.ownerShare, 10800);
  assert.equal(owner.expenses.total, 50000);
  assert.equal(owner.net, 10800 - 50000);
  assert.equal(owner.income.byMaster.length, 2);
  const ninaRow = owner.income.byMaster.find((r) => r.master_id === salon.nina.id);
  assert.deepEqual([ninaRow.total, ninaRow.ownerShare], [8000, 4800]);
  const onlyNina = (await call('GET', `/admin/financials?from=${date}&to=${date}&masterId=${salon.nina.id}`, { token: salon.owner })).body;
  assert.equal(onlyNina.income.total, 8000);

  // A master sees their own share and nothing else.
  const nina = (await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: salon.nina.token })).body;
  assert.equal(nina.income.total, 3200);
  assert.equal(nina.income.ownerShare, undefined);
  assert.equal(nina.income.byService[0].total, 3200);
  assert.equal(nina.expenses.total, 0);
  assert.deepEqual(nina.income.byMaster, []);
});

test('the income split: salon-wide, per master, fixed once a visit is completed', async () => {
  // A new split applies to visits completed from now on, not to those before.
  const changed = await call('PATCH', '/salon', { token: salon.owner, body: { masterSharePercent: 50 } });
  assert.equal(changed.body.organization.masterSharePercent, 50);
  const before = (await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: salon.nina.token })).body;
  assert.equal(before.income.total, 3200);

  // Lilit is paid more than the salon's split.
  const lilit = await call('PATCH', `/salon/masters/${salon.lilit.id}`, { token: salon.owner, body: { sharePercent: 70 } });
  assert.deepEqual([lilit.body.sharePercent, lilit.body.effectiveSharePercent], [70, 70]);
  const visit = await call('POST', `/salon/masters/${salon.lilit.id}/bookings`, {
    token: salon.owner,
    body: { date, time: '17:00', customerName: 'Split', customerPhone: '+37491000009', status: 'completed', items: [{ serviceId: salon.manicure }] },
  });
  assert.equal(visit.status, 201, JSON.stringify(visit.body));
  const lilitFin = (await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: salon.lilit.token })).body;
  assert.equal(lilitFin.income.total, 4000 + 5600); // the pedicure at 40%, the new manicure at 70%

  // Handed to Nina, a completed visit is paid at Nina's share.
  await call('PATCH', `/salon/masters/${salon.lilit.id}/bookings/${visit.body.id}`, {
    token: salon.owner,
    body: { masterId: salon.nina.id },
  });
  const ninaFin = (await call('GET', `/admin/financials?from=${date}&to=${date}`, { token: salon.nina.token })).body;
  assert.equal(ninaFin.income.total, 3200 + 4000);

  // Back to the salon's split, and the owner's own visits are all theirs.
  const reset = await call('PATCH', `/salon/masters/${salon.lilit.id}`, { token: salon.owner, body: { sharePercent: null } });
  assert.deepEqual([reset.body.sharePercent, reset.body.effectiveSharePercent], [null, 50]);
  const own = await call('PATCH', `/salon/masters/${salon.ownerMasterId}`, { token: salon.owner, body: { sharePercent: 30 } });
  assert.equal(own.body.error, 'owner_keeps_all');
  const ownRow = (await call('GET', '/salon', { token: salon.owner })).body.masters.find((m) => m.isOwner);
  assert.equal(ownRow.effectiveSharePercent, 0);
  assert.equal(
    (await call('PATCH', '/salon', { token: salon.owner, body: { masterSharePercent: 120 } })).body.error,
    'invalid_share'
  );
});

test('a deactivated master can no longer sign in or be booked', async () => {
  const off = await call('PATCH', `/salon/masters/${salon.nina.id}`, { token: salon.owner, body: { active: false } });
  assert.equal(off.body.active, false);
  assert.equal((await call('GET', '/admin/account', { token: salon.nina.token })).body.error, 'master_deactivated');
  assert.equal((await call('GET', '/site', { slug: 'rose-nina' })).body.open, false);
  assert.equal((await call('GET', '/salon', { token: salon.owner })).body.activeMasters, 2);
  // Their history stays (the visit before, and the one handed to them in the
  // split test), and the owner can still look after it.
  assert.equal((await call('GET', `/salon/masters/${salon.nina.id}/bookings`, { token: salon.owner })).body.length, 2);

  // A new service no longer goes to them.
  const cats = (await call('GET', '/admin/categories', { token: salon.owner })).body;
  const svc = await call('POST', '/admin/services', {
    token: salon.owner,
    body: { nameRu: 'Наращивание', categoryId: cats[0].id, durationMinutes: 90, price: 15000 },
  });
  const masters = (await call('GET', '/salon', { token: salon.owner })).body.masters;
  assert.ok(!masters.find((m) => m.id === salon.nina.id).serviceIds.includes(svc.body.id));

  await call('PATCH', `/salon/masters/${salon.nina.id}`, { token: salon.owner, body: { active: true } });
  assert.equal((await call('GET', '/site', { slug: 'rose-nina' })).body.open, true);
});

test("the owner resets a master's password", async () => {
  const reset = await call('POST', `/salon/masters/${salon.lilit.id}/reset-password`, { token: salon.owner });
  assert.equal(reset.status, 200);
  assert.equal((await call('GET', '/admin/account', { token: salon.lilit.token })).status, 401);
  assert.ok(await login('lilit@salon.example', reset.body.password));
  // The owner's own calendar has no separate login to reset.
  const own = await call('POST', `/salon/masters/${salon.ownerMasterId}/reset-password`, { token: salon.owner });
  assert.equal(own.body.error, 'no_master_login');
});

test('taxes: the owner lists them, each master pays per their setting, fixed at completion', async () => {
  const owner = await signupSalon('Iris', { slug: 'iris-owner', displayName: 'Iris owner', templates: ['nails'] });
  const services = (await call('GET', '/admin/services', { token: owner })).body;
  const svc = services[0].id;
  await call('PATCH', `/admin/services/${svc}`, { token: owner, body: { isActive: true, price: 10000 } });

  const turnover = await call('POST', '/admin/taxes', { token: owner, body: { name: 'Turnover tax', ratePercent: 10 } });
  assert.equal(turnover.status, 201, JSON.stringify(turnover.body));
  const other = await call('POST', '/admin/taxes', { token: owner, body: { name: 'Other', ratePercent: 5 } });
  assert.equal((await call('POST', '/admin/taxes', { token: owner, body: { name: 'X', ratePercent: 0 } })).body.error, 'invalid_tax_rate');
  assert.equal((await call('POST', '/admin/taxes', { token: owner, body: { name: 'X', ratePercent: 16.667 } })).body.error, 'invalid_tax_rate');

  const masters = {};
  for (const [key, payer] of [['a', 'master'], ['b', 'salon'], ['c', 'both']]) {
    const added = await call('POST', '/salon/masters', {
      token: owner,
      body: { slug: `iris-${key}`, displayName: `Iris ${key}`, email: `iris-${key}@salon.example` },
    });
    const set = await call('PATCH', `/salon/masters/${added.body.master.id}`, { token: owner, body: { taxPayer: payer } });
    assert.equal(set.body.taxPayer, payer);
    masters[key] = { id: added.body.master.id, token: await login(`iris-${key}@salon.example`, added.body.password) };
  }
  const ownMaster = (await call('GET', '/salon', { token: owner })).body.masters.find((m) => m.isOwner);
  assert.equal(ownMaster.taxPayer, 'salon');
  assert.equal(
    (await call('PATCH', `/salon/masters/${ownMaster.id}`, { token: owner, body: { taxPayer: 'master' } })).body.error,
    'owner_keeps_all'
  );

  for (const id of [masters.a.id, masters.b.id, masters.c.id, ownMaster.id]) {
    const done = await call('POST', `/salon/masters/${id}/bookings`, {
      token: owner,
      body: { date, time: '11:00', customerName: 'Tax', customerPhone: '+37491000010', status: 'completed', items: [{ serviceId: svc }] },
    });
    assert.equal(done.status, 201, JSON.stringify(done.body));
  }

  const fin = (token) => call('GET', `/admin/financials?from=${date}&to=${date}`, { token }).then((r) => r.body);
  const seen = async (key) => {
    const f = await fin(masters[key].token);
    return [f.income.total, f.taxes.total, f.net];
  };
  assert.deepEqual(await seen('a'), [4000, 1500, 2500]); // pays both taxes on the whole visit
  assert.deepEqual(await seen('b'), [4000, 0, 4000]); // the salon pays
  assert.deepEqual(await seen('c'), [4000, 600, 3400]); // 15% of her 4000
  assert.deepEqual((await fin(masters.a.token)).taxes.byTax, [
    { name: 'Turnover tax', ratePercent: 10, total: 1000 },
    { name: 'Other', ratePercent: 5, total: 500 },
  ]);

  const o = await fin(owner);
  assert.equal(o.income.total, 40000);
  assert.equal(o.income.ownerShare, 6000 * 3 + 10000);
  assert.equal(o.taxes.total, 1500 + 900 + 1500); // b, c's salon part, the owner's own visit
  assert.equal(o.taxes.mastersPay, 1500 + 600);
  assert.equal(o.net, 28000 - 3900);
  const turnoverRow = o.taxes.byTax.find((t) => t.name === 'Turnover tax');
  assert.deepEqual(
    [turnoverRow.total, turnoverRow.mastersPay, turnoverRow.salonPays],
    [4000, 1000 + 400, 1000 + 600 + 1000]
  );
  const cRow = o.income.byMaster.find((r) => r.master_id === masters.c.id);
  assert.deepEqual([cRow.masterShare, cRow.masterTaxes, cRow.salonTaxes], [4000, 600, 900]);

  // Changing or removing a tax doesn't rewrite visits already completed.
  await call('PATCH', `/admin/taxes/${turnover.body.id}`, { token: owner, body: { ratePercent: 20 } });
  assert.equal((await call('DELETE', `/admin/taxes/${other.body.id}`, { token: owner })).status, 204);
  assert.deepEqual(await seen('a'), [4000, 1500, 2500]);
  assert.equal((await fin(owner)).net, 24100);

  // The list is the owner's.
  assert.equal((await call('GET', '/admin/taxes', { token: masters.a.token })).body.error, 'not_owner');
  assert.deepEqual(
    (await call('GET', '/admin/taxes', { token: owner })).body.map((t) => [t.name, t.ratePercent]),
    [['Turnover tax', 20]]
  );
});

test('an individual master pays their own taxes', async () => {
  const res = await call('POST', '/auth/signup', {
    headers: { 'X-Real-IP': '198.51.100.8' },
    body: { email: 'solo-tax@example.com', password: 'correct horse battery', slug: 'solo-tax', displayName: 'Solo' },
  });
  const token = res.body.token;
  const zone = await makeZone(token, { price: 10000 });
  await call('POST', '/admin/taxes', { token, body: { name: 'Turnover tax', ratePercent: 5 } });
  await call('POST', '/admin/bookings', {
    token,
    body: { date, time: '11:00', customerName: 'S', customerPhone: '1', status: 'completed', items: [{ serviceId: zone.serviceId }] },
  });
  const f = (await call('GET', `/admin/financials?from=${date}&to=${date}`, { token })).body;
  assert.deepEqual([f.income.total, f.taxes.total, f.taxes.mastersPay, f.net], [10000, 500, 0, 9500]);
});

test("a salon's own page: its masters, any-master slots and booking, salon-wide lookup", async () => {
  const owner = await signupSalon('Tulip', { templates: ['nails'] });
  const [s1, s2] = (await call('GET', '/admin/services', { token: owner })).body;
  for (const s of [s1, s2]) {
    await call('PATCH', `/admin/services/${s.id}`, { token: owner, body: { isActive: true, price: 7000, durationMinutes: 60 } });
  }
  const add = async (key) =>
    (await call('POST', '/salon/masters', {
      token: owner,
      body: { slug: `tulip-${key}`, displayName: `Tulip ${key}`, email: `tulip-${key}@salon.example` },
    })).body.master.id;
  const x = await add('x');
  const y = await add('y');
  await call('PATCH', `/salon/masters/${x}`, { token: owner, body: { serviceIds: [s1.id] } });

  // Salon and master pages share one set of addresses.
  assert.equal((await call('GET', '/auth/slug?slug=tulip-salon')).body.reason, 'slug_taken');
  const clash = await call('POST', '/salon/masters', {
    token: owner,
    body: { slug: 'tulip-salon', displayName: 'Z', email: 'tulip-z@salon.example' },
  });
  assert.equal(clash.body.error, 'slug_taken');
  assert.equal((await call('PATCH', '/salon', { token: owner, body: { slug: 'tulip-x' } })).body.error, 'slug_taken');

  // The landing page is the salon's own.
  await call('PUT', '/salon/profile', { token: owner, body: { aboutEn: 'Two masters, one address.' } });
  const page = 'tulip-salon';
  assert.equal((await call('GET', '/profile', { slug: page })).body.aboutEn, 'Two masters, one address.');
  assert.equal((await call('GET', '/profile', { slug: 'tulip-x' })).body.aboutEn, '');

  const site = (await call('GET', '/site', { slug: page })).body;
  assert.equal(site.kind, 'salon');
  assert.equal(site.open, true);
  assert.deepEqual(site.masters.map((m) => m.id), [x, y]);

  const cats = (await call('GET', '/categories', { slug: page })).body;
  const offered = new Map(cats.flatMap((c) => c.services).map((s) => [s.id, s.masterIds]));
  assert.deepEqual(offered.get(s1.id), [x, y]);
  assert.deepEqual(offered.get(s2.id), [y]);
  assert.equal((await call('GET', '/hours', { slug: page })).body.length, 7);
  assert.equal((await call('GET', `/services/${s1.id}/slots`, { slug: page })).body.error, 'master_required');

  const daySlots = async (serviceIds, master) => {
    const q = master ? `&master=${master}` : `&serviceIds=${serviceIds.join(',')}`;
    const { body } = await call('GET', `/slots?durationMinutes=60${q}`, { slug: page });
    return body.days.find((d) => d.date === date).slots;
  };
  assert.ok((await daySlots([s2.id])).includes('12:00'));

  const book = (serviceId, time, master) =>
    call('POST', `/bookings${master ? `?master=${master}` : ''}`, {
      slug: page,
      body: { date, time, customerName: 'Rose guest', customerPhone: '+37499000001', items: [{ serviceId }] },
    });

  // Only Y does s2: any-master goes to Y, and once Y is taken there's nobody.
  const first = await book(s2.id, '12:00');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.masterId, y);
  assert.equal((await book(s2.id, '12:00')).body.error, 'slot_taken');
  assert.ok(!(await daySlots([s2.id])).includes('12:00'));
  // s1 at 12:00 is still open with X.
  assert.ok((await daySlots([s1.id])).includes('12:00'));
  const second = await book(s1.id, '12:00');
  assert.equal(second.body.masterId, x);
  assert.equal((await book(s1.id, '12:00')).body.error, 'slot_taken');

  // A guest who picks a master gets that master's page, rules and all.
  assert.equal((await book(s2.id, '15:00', x)).body.error, 'service_not_found');
  const picked = await book(s2.id, '15:00', y);
  assert.equal(picked.body.masterId, y);
  assert.ok(!(await daySlots(null, y)).includes('15:00'));
  const { rows: annaRows } = await db.query(`SELECT id FROM masters WHERE slug = 'anna'`);
  assert.equal((await call('GET', `/site?master=${annaRows[0].id}`, { slug: page })).status, 404);

  // Looking up, cancelling and the calendar file work across the salon.
  const found = (await call('POST', '/bookings/lookup', { slug: page, body: { phone: '+37499000001' } })).body;
  assert.deepEqual(found.map((b) => b.master_id).sort(), [x, y, y].sort());
  const ics = await fetch(`${BASE}/calendar/${first.body.guestToken}.ics`, {
    headers: { 'X-Forwarded-Host': `${page}.${DOMAIN}` },
  });
  assert.equal(ics.status, 200);
  const cancelled = await call('POST', `/bookings/${second.body.id}/cancel`, {
    slug: page,
    body: { phone: '+37499000001' },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal((await book(s1.id, '12:00')).body.masterId, x);

  // Another salon's page doesn't know these visits.
  assert.equal(
    (await call('POST', `/bookings/${first.body.id}/cancel`, { slug: 'iris-salon', body: { phone: '+37499000001' } })).status,
    404
  );
});

test("a salon's plan follows its working masters: checkout, upgrade, downgrade", async () => {
  const owner = await signupSalon('Plum');
  const prices = (await call('GET', '/auth/platform')).body.salonPricesMinor;
  assert.deepEqual(prices, { salon_5: 3000, salon_10: 5000, salon_unlimited: 8000 });

  // A salon subscribes on its plan's variant; an individual master on theirs.
  const checkout = await call('POST', '/admin/billing/checkout', { token: owner });
  assert.equal(checkout.body.url, `https://checkout.test/${VARIANTS.salon_5}`);
  const soloCheckout = await call('POST', '/admin/billing/checkout', { token: tokenB });
  assert.equal(soloCheckout.body.url, `https://checkout.test/${VARIANTS.individual}`);

  const { rows } = await db.query(`SELECT id FROM organizations WHERE slug = 'plum-salon'`);
  const subscription = (variant, eventName = 'subscription_created') => {
    const { raw, signature } = signed({
      meta: { event_name: eventName, custom_data: { organization_id: String(rows[0].id) } },
      data: {
        type: 'subscriptions',
        id: '7001',
        attributes: { status: 'active', variant_id: Number(variant), renews_at: new Date(Date.now() + 30 * 86400000).toISOString() },
      },
    });
    return fetch(`${BASE}/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
      body: raw,
    });
  };
  assert.equal((await subscription(VARIANTS.salon_5)).status, 200);

  const changes = () => lsCalls.filter((c) => c.method === 'PATCH' && c.url === '/v1/subscriptions/7001');
  const masters = [];
  for (let i = 1; i <= 6; i += 1) {
    const added = await call('POST', '/salon/masters', {
      token: owner,
      body: { slug: `plum-${i}`, displayName: `Plum ${i}`, email: `plum-${i}@salon.example` },
    });
    masters.push(added.body.master.id);
    // Up to five masters stays on the first plan.
    if (i <= 5) assert.equal(changes().length, 0, `no change at ${i} masters`);
  }
  // The sixth moves the subscription up a plan.
  assert.equal(changes().length, 1);
  assert.equal(changes()[0].body.data.attributes.variant_id, Number(VARIANTS.salon_10));
  assert.equal((await call('GET', '/salon', { token: owner })).body.plan, 'salon_10');

  // One leaving moves it back down.
  await call('PATCH', `/salon/masters/${masters[5]}`, { token: owner, body: { active: false } });
  assert.equal(changes().length, 2);
  assert.equal(changes()[1].body.data.attributes.variant_id, Number(VARIANTS.salon_5));

  // A late webhook saying the old plan puts the salon on it — and the next
  // sync corrects it straight back.
  await subscription(VARIANTS.salon_10, 'subscription_updated');
  assert.equal(changes().length, 3);
  assert.equal(changes()[2].body.data.attributes.variant_id, Number(VARIANTS.salon_5));
  // Once on the right plan, nothing more is sent.
  await subscription(VARIANTS.salon_5, 'subscription_updated');
  assert.equal(changes().length, 3);
});

test('the operator sees organizations: salons with their masters and plan, without clients', async () => {
  // The operator login made by an earlier test.
  const operator = await login('operator', 'operator password 2');
  assert.equal((await call('GET', '/platform/organizations', { token: tokenB })).status, 403);
  const list = (await call('GET', '/platform/organizations', { token: operator })).body;
  const tulip = list.find((o) => o.name === 'Tulip');
  assert.equal(tulip.kind, 'salon');
  assert.equal(tulip.siteUrl, `https://tulip-salon.${DOMAIN}`);
  assert.equal(tulip.ownerEmail, 'tulip@salon.example');
  assert.deepEqual([tulip.activeMasters, tulip.totalMasters, tulip.plan, tulip.priceMonthlyMinor], [2, 2, 'salon_5', 3000]);
  assert.ok(tulip.bookingsTotal >= 3);
  const solo = list.find((o) => o.kind === 'solo' && o.name === 'Master bella');
  assert.ok(solo.masterId, 'a solo organization points at its master');
  assert.equal(solo.plan, 'individual');

  const detail = await call('GET', `/platform/organizations/${tulip.id}`, { token: operator });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.masters.map((m) => m.name), ['Tulip x', 'Tulip y']);
  assert.ok(detail.body.masters.every((m) => m.active));
  assert.equal(detail.body.clients, 1);
  const raw = JSON.stringify(detail.body);
  assert.ok(!raw.includes('+37499000001') && !raw.includes('Rose guest'), 'no client details');

  // The masters list says which salon each master works in.
  const masters = (await call('GET', '/platform/masters', { token: operator })).body;
  assert.equal(masters.find((m) => m.slug === 'tulip-x').salon.name, 'Tulip');
  assert.equal(masters.find((m) => m.slug === 'bella').salon, null);

  // Suspending the organization closes every one of its pages.
  await call('PATCH', `/platform/organizations/${tulip.id}`, { token: operator, body: { suspended: true } });
  for (const slug of ['tulip-salon', 'tulip-x', 'tulip-y']) {
    assert.equal((await call('GET', '/site', { slug })).body.open, false, slug);
  }
  await call('PATCH', `/platform/organizations/${tulip.id}`, { token: operator, body: { suspended: false } });
  assert.equal((await call('GET', '/site', { slug: 'tulip-salon' })).body.open, true);
  assert.equal(
    (await call('PATCH', `/platform/organizations/${tulip.id}`, { token: operator, body: { extendTrialDays: 0 } })).body.error,
    'invalid_days'
  );
});

test('Armenian is the default language', async () => {
  const res = await call('POST', '/auth/signup', {
    headers: { 'X-Real-IP': '198.51.100.9' },
    body: { email: 'hy-default@example.com', password: 'correct horse battery', slug: 'hy-default', displayName: 'Արմինե' },
  });
  assert.equal(res.status, 201);
  const account = (await call('GET', '/admin/account', { token: res.body.token })).body;
  assert.equal(account.master.defaultLang, 'hy');
  assert.equal(account.master.notifyLang, 'hy');
  assert.equal(account.organization.notifyLang, 'hy');
  assert.equal((await call('GET', '/site', { slug: 'hy-default' })).body.defaultLang, 'hy');
  const { rows } = await db.query(
    `SELECT column_default FROM information_schema.columns
      WHERE column_name = 'notify_lang' AND table_name IN ('masters', 'organizations')`
  );
  assert.deepEqual(rows.map((r) => r.column_default), ["'hy'::text", "'hy'::text"]);
});

test('a master changes their page address and login email', async () => {
  const res = await call('POST', '/auth/signup', {
    headers: { 'X-Real-IP': '198.51.100.10' },
    body: { email: 'mover@example.com', password: 'correct horse battery', slug: 'mover-old', displayName: 'Mover' },
  });
  const token = res.body.token;
  const moved = await call('PATCH', '/admin/account/slug', { token, body: { slug: 'mover-new' } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.master.slug, 'mover-new');
  assert.equal((await call('GET', '/site', { slug: 'mover-old' })).status, 404);
  assert.equal((await call('GET', '/site', { slug: 'mover-new' })).status, 200);
  // Taken by a master or a salon, or not an address at all.
  assert.equal((await call('PATCH', '/admin/account/slug', { token, body: { slug: 'bella' } })).body.error, 'slug_taken');
  assert.equal((await call('PATCH', '/admin/account/slug', { token, body: { slug: 'tulip-salon' } })).body.error, 'slug_taken');
  assert.equal((await call('PATCH', '/admin/account/slug', { token, body: { slug: 'www' } })).body.error, 'slug_reserved');

  const wrong = await call('POST', '/admin/account/email', { token, body: { email: 'mover2@example.com', password: 'nope' } });
  assert.equal(wrong.body.error, 'wrong_password');
  assert.equal(
    (await call('POST', '/admin/account/email', { token, body: { email: 'bella@example.com', password: 'correct horse battery' } })).body.error,
    'email_taken'
  );
  const changed = await call('POST', '/admin/account/email', { token, body: { email: 'Mover2@Example.com', password: 'correct horse battery' } });
  assert.equal(changed.body.email, 'mover2@example.com');
  assert.ok(await login('mover2@example.com', 'correct horse battery'));
  assert.equal((await call('POST', '/auth/login', { body: { email: 'mover@example.com', password: 'correct horse battery' } })).status, 401);
});

test("a salon's owner changes a master's page address", async () => {
  const owner = await login('tulip@salon.example', 'correct horse battery');
  const { rows } = await db.query(`SELECT id FROM masters WHERE slug = 'tulip-y'`);
  const moved = await call('PATCH', `/salon/masters/${rows[0].id}`, { token: owner, body: { slug: 'tulip-yana' } });
  assert.equal(moved.body.slug, 'tulip-yana');
  assert.equal((await call('GET', '/site', { slug: 'tulip-yana' })).status, 200);
  assert.equal((await call('PATCH', `/salon/masters/${rows[0].id}`, { token: owner, body: { slug: 'tulip-x' } })).body.error, 'slug_taken');
});

test('the operator deletes an account, confirmed by the owner email, never with a live subscription', async () => {
  const operator = await login('operator', 'operator password 2');
  const res = await call('POST', '/auth/signup', {
    headers: { 'X-Real-IP': '198.51.100.11' },
    body: {
      accountType: 'salon', salonName: 'Gone', salonSlug: 'gone-salon',
      email: 'gone-owner@salon.example', password: 'correct horse battery',
    },
  });
  const owner = res.body.token;
  await call('POST', '/salon/masters', { token: owner, body: { slug: 'gone-m', displayName: 'M', email: 'gone-m@salon.example' } });
  const { rows } = await db.query(`SELECT id FROM organizations WHERE slug = 'gone-salon'`);
  const id = rows[0].id;

  assert.equal((await call('DELETE', `/platform/organizations/${id}`, { token: owner, body: { confirm: 'gone-owner@salon.example' } })).status, 403);
  assert.equal((await call('DELETE', `/platform/organizations/${id}`, { token: operator, body: { confirm: 'someone@else' } })).body.error, 'confirmation_mismatch');

  await db.query(`UPDATE organizations SET subscription_status = 'active' WHERE id = $1`, [id]);
  assert.equal((await call('DELETE', `/platform/organizations/${id}`, { token: operator, body: { confirm: 'gone-owner@salon.example' } })).body.error, 'subscription_live');
  await db.query(`UPDATE organizations SET subscription_status = 'expired' WHERE id = $1`, [id]);

  const gone = await call('DELETE', `/platform/organizations/${id}`, { token: operator, body: { confirm: 'GONE-OWNER@salon.example' } });
  assert.equal(gone.status, 204);
  assert.equal((await call('GET', '/site', { slug: 'gone-salon' })).status, 404);
  assert.equal((await call('GET', '/site', { slug: 'gone-m' })).status, 404);
  const { rows: left } = await db.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE email IN ('gone-owner@salon.example', 'gone-m@salon.example')`
  );
  assert.equal(left[0].n, 0);
});

test('bookings and clients export as CSV: a master their own, the owner the salon', async () => {
  const owner = await login('tulip@salon.example', 'correct horse battery');
  const raw = async (url, token) => {
    const res = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await res.arrayBuffer());
    // .text() would drop the byte-order mark; the bytes keep it.
    return { status: res.status, type: res.headers.get('content-type'), bom: bytes.subarray(0, 3).toString('hex'), text: bytes.toString('utf8').replace(/^\uFEFF/, '') };
  };
  const all = await raw(`/admin/export/bookings.csv?from=${date}&to=${date}`, owner);
  assert.equal(all.status, 200);
  assert.match(all.type, /text\/csv/);
  assert.equal(all.bom, 'efbbbf');
  assert.ok(all.text.startsWith('date,start,end,master,client,phone'));
  const lines = all.text.trim().split('\r\n');
  assert.ok(lines.length >= 4, all.text);
  assert.ok(all.text.includes('Tulip x') && all.text.includes('Tulip y'));

  const { rows } = await db.query(`SELECT id FROM masters WHERE slug = 'tulip-x'`);
  const onlyX = await raw(`/admin/export/bookings.csv?from=${date}&to=${date}&masterId=${rows[0].id}`, owner);
  assert.ok(onlyX.text.includes('Tulip x') && !onlyX.text.includes('Tulip y'));

  const clients = await raw('/admin/export/clients.csv', owner);
  assert.ok(clients.text.includes('+37499000001'));
  assert.ok(clients.text.split('\r\n')[0].endsWith('spent,currency'));

  // Another salon's owner exports only theirs.
  const iris = await login('iris@salon.example', 'correct horse battery');
  assert.ok(!(await raw('/admin/export/clients.csv', iris)).text.includes('+37499000001'));
});

test('a CSV field that looks like a formula stays text', async () => {
  const { toCsv } = await import('../src/lib/csv.js');
  assert.equal(toCsv(['a', 'b'], [['=1+1', 'say "hi", ok']]), '﻿a,b\r\n\'=1+1,"say ""hi"", ok"\r\n');
});

test('the operator overview: sign-ups per week, states, conversion and revenue', async () => {
  const operator = await login('operator', 'operator password 2');
  assert.equal((await call('GET', '/platform/overview', { token: tokenB })).status, 403);
  const overview = await call('GET', '/platform/overview', { token: operator });
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  const o = overview.body;
  assert.equal(o.weeks.length, 12);
  const thisWeek = o.weeks.at(-1);
  const { rows } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE kind = 'solo')::int AS solo, COUNT(*) FILTER (WHERE kind = 'salon')::int AS salon,
            COUNT(*)::int AS total FROM organizations WHERE created_at >= date_trunc('week', now())`
  );
  assert.deepEqual([thisWeek.individual, thisWeek.salons], [rows[0].solo, rows[0].salon]);
  const { rows: all } = await db.query('SELECT COUNT(*)::int AS n FROM organizations');
  assert.equal(o.accounts, all[0].n);
  assert.equal(Object.values(o.states).reduce((a, b) => a + b, 0), o.accounts);
  // Plum's salon subscribed (phase 5 test) and is paying on the 5-master plan.
  assert.ok(o.states.paying >= 1);
  assert.ok(o.mrr.byPlan.salon_5.accounts >= 1);
  assert.equal(o.mrr.minor, Object.values(o.mrr.byPlan).reduce((sum, p) => sum + p.mrrMinor, 0));
  assert.ok(o.conversion.converted >= 1 && o.conversion.converted <= o.conversion.trialsEnded);
});

test('the most-booked zones come first for guests; the price list keeps its own order', async () => {
  // Its own address: the earlier tests used up this one's sign-ups and bookings.
  const headers = { 'X-Real-IP': '198.51.100.21' };
  const signedUp = await call('POST', '/auth/signup', {
    headers,
    body: {
      email: 'poppy@example.com',
      password: 'correct horse battery',
      slug: 'poppy',
      displayName: 'Master poppy',
      languages: ['ru', 'en'],
      defaultLang: 'ru',
    },
  });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));
  const { token } = signedUp.body;
  const cat = await call('POST', '/admin/categories', { token, body: { nameRu: 'Брови' } });
  const zone = async (nameRu) => {
    const res = await call('POST', '/admin/services', {
      token,
      body: { nameRu, categoryId: cat.body.id, durationMinutes: 30, price: 4000 },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id;
  };
  const first = await zone('Коррекция');
  const second = await zone('Окрашивание');

  const booked = await call('POST', '/bookings', {
    slug: 'poppy',
    headers,
    body: { date, time: '12:00', customerName: 'Guest', customerPhone: '+37400000077', items: [{ serviceId: second }] },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));

  const categories = await call('GET', '/categories', { slug: 'poppy' });
  assert.deepEqual(categories.body.find((c) => c.id === cat.body.id).services.map((s) => s.id), [second, first]);
  const services = await call('GET', '/services', { slug: 'poppy' });
  assert.deepEqual(services.body.map((s) => s.id), [second, first]);

  // The admin's list stays in price-list order and carries the counts the
  // booking form sorts by.
  const admin = await call('GET', '/admin/services', { token });
  assert.deepEqual(admin.body.map((s) => [s.id, s.recent_bookings]), [[first, 0], [second, 1]]);

  // A cancelled visit no longer counts.
  const cancelled = await call('PATCH', `/admin/bookings/${booked.body.id}/status`, { token, body: { status: 'cancelled' } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const after = await call('GET', '/services', { slug: 'poppy' });
  assert.deepEqual(after.body.map((s) => s.id), [first, second]);
});

test("a salon's master changes only what is theirs alone, and books only what they perform", async () => {
  const headers = { 'X-Real-IP': '198.51.100.31' };
  const signedUp = await call('POST', '/auth/signup', {
    headers,
    body: {
      accountType: 'salon', salonName: 'Lotus', salonSlug: 'lotus-salon', email: 'lotus@salon.example',
      password: 'correct horse battery', languages: ['ru', 'en'], defaultLang: 'ru', timezone: 'Asia/Yerevan',
    },
  });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));
  const owner = signedUp.body.token;

  const addMaster = async (slug) => {
    const res = await call('POST', '/salon/masters', { token: owner, body: { email: `${slug}@salon.example`, slug, displayName: slug } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { id: res.body.master.id, token: await login(res.body.email, res.body.password) };
  };
  const a = await addMaster('lotus-a');
  const b = await addMaster('lotus-b');

  // The owner's hair list: a cut both masters do, a colour only A does.
  const hair = await call('POST', '/admin/categories', { token: owner, body: { nameRu: 'Волосы' } });
  const service = async (token, categoryId, nameRu) => {
    const res = await call('POST', '/admin/services', { token, body: { nameRu, categoryId, durationMinutes: 30, price: 5000 } });
    return res;
  };
  const cut = (await service(owner, hair.body.id, 'Стрижка')).body.id;
  const colour = (await service(owner, hair.body.id, 'Окрашивание')).body.id;
  assert.equal((await call('PATCH', `/salon/masters/${b.id}`, { token: owner, body: { serviceIds: [cut] } })).status, 200);

  // A sees both, may change only the colour; B sees only the cut.
  const listA = (await call('GET', '/admin/services', { token: a.token })).body;
  assert.deepEqual(listA.map((s) => [s.id, s.editable]), [[cut, false], [colour, true]]);
  assert.deepEqual(listA[0].shared_with.map((m) => m.slug), ['lotus-b']);
  assert.deepEqual((await call('GET', '/admin/services', { token: b.token })).body.map((s) => s.id), [cut]);
  assert.equal((await call('PATCH', `/admin/services/${colour}`, { token: a.token, body: { price: 7000 } })).status, 200);
  assert.equal((await call('PATCH', `/admin/services/${cut}`, { token: a.token, body: { price: 1 } })).status, 403);
  assert.equal((await call('DELETE', `/admin/services/${cut}`, { token: a.token })).status, 403);
  // The hair treatment holds a shared service, so it's the owner's.
  assert.equal((await call('PATCH', `/admin/categories/${hair.body.id}`, { token: a.token, body: { nameRu: 'X' } })).status, 403);
  assert.equal((await call('POST', '/admin/templates/nails', { token: a.token })).status, 403);

  // A's own treatment, empty and then with A's own service in it.
  const nails = await call('POST', '/admin/categories', { token: a.token, body: { nameRu: 'Ногти' } });
  assert.equal(nails.status, 201);
  assert.equal(nails.body.editable, true);
  const manicure = await service(a.token, nails.body.id, 'Маникюр');
  assert.equal(manicure.status, 201);
  const ownerList = (await call('GET', '/admin/services', { token: owner })).body;
  assert.deepEqual(ownerList.find((s) => s.id === manicure.body.id).master_ids, [a.id]);
  assert.equal((await call('PATCH', `/admin/categories/${nails.body.id}`, { token: a.token, body: { nameRu: 'Ногтевой сервис' } })).status, 200);
  // B neither sees A's treatment nor may use or change it.
  assert.ok(!(await call('GET', '/admin/categories', { token: b.token })).body.some((c) => c.id === nails.body.id));
  assert.equal((await service(b.token, nails.body.id, 'Педикюр')).status, 400);
  assert.equal((await call('PATCH', `/admin/categories/${nails.body.id}`, { token: b.token, body: { nameRu: 'Y' } })).status, 403);

  // Bookings: B can't book A's colour; the owner can't either, for B.
  const booking = (serviceId, extra = {}) => ({
    date, time: '12:00', customerName: 'Walk-in', customerPhone: '+37499000111', items: [{ serviceId }], ...extra,
  });
  const refused = await call('POST', '/admin/bookings', { token: b.token, body: booking(colour) });
  assert.deepEqual([refused.status, refused.body.error], [400, 'not_performed']);
  assert.equal((await call('POST', '/admin/bookings', { token: b.token, body: booking(cut) })).status, 201);
  assert.equal((await call('POST', `/salon/masters/${b.id}/bookings`, { token: owner, body: booking(colour, { time: '14:00' }) })).status, 400);

  // Nor hand A's colour visit to B as it is.
  const aVisit = await call('POST', `/salon/masters/${a.id}/bookings`, { token: owner, body: booking(colour, { time: '15:00' }) });
  assert.equal(aVisit.status, 201, JSON.stringify(aVisit.body));
  const handOver = await call('PATCH', `/salon/masters/${a.id}/bookings/${aVisit.body.id}`, { token: owner, body: { masterId: b.id } });
  assert.deepEqual([handOver.status, handOver.body.error], [400, 'not_performed']);
});

test("each of a salon's masters has a colour: automatic and distinct, or the owner's pick", async () => {
  const owner = await login('lotus@salon.example', 'correct horse battery');
  const { body: lotus } = await call('GET', '/salon', { token: owner });
  const [a, b] = lotus.masters;
  assert.deepEqual([a.color, b.color, a.colorChosen], ['rose', 'orange', false]);

  assert.equal((await call('PATCH', `/salon/masters/${b.id}`, { token: owner, body: { color: 'plaid' } })).body.error, 'invalid_color');
  const picked = await call('PATCH', `/salon/masters/${b.id}`, { token: owner, body: { color: 'blue' } });
  assert.deepEqual([picked.body.color, picked.body.colorChosen], ['blue', true]);
  // The master sees the same colour in their own panel.
  const { rows } = await db.query(`SELECT email FROM users WHERE master_id = $1`, [b.id]);
  await db.query(`UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'lotus@salon.example') WHERE master_id = $1`, [b.id]);
  const masterToken = await login(rows[0].email, 'correct horse battery');
  assert.equal((await call('GET', '/admin/account', { token: masterToken })).body.master.color, 'blue');

  const automatic = await call('PATCH', `/salon/masters/${b.id}`, { token: owner, body: { color: null } });
  assert.deepEqual([automatic.body.color, automatic.body.colorChosen], ['orange', false]);
});
