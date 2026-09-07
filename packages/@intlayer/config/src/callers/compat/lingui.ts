import type { CallerDescriptor } from '../types';

/**
 * Lingui — `@intlayer/lingui` compat adapter.
 *
 * Lingui is a single-catalog library: the namespace lives *inside* the message
 * id rather than in the file layout, so `i18n._('footer.github')` names both
 * the group (`footer`) and the field (`github`).
 *
 * The adapter therefore addresses lingui catalogs the same way it addresses
 * next-intl's root scope — by the id's first dot-segment — which lets a
 * catalog split with `syncJSON({ splitKeys: 'key-prefix' })` bind one small
 * dictionary per call site instead of the whole catalog. A catalog that has
 * *not* been split still resolves: `rootDictionaryKey` points the fallback at
 * lingui's single `messages` dictionary, and the full id is kept intact.
 *
 * `t` and `_` are generic names, so all lingui callers require an import from
 * a lingui module to participate in matching — this avoids false positives on
 * unrelated `t()` helpers.
 *
 * Mirrors `compat/lingui/src/plugin/index.ts`.
 */
const LINGUI_IMPORT_SOURCES = [
  '@lingui/core',
  '@lingui/react',
  '@lingui/macro',
  '@lingui/core/macro',
  '@lingui/react/macro',
  '@intlayer/lingui',
];

/** Key of lingui's single catalog, used when the id segment names no dictionary. */
const LINGUI_ROOT_DICTIONARY_KEY = 'messages';

export const LINGUI_CALLERS: CallerDescriptor[] = [
  {
    callerName: 'useLingui',
    library: 'lingui',
    importSources: LINGUI_IMPORT_SOURCES,
    // `const { i18n, t, _ } = useLingui()` takes no namespace argument: the
    // dictionaries are named by the message ids passed to the returned
    // functions, so the call site binds through the root-scope path.
    namespaceSources: [],
    allowRootScope: true,
    rootDictionaryKey: LINGUI_ROOT_DICTIONARY_KEY,
    translationFunction: 'destructured-t',
    staticReplacement: 'useDictionary',
    dynamicReplacement: 'useDictionaryDynamic',
  },
  {
    callerName: '_',
    library: 'lingui',
    importSources: LINGUI_IMPORT_SOURCES,
    requiresImport: true,
    // `i18n._('id')` and the destructured `const { _ } = useLingui()` form.
    matchAsMethod: true,
    namespaceSources: [{ from: 'path-first-segment' }],
    rootDictionaryKey: LINGUI_ROOT_DICTIONARY_KEY,
    translationFunction: 'self',
  },
  {
    callerName: 't',
    library: 'lingui',
    importSources: LINGUI_IMPORT_SOURCES,
    requiresImport: true,
    // `i18n.t('id')`, `t({ id: 'id' })` and the macro tagged template ``t`…` ``.
    matchAsMethod: true,
    matchAsTaggedTemplate: true,
    namespaceSources: [{ from: 'path-first-segment' }],
    rootDictionaryKey: LINGUI_ROOT_DICTIONARY_KEY,
    translationFunction: 'self',
  },
  {
    callerName: 'Trans',
    library: 'lingui',
    importSources: LINGUI_IMPORT_SOURCES,
    requiresImport: true,
    // <Trans id="home.title" message="Welcome" />
    jsxIdAttribute: 'id',
    namespaceSources: [{ from: 'path-first-segment' }],
    rootDictionaryKey: LINGUI_ROOT_DICTIONARY_KEY,
    translationFunction: 'self',
  },
];
