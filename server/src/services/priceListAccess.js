import { pool } from '../db.js';

// What a salon's master may do with the salon's one shared price list. The
// owner (of a salon, or an individual master's account) changes everything; a
// salon's master changes only what is theirs alone:
//
// - a service is theirs when they perform it and no other working master does,
//   so one master can never change a price another master charges;
// - a treatment is theirs when every service in it is theirs, or, while it has
//   none yet, when they created it.
//
// They may add a service to any treatment they can see (one holding a service
// they perform, or one they created); it is performed by them alone.

export const isSalonMaster = (req) => req.user.role === 'master';

// SQL true when service `alias`.id is the master's ($n) alone.
export const OWN_SERVICE_SQL = (alias, param) => `(
  EXISTS (SELECT 1 FROM master_services ms_me
           WHERE ms_me.service_id = ${alias}.id AND ms_me.master_id = ${param})
  AND NOT EXISTS (SELECT 1 FROM master_services ms_other
                   JOIN masters m_other ON m_other.id = ms_other.master_id AND m_other.deactivated_at IS NULL
                   WHERE ms_other.service_id = ${alias}.id AND ms_other.master_id <> ${param}))`;

// SQL true when treatment `alias`.id is the master's ($n) to change.
export const OWN_CATEGORY_SQL = (alias, param) => `(
  CASE WHEN EXISTS (SELECT 1 FROM services s_in WHERE s_in.category_id = ${alias}.id)
       THEN NOT EXISTS (SELECT 1 FROM services s_in
                         WHERE s_in.category_id = ${alias}.id AND NOT ${OWN_SERVICE_SQL('s_in', param)})
       ELSE ${alias}.created_by_master_id IS NOT DISTINCT FROM ${param}
  END)`;

// SQL true when treatment `alias`.id shows on the master's ($n) screens.
export const VISIBLE_CATEGORY_SQL = (alias, param) => `(
  ${alias}.created_by_master_id IS NOT DISTINCT FROM ${param}
  OR EXISTS (SELECT 1 FROM services s_vis
              JOIN master_services ms_vis ON ms_vis.service_id = s_vis.id AND ms_vis.master_id = ${param}
              WHERE s_vis.category_id = ${alias}.id))`;

export async function ownsService(masterId, serviceId) {
  const { rows } = await pool.query(
    `SELECT ${OWN_SERVICE_SQL('s', '$1')} AS own FROM services s WHERE s.id = $2`,
    [masterId, serviceId]
  );
  return Boolean(rows[0]?.own);
}

export async function ownsCategory(masterId, categoryId) {
  const { rows } = await pool.query(
    `SELECT ${OWN_CATEGORY_SQL('c', '$1')} AS own FROM service_categories c WHERE c.id = $2`,
    [masterId, categoryId]
  );
  return Boolean(rows[0]?.own);
}

export async function seesCategory(masterId, categoryId) {
  const { rows } = await pool.query(
    `SELECT ${VISIBLE_CATEGORY_SQL('c', '$1')} AS visible FROM service_categories c WHERE c.id = $2`,
    [masterId, categoryId]
  );
  return Boolean(rows[0]?.visible);
}
