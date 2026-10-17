import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Most masters will type their name in Armenian or Cyrillic, but a page
// address is Latin — so the suggested address is transliterated from it.
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't', ժ: 'zh', ի: 'i', լ: 'l',
  խ: 'kh', ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz', ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh',
  ո: 'o', չ: 'ch', պ: 'p', ջ: 'j', ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts', ւ: 'v',
  փ: 'p', ք: 'k', օ: 'o', ֆ: 'f', և: 'ev',
};

export function suggestSlug(name) {
  return [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

// Whether a page address is free, asked a moment after typing stops: null
// (nothing typed), 'checking', 'ok', or the reason it can't be had
// ('slug_taken', 'invalid_slug', 'slug_reserved'). Only the newest answer counts.
export function useSlugStatus(slug) {
  const [status, setStatus] = useState(null);
  const latest = useRef(0);
  useEffect(() => {
    const id = latest.current + 1;
    latest.current = id;
    if (!slug) {
      setStatus(null);
      return undefined;
    }
    setStatus('checking');
    const timer = setTimeout(() => {
      api
        .checkSlug(slug)
        .then((r) => latest.current === id && setStatus(r.available ? 'ok' : r.reason))
        .catch(() => latest.current === id && setStatus(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [slug]);
  return status;
}
