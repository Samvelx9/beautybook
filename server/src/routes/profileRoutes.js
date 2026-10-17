import { Router, raw } from 'express';
import { pool } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { cleanString } from '../lib/validate.js';
import {
  PROFILE_TEXT_COLUMNS,
  getProfileRow,
  shapeProfile,
  maxLengthFor,
  toCamel,
} from '../services/profile.js';

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// A landing page's content, read and edited: a master's own page (mounted in
// routes/calendar.js) or a salon's (routes/salon.js). `scopeOf(req)` says
// whose, from what the mounting router has already established — never from
// the request itself.
export function profileRouter(scopeOf) {
  const router = Router({ mergeParams: true });

  router.get('/profile', asyncHandler(async (req, res) => {
    const row = await getProfileRow(scopeOf(req));
    if (!row) return res.status(404).json({ error: 'profile_not_found' });
    res.json(shapeProfile(row));
  }));

  // Every field is optional and may legitimately be blank — this is free-form
  // copy, not validated business data — so a field simply omitted from the body
  // keeps its current value, and one sent empty is cleared.
  router.put('/profile', asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const assignments = [];
    const values = [];

    for (const column of PROFILE_TEXT_COLUMNS) {
      const sent = req.body?.[toCamel(column)];
      if (sent === undefined) continue;
      values.push(cleanString(sent, maxLengthFor(column)));
      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
      return res.status(400).json({ error: 'no_fields_to_update' });
    }

    assignments.push('updated_at = now()');
    values.push(scope.id);
    await pool.query(
      `UPDATE ${scope.table} SET ${assignments.join(', ')} WHERE ${scope.column} = $${values.length}`,
      values
    );

    res.json(shapeProfile(await getProfileRow(scope)));
  }));

  // The image arrives as a raw body with its own Content-Type rather than as
  // multipart — one file, no other fields.
  router.put(
    '/profile/photo',
    raw({ type: PHOTO_MIME_TYPES, limit: '4mb' }),
    asyncHandler(async (req, res) => {
      const scope = scopeOf(req);
      const mime = req.get('content-type');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0 || !PHOTO_MIME_TYPES.includes(mime)) {
        return res.status(400).json({ error: 'invalid_image', accepts: PHOTO_MIME_TYPES });
      }

      await pool.query(
        `UPDATE ${scope.table}
         SET photo_mime = $1, photo_data = $2, photo_updated_at = now(), updated_at = now()
         WHERE ${scope.column} = $3`,
        [mime, req.body, scope.id]
      );

      res.json(shapeProfile(await getProfileRow(scope)));
    })
  );

  router.delete('/profile/photo', asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    await pool.query(
      `UPDATE ${scope.table}
       SET photo_mime = NULL, photo_data = NULL, photo_updated_at = NULL, updated_at = now()
       WHERE ${scope.column} = $1`,
      [scope.id]
    );
    res.json(shapeProfile(await getProfileRow(scope)));
  }));

  return router;
}
