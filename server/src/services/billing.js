import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';

// Subscriptions through Lemon Squeezy (merchant of record: it handles cards,
// VAT and receipts). Every master gets a free trial at sign-up with no card;
// subscribing opens a Lemon Squeezy checkout, and from then on Lemon Squeezy's
// webhooks are the only thing that changes a master's subscription columns.
//
// Configuration, all from the environment:
//   LEMONSQUEEZY_API_KEY         API key (Settings → API)
//   LEMONSQUEEZY_STORE_ID        the store's numeric id
//   LEMONSQUEEZY_VARIANT_ID      the subscription product's variant
//   LEMONSQUEEZY_WEBHOOK_SECRET  signing secret of the webhook pointed at
//                                <PUBLIC_URL>/api/billing/webhook

const API = 'https://api.lemonsqueezy.com/v1';

export function billingConfig() {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = process.env.LEMONSQUEEZY_VARIANT_ID;
  return apiKey && storeId && variantId ? { apiKey, storeId, variantId } : null;
}

// A checkout link for this master. The master's id rides along as custom data,
// which Lemon Squeezy hands back in every webhook about the subscription —
// that's how a payment finds its master.
export async function createCheckout({ master, email, redirectUrl }) {
  const config = billingConfig();
  if (!config) return { error: 'billing_not_configured' };

  const res = await fetch(`${API}/checkouts`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: { email, custom: { master_id: String(master.id) } },
          product_options: { redirect_url: redirectUrl },
        },
        relationships: {
          store: { data: { type: 'stores', id: String(config.storeId) } },
          variant: { data: { type: 'variants', id: String(config.variantId) } },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    console.error('Lemon Squeezy checkout failed:', res.status, await res.text());
    return { error: 'checkout_failed' };
  }
  const body = await res.json();
  return { url: body?.data?.attributes?.url };
}

// X-Signature is the hex HMAC-SHA256 of the raw request body.
export function isValidSignature(rawBody, signature) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const SUBSCRIPTION_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_cancelled',
  'subscription_resumed',
  'subscription_expired',
  'subscription_paused',
  'subscription_unpaused',
  'subscription_payment_success',
  'subscription_payment_failed',
  'subscription_payment_recovered',
]);

// Applies one webhook. Every subscription event carries the subscription's
// full current state, so each one simply overwrites the master's columns with
// it — no event depends on having seen the one before, and a replayed or
// out-of-order delivery can only ever restore a state Lemon Squeezy really had.
// Payment events carry an invoice rather than the subscription, so they're
// recorded but change nothing; the subscription_updated that accompanies them
// does the work.
export async function applyWebhook(payload) {
  const eventName = payload?.meta?.event_name;
  const masterId = Number(payload?.meta?.custom_data?.master_id);
  const data = payload?.data;
  const knownMaster = Number.isInteger(masterId) ? masterId : null;

  await pool.query(
    `INSERT INTO billing_events (master_id, event_name, payload)
     SELECT $1, $2, $3 WHERE $1::int IS NULL OR EXISTS (SELECT 1 FROM masters WHERE id = $1)`,
    [knownMaster, String(eventName ?? 'unknown'), payload]
  );

  if (!SUBSCRIPTION_EVENTS.has(eventName) || data?.type !== 'subscriptions' || !knownMaster) {
    return;
  }

  const a = data.attributes ?? {};
  await pool.query(
    `UPDATE masters SET
       subscription_status = $2,
       ls_subscription_id = $3,
       ls_customer_id = $4,
       period_ends_at = $5,
       customer_portal_url = $6
     WHERE id = $1
       -- A master who subscribed twice: news about an old, dead subscription
       -- mustn't overwrite the live one.
       AND (ls_subscription_id IS NULL OR ls_subscription_id = $3
            OR $2 IN ('active', 'on_trial', 'past_due'))`,
    [
      knownMaster,
      a.status ?? null,
      String(data.id),
      a.customer_id != null ? String(a.customer_id) : null,
      // A cancelled subscription runs until ends_at; a live one renews at renews_at.
      a.ends_at ?? a.renews_at ?? null,
      a.urls?.customer_portal ?? null,
    ]
  );
}
