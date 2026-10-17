import { pool } from '../db.js';

// Every translatable/plain text column on salon_profile, in one place: the
// admin PUT, the guest GET and the SELECT list all derive from this, so
// adding a field to the profile means editing exactly this array.
export const PROFILE_TEXT_COLUMNS = [
  'owner_name_en', 'owner_name_ru', 'owner_name_hy',
  'tagline_en', 'tagline_ru', 'tagline_hy',
  'about_en', 'about_ru', 'about_hy',
  'address_en', 'address_ru', 'address_hy',
  'map_url',
  'phone', 'whatsapp', 'telegram', 'instagram', 'email',
];

export const PROFILE_MAX_LENGTH = {
  about_en: 2000,
  about_ru: 2000,
  about_hy: 2000,
  map_url: 500,
};
const DEFAULT_MAX_LENGTH = 200;

export const maxLengthFor = (column) => PROFILE_MAX_LENGTH[column] ?? DEFAULT_MAX_LENGTH;

// snake_case column -> camelCase API key ('owner_name_en' -> 'ownerNameEn')
export const toCamel = (column) => column.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());

// Shapes a salon_profile row for the API. Never includes the photo bytes —
// those are served separately by GET /api/profile/photo; `photoVersion` is
// what lets the client cache-bust that URL after the master uploads a new one.
export function shapeProfile(row) {
  const profile = {};
  for (const column of PROFILE_TEXT_COLUMNS) {
    profile[toCamel(column)] = row[column] ?? '';
  }
  profile.photoVersion = row.photo_updated_at ? new Date(row.photo_updated_at).getTime() : null;
  return profile;
}

// Whose landing page: a master's (salon_profile, by master_id) or a salon's
// (organization_profile, by organization_id) — the same fields either way.
// `table` and `column` are only ever these two pairs, written in code.
export const masterProfile = (masterId) => ({ table: 'salon_profile', column: 'master_id', id: masterId });
export const salonProfile = (organizationId) => ({
  table: 'organization_profile',
  column: 'organization_id',
  id: organizationId,
});

export async function getProfileRow(scope) {
  const { rows } = await pool.query(
    `SELECT ${PROFILE_TEXT_COLUMNS.join(', ')}, photo_updated_at
     FROM ${scope.table} WHERE ${scope.column} = $1`,
    [scope.id]
  );
  return rows[0] || null;
}

// The photo itself, for the guest page to serve.
export async function getProfilePhoto(scope) {
  const { rows } = await pool.query(
    `SELECT photo_mime, photo_data, photo_updated_at FROM ${scope.table} WHERE ${scope.column} = $1`,
    [scope.id]
  );
  return rows[0]?.photo_data ? rows[0] : null;
}
