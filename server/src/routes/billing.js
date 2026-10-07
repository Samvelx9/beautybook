import { Router, raw } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { applyWebhook, isValidSignature } from '../services/billing.js';

// Lemon Squeezy's webhook. Mounted before express.json() in index.js: the
// signature covers the raw bytes, so the body must arrive unparsed.
export const billingRouter = Router();

billingRouter.post(
  '/webhook',
  raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    if (!isValidSignature(req.body, req.get('X-Signature'))) {
      return res.sendStatus(401);
    }
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }
    await applyWebhook(payload);
    res.sendStatus(200);
  })
);
