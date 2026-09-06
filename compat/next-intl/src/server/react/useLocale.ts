import type { useLocale as _useLocale } from 'next-intl';
import { resolveServerLocale } from './resolveLocale';

/**
 * Server counterpart of `useLocale`, resolved from the `[locale]` route segment
 * forwarded through `setRequestLocale` when the app provides one.
 */
export const useLocale: typeof _useLocale = () =>
  resolveServerLocale() as ReturnType<typeof _useLocale>;
