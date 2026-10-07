export function cleanString(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export function isValidDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

export function isValidTime(str) {
  return typeof str === 'string' && /^\d{2}:\d{2}$/.test(str);
}
