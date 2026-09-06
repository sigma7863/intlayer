import type { Dictionary } from '@intlayer/types/dictionary';
import type { DictionaryKeys } from '@intlayer/types/module_augmentation';
import {
  createDictionaryTranslator,
  type ScopedTranslateFunction,
  type TranslateFunction,
} from '@intlayer/use-intl';
import { useDictionaryDynamic as useDictionaryDynamicBase } from 'next-intlayer/server';
import { resolveServerLocale } from './resolveLocale';

type UseDictionaryDynamic = {
  <T extends Dictionary, K extends DictionaryKeys>(
    dictionaryPromise: Record<string, () => Promise<T>>,
    key: K
  ): TranslateFunction<K>;
  <T extends Dictionary, K extends DictionaryKeys, Prefix extends string>(
    dictionaryPromise: Record<string, () => Promise<T>>,
    key: K,
    namespacePrefix: Prefix
  ): ScopedTranslateFunction<K, Prefix>;
};

/**
 * Server counterpart of `useDictionaryDynamic`, emitted by the optimize pass
 * for dictionaries on the per-locale loader.
 */
export const useDictionaryDynamic = ((
  dictionaryPromise: Record<string, () => Promise<Dictionary>>,
  key: string,
  namespacePrefix?: string
) => {
  const locale = resolveServerLocale();
  const content = useDictionaryDynamicBase(
    dictionaryPromise as never,
    key as never,
    locale as never
  );

  return createDictionaryTranslator(locale, content, namespacePrefix);
}) as UseDictionaryDynamic;
