import pg from 'pg';

const { Pool, types } = pg;

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of pg's default
// (a JS Date parsed in the process's local timezone, which silently shifts
// the calendar date depending on server TZ — not what a DATE column means).
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
