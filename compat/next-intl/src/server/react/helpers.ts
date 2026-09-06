import { createFormatter } from '@intlayer/use-intl';
import { useLocale } from './useLocale';

/**
 * Server counterparts of use-intl's ambient hooks. They mirror the client
 * versions' signatures so the same component code type-checks on both sides.
 */
export const useFormatter: typeof import('@intlayer/use-intl').useFormatter =
  (() => createFormatter({ locale: useLocale() as string })) as never;

/** Current time on the server render. */
export const useNow: typeof import('@intlayer/use-intl').useNow = (() =>
  new Date()) as never;

/**
 * Time zone the formatters resolve against — the same value the async
 * `getTimeZone()` reports, so both server surfaces agree.
 */
export const useTimeZone: typeof import('@intlayer/use-intl').useTimeZone =
  (() => Intl.DateTimeFormat().resolvedOptions().timeZone) as never;
