import type { LocalesValues } from '@intlayer/types/module_augmentation';
// Not a React hook despite the name: `next-intlayer/server` prefixes its
// server readers with `use` for symmetry with the client API, but they hold no
// positional state — its own `resolveFallbackLocale` documents that this is
// exactly what lets them run conditionally. Bound to a plain name here so the
// call below reads as what it is.
import { useLocale as readAmbientLocale } from 'next-intlayer/server';
import { getCachedRequestLocale } from '../requestLocaleCache';

/**
 * Locale for the synchronous server hooks, resolved the way `getLocale()`
 * resolves it — so server-rendered output and the client provider never
 * disagree about which locale the request is in.
 *
 * 1. The locale forwarded through `setRequestLocale(locale)` (the `[locale]`
 *    route segment), which is next-intl's source of truth for URL routing.
 * 2. Otherwise Intlayer's ambient locale (server context, then the request).
 *
 * The second rung must stay lazy. It ends in `headers()` / `cookies()`, which
 * opts the route into dynamic rendering: evaluating it eagerly took this
 * package's own benchmark app from 14 prerendered pages to 0.
 */
export const resolveServerLocale = (): LocalesValues => {
  const requestLocale = getCachedRequestLocale();
  if (requestLocale) return requestLocale as LocalesValues;

  return readAmbientLocale().locale as LocalesValues;
};
