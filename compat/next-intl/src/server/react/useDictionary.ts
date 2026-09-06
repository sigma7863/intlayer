import type { Dictionary } from '@intlayer/types/dictionary';
import type { DictionaryKeys } from '@intlayer/types/module_augmentation';
import {
  createDictionaryTranslator,
  type ScopedTranslateFunction,
  type TranslateFunction,
} from '@intlayer/use-intl';
import { useDictionary as useDictionaryBase } from 'next-intlayer/server';
import { resolveServerLocale } from './resolveLocale';

/**
 * Overload set mirroring the client `useDictionary` exactly, so the optimize
 * pass can emit the same call shape whichever side of the boundary the
 * component ends up on.
 */
type UseDictionary = {
  <T extends Dictionary>(
    dictionary: T
  ): TranslateFunction<T['key'] & DictionaryKeys>;
  <T extends Dictionary, Prefix extends string>(
    dictionary: T,
    namespacePrefix: Prefix
  ): ScopedTranslateFunction<T['key'] & DictionaryKeys, Prefix>;
};

/**
 * Server counterpart of `@intlayer/use-intl`'s `useDictionary`.
 *
 * The optimize pass rewrites every `useTranslations(...)` call to this helper
 * with the dictionary pre-imported. Resolving it here — rather than in a client
 * component — keeps the dictionary out of the client bundle entirely: the
 * server renders the text and only the rendered output crosses the boundary.
 */
export const useDictionary = (<T extends Dictionary>(
  dictionary: T,
  namespacePrefix?: string
) => {
  const locale = resolveServerLocale();
  const content = useDictionaryBase(dictionary, locale as never);

  return createDictionaryTranslator(locale, content, namespacePrefix);
}) as UseDictionary;
