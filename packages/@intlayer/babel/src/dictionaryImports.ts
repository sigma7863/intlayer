import type * as BabelTypes from '@babel/types';
import { getPathHash } from '@intlayer/engine/utils';

/**
 * How a dictionary reaches a call site.
 *
 * - `static`  — the compiled JSON is imported directly.
 * - `dynamic` — a generated per-locale loader is imported and resolved at
 *               runtime (Suspense).
 * - `fetch`   — same as `dynamic`, but the loader fetches remote content.
 */
export type ImportMode = 'static' | 'dynamic' | 'fetch';

/** Identifier suffix that also tells the injection step which directory to read. */
const IDENT_SUFFIX: Record<ImportMode, string> = {
  static: '',
  dynamic: '_dyn',
  fetch: '_fetch',
};

/**
 * Builds the generated identifier for a dictionary key.
 *
 * Replicates the xxHash64 → Base-62 algorithm used by the SWC version and
 * prefixes an underscore so the generated identifiers never collide with
 * user-defined ones.
 */
export const makeDictionaryIdent = (
  babelTypes: typeof BabelTypes,
  key: string,
  mode: ImportMode
): BabelTypes.Identifier =>
  babelTypes.identifier(`_${getPathHash(key)}${IDENT_SUFFIX[mode]}`);

/**
 * The dictionary imports one file needs, accumulated while its call sites are
 * rewritten and injected in one pass at the end.
 *
 * Both the native and the compat rewrites write here, so a dictionary read
 * through `useIntlayer('about')` and through `useTranslation('about')` in the
 * same file shares a single import.
 *
 * `dynamic` and `fetch` share one map because they occupy the same import
 * slot, distinguished only by their identifier suffix — mirroring
 * `InjectedImports` in the SWC plugin.
 */
export type DictionaryImportRegistry = {
  /** Dictionary key → identifier of the static JSON (or nested companion) import. */
  readonly staticImports: Map<string, BabelTypes.Identifier>;
  /** Dictionary key → identifier of the dynamic / fetch loader import. */
  readonly dynamicImports: Map<string, BabelTypes.Identifier>;
  /**
   * Returns the identifier for `key` in `mode`, creating and registering it on
   * first use.
   */
  identFor: (key: string, mode: ImportMode) => BabelTypes.Identifier;
};

/** Creates an empty registry for one source file. */
export const createDictionaryImportRegistry = (
  babelTypes: typeof BabelTypes
): DictionaryImportRegistry => {
  const staticImports = new Map<string, BabelTypes.Identifier>();
  const dynamicImports = new Map<string, BabelTypes.Identifier>();

  return {
    staticImports,
    dynamicImports,
    identFor: (key, mode) => {
      const map = mode === 'static' ? staticImports : dynamicImports;

      const existing = map.get(key);
      if (existing) return existing;

      const ident = makeDictionaryIdent(babelTypes, key, mode);
      map.set(key, ident);
      return ident;
    },
  };
};
