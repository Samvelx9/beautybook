// Masters type their contacts however they like in the admin — "+374 91 234567",
// "@anna_studio", "anna_studio", or a full URL. These turn whatever they
// typed into something tappable, and leave a full URL untouched.

const isUrl = (value) => /^https?:\/\//i.test(value);
const handle = (value) => value.replace(/^@/, '').trim();
const digits = (value) => value.replace(/[^\d+]/g, '').replace(/^\+/, '');

export function telHref(phone) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function whatsappHref(value) {
  return isUrl(value) ? value : `https://wa.me/${digits(value)}`;
}

export function telegramHref(value) {
  return isUrl(value) ? value : `https://t.me/${handle(value)}`;
}

export function instagramHref(value) {
  return isUrl(value) ? value : `https://instagram.com/${handle(value)}`;
}

export function emailHref(value) {
  return `mailto:${value}`;
}

// What to show next to the icon: a bare handle reads better than the full URL
// the master may have pasted in.
export function displayHandle(value) {
  if (!isUrl(value)) return value.startsWith('@') ? value : `@${handle(value)}`;
  const withoutScheme = value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const lastSegment = withoutScheme.split('/').pop();
  return lastSegment ? `@${lastSegment}` : withoutScheme;
}
