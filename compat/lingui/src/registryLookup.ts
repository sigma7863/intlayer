import { getIntlayer } from '@intlayer/core/interpreter';
import { getDictionaries } from '@intlayer/dictionaries-entry';
import type {
  DictionaryKeys,
  LocalesValues,
} from '@intlayer/types/module_augmentation';
import type { Messages } from '@lingui/core';
import {
  linguiMessageToIcu,
  navigateLinguiCatalog,
  unwrapLinguiCatalog,
} from './linguiCatalog';

/**
 * Registry-backed message resolution — the fallback used when a call site was
 * **not** rewritten by the build-time optimize pass.
 *
 * This module is deliberately the *only* one that touches
 * `@intlayer/dictionaries-entry`, which statically imports every dictionary in
 * the project. `I18nClass` must not import it: an optimized call site
 * (`useDictionary(fooDictionary)`) already carries its content, and a static
 * edge to the registry would pull every other dictionary into that chunk,
 * re-leaking the whole catalog into every page.
 *
 * The unoptimized entry points (`useLingui`, `setupI18n`) inject
 * {@link createRegistryResolver} instead, so the registry stays reachable only
 * from the paths that genuinely need it.
 */

/**
 * Keys of every intlayer dictionary available at runtime (the namespaces).
 *
 * Outside a bundle (e.g. unit tests) `@intlayer/dictionaries-entry` resolves to
 * an empty map, in which case resolution falls back to the runtime catalogs
 * loaded via `load()`.
 */
const getDictionaryKeys = (): DictionaryKeys[] => {
  try {
    return Object.keys(getDictionaries()) as DictionaryKeys[];
  } catch {
    return [];
  }
};

/**
 * Looks up a lingui message across every intlayer dictionary.
 *
 * lingui ids are flat, namespace-less keys (`'hero.title'`), but the matching
 * content may live in any dictionary — a single centralized catalog, or one of
 * the per-prefix catalogs produced by
 * `syncJSON({ splitKeys: 'key-prefix' })`. Each dictionary is searched in
 * turn, supporting both the flat/nested key shapes and the lingui
 * `{ messages: {…} }` wrapper. The first match wins.
 */
const lookupDictionaryMessage = (
  id: string,
  locale: LocalesValues
): string | undefined => {
  for (const key of getDictionaryKeys()) {
    let dictionary: unknown;
    try {
      dictionary = getIntlayer(key, locale);
    } catch {
      continue;
    }
    const value = navigateLinguiCatalog(dictionary, id);
    if (value !== undefined) return linguiMessageToIcu(value);
  }
  return undefined;
};

/**
 * Merges every intlayer dictionary for `locale` into one flat lingui catalog,
 * unwrapping the `{ messages: {…} }` wrapper. Backs `I18nClass#messages`.
 */
const collectRegistryMessages = (locale: LocalesValues): Messages => {
  const merged: Messages = {};

  for (const key of getDictionaryKeys()) {
    try {
      Object.assign(merged, unwrapLinguiCatalog(getIntlayer(key, locale)));
    } catch {
      // Skip dictionaries that fail to resolve for this locale.
    }
  }

  return merged;
};

/**
 * How `I18nClass` reaches the runtime dictionary registry. Passed to the
 * constructor by the unoptimized entry points only.
 */
export type RegistryResolver = {
  /** Resolves one message id, or `undefined` when no dictionary holds it. */
  lookup: (id: string, locale: LocalesValues) => string | undefined;
  /** Every message available for a locale, flattened. */
  all: (locale: LocalesValues) => Messages;
};

/** The registry-backed resolver. Importing this pulls in every dictionary. */
export const createRegistryResolver = (): RegistryResolver => ({
  lookup: lookupDictionaryMessage,
  all: collectRegistryMessages,
});
