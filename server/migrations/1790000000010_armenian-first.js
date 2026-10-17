export const shorthands = undefined;

// Armenian is the platform's first language: a new master's or salon's
// Telegram messages default to it, as their pages already do (default_lang).
// Existing accounts keep the language they have — a stored 'ru' can't be told
// apart from one somebody chose.
export const up = (pgm) => {
  pgm.alterColumn('masters', 'notify_lang', { default: 'hy' });
  pgm.alterColumn('organizations', 'notify_lang', { default: 'hy' });
};

export const down = (pgm) => {
  pgm.alterColumn('masters', 'notify_lang', { default: 'ru' });
  pgm.alterColumn('organizations', 'notify_lang', { default: 'ru' });
};
