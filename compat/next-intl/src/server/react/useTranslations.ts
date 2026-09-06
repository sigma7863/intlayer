import { getIntlayer } from '@intlayer/core/interpreter';
import type { DictionaryKeys } from '@intlayer/types/module_augmentation';
import {
  createDictionaryTranslator,
  type LooseTranslateFunction,
  type TranslateFunction,
  type TranslateFunctionForNamespace,
} from '@intlayer/use-intl';
import { resolveServerLocale } from './resolveLocale';

type UseTranslations = {
  <N extends DictionaryKeys>(namespace: N): TranslateFunction<N>;
  <N extends `${string}.${string}`>(
    namespace: N
  ): TranslateFunctionForNamespace<N>;
  (): LooseTranslateFunction;
};

/** Splits `'about.counter'` into the dictionary key and its key prefix. */
const splitNamespace = (namespace: string): [string, string | undefined] => {
  const dotPosition = namespace.indexOf('.');
  if (dotPosition === -1) return [namespace, undefined];
  return [namespace.slice(0, dotPosition), namespace.slice(dotPosition + 1)];
};

/**
 * Server counterpart of `useTranslations`.
 *
 * next-intl's `useTranslations` is isomorphic — the same component code runs in
 * a Server or a Client Component — so the adapter has to be too. Without this
 * every component calling it is forced across the client boundary, which drags
 * its dictionary into a client chunk that Next shares across every locale.
 *
 * The optimize pass normally rewrites these calls to `useDictionary` with the
 * dictionary inlined; this runtime path covers the calls it could not resolve
 * statically (a dynamic namespace, or an unoptimized build).
 */
export const useTranslations = ((namespace?: string) => {
  const locale = resolveServerLocale();

  if (!namespace) {
    // Root scope: the first segment of each message id names the dictionary,
    // so the lookup can only happen per call.
    const rootTranslator = (key: string, values?: Record<string, unknown>) => {
      const [dictionaryKey, keyPrefix] = splitNamespace(key);
      const content = getIntlayer(dictionaryKey as never, locale as never);
      const translate = createDictionaryTranslator(locale, content, undefined);
      return translate(keyPrefix ?? '', values as never);
    };
    return rootTranslator as unknown as LooseTranslateFunction;
  }

  const [dictionaryKey, keyPrefix] = splitNamespace(namespace);
  const content = getIntlayer(dictionaryKey as never, locale as never);

  return createDictionaryTranslator(locale, content, keyPrefix);
}) as UseTranslations;
