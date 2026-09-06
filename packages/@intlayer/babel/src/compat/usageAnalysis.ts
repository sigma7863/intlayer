import type { NodePath } from '@babel/core';
import type * as BabelTypes from '@babel/types';
import type { CallerDescriptor } from '@intlayer/config/callers';
import { analyzeCallExpressionUsage } from '../analyzeContentUsage';
import { type PruneContext, recordFieldUsage } from '../pruneContext';
import {
  ABSENT_VALUE,
  firstPathSegment,
  readJsxAttributeString,
  readObjectProperty,
  readStaticFirstSegment,
  readStaticString,
  unwrapAwait,
} from '../staticAstReaders';
import {
  DEFAULT_COMPAT_NAMESPACE,
  resolveKeyPrefixForAnalysis,
  resolveNamespaceForAnalysis,
} from './namespaceResolution';

/**
 * Analyses how the translation function produced by a compat namespace caller
 * (`useTranslation`, `useTranslations`, `getTranslations`, `getFixedT`,
 * `useI18n`) is consumed, then records the accessed top-level dictionary fields
 * into `pruneContext`.
 *
 * Dictionaries consumed this way are always added to
 * `dictionariesSkippingFieldRename`: the field accesses are string-literal
 * dot-paths inside `t()` calls, which the field-rename plugin cannot rewrite,
 * so renaming the compiled JSON keys would break runtime lookups. Pruning
 * (top-level field removal) remains safe because it preserves field names.
 */
export const analyzeNamespaceCallerUsage = (
  babelTypes: typeof BabelTypes,
  pruneContext: PruneContext,
  callArguments: BabelTypes.CallExpression['arguments'],
  callerConfig: CallerDescriptor,
  isSfcFile: boolean,
  /** Absolute path of the analysed file (for untracked-binding reporting). */
  currentSourceFilePath: string,
  /**
   * The call-expression path, when the caller was matched as a call. Omitted
   * for JSX-element matches (`<FormattedMessage id>`), where only the static
   * `'self'` / `'all'` analysis paths apply — the binding-based
   * `'destructured-t'` / `'return-value'` paths require a call site.
   */
  callExpressionPath?: NodePath<BabelTypes.CallExpression>,
  /**
   * Pre-resolved namespace bypassing `namespaceSources`, e.g. the `ns`
   * attribute of react-i18next's `<Trans ns="home" i18nKey="title" />`.
   */
  namespaceOverride?: string
): void => {
  // 1. Resolve the dictionary key (namespace).
  const resolvedNamespace =
    namespaceOverride ??
    resolveNamespaceForAnalysis(
      babelTypes,
      callArguments,
      callerConfig.namespaceSources
    );

  if (resolvedNamespace === undefined) return; // dynamic key – cannot attribute

  const namespaceString =
    resolvedNamespace === ABSENT_VALUE
      ? DEFAULT_COMPAT_NAMESPACE
      : resolvedNamespace;

  // next-intl scopes nested objects through a dotted namespace
  // (`'about.counter'`): the dictionary key is the first segment and the
  // remainder is an implicit key prefix applied to every t() lookup.
  const namespaceSegments = namespaceString.split('.');
  const dictionaryKey = namespaceSegments[0] ?? namespaceString;
  const namespacePrefix =
    namespaceSegments.length > 1 ? namespaceSegments.slice(1).join('.') : null;

  // Compat string-path access is never renamable.
  pruneContext.dictionariesSkippingFieldRename.add(dictionaryKey);

  // 2. SFC files (Vue / Svelte / Astro): the translation function is typically
  //    invoked from the template, which Babel cannot see. Conservatively keep
  //    every field to avoid pruning a template-only access.
  if (isSfcFile) {
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // 3a. Mark the entire dictionary as used — static field analysis is not
  //     applicable (e.g. lingui hashed IDs, Angular templates).
  if (callerConfig.translationFunction === 'all') {
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // 3a-bis. The caller returns the dictionary content object itself
  //     (`useIntlayer`-like shape): reuse the native member-access /
  //     destructuring analysis. Without a call site, keep every field.
  if (callerConfig.translationFunction === 'content') {
    if (callExpressionPath) {
      analyzeCallExpressionUsage(
        babelTypes,
        pruneContext,
        callExpressionPath,
        dictionaryKey,
        currentSourceFilePath,
        isSfcFile
      );
    } else {
      recordFieldUsage(pruneContext, dictionaryKey, 'all');
    }
    return;
  }

  // 3b. The caller IS the translation call (`translationFunction: 'self'`).
  //     The first argument of the current call expression is the message key.
  //     Used for lingui's `i18n._('key')` / `i18n.t('key')` and react-intl's
  //     `intl.formatMessage({ id: 'key' })` patterns.
  if (callerConfig.translationFunction === 'self') {
    const firstArg = callArguments[0];
    if (!firstArg) {
      recordFieldUsage(pruneContext, dictionaryKey, 'all');
      return;
    }

    if (
      callerConfig.namespaceSources.some(
        (source) => source.from === 'path-first-segment'
      )
    ) {
      // The dictionary key is already the first segment of the descriptor id.
      // The field to record is the SECOND segment (first level inside the dict).
      // e.g. formatMessage({ id: 'home.title' }) → dictionaryKey='home', field='title'
      let fullId: string | undefined;

      const staticString = readStaticString(babelTypes, firstArg);
      if (staticString !== undefined) {
        fullId = staticString;
      } else if (babelTypes.isObjectExpression(firstArg)) {
        const idValue = readObjectProperty(babelTypes, firstArg, 'id');
        if (idValue !== undefined && idValue !== ABSENT_VALUE) {
          fullId = idValue;
        }
      }

      if (fullId !== undefined) {
        const segments = fullId.split('.');
        const field = segments[1];
        if (field !== undefined) {
          recordFieldUsage(pruneContext, dictionaryKey, new Set([field]));
        } else {
          // Single-segment id — the whole value is the dict key; no sub-field.
          recordFieldUsage(pruneContext, dictionaryKey, 'all');
        }
        return;
      }

      // Dynamic id — cannot prune.
      recordFieldUsage(pruneContext, dictionaryKey, 'all');
      return;
    }

    // For 'fixed' / 'argument' / 'option' namespaces: the field is the first
    // dot-segment of the first argument (the message key itself) — unless
    // `flatKey` is set, in which case the whole dotted key is the field.
    // String form: i18n._('home.title', values)
    const segment = callerConfig.flatKey
      ? readStaticString(babelTypes, firstArg)
      : readStaticFirstSegment(babelTypes, firstArg);
    if (segment !== undefined) {
      recordFieldUsage(pruneContext, dictionaryKey, new Set([segment]));
      return;
    }

    // Descriptor form: i18n._({ id: 'home.title', message: '...' }, values)
    if (babelTypes.isObjectExpression(firstArg)) {
      const idValue = readObjectProperty(babelTypes, firstArg, 'id');
      if (idValue !== undefined && idValue !== ABSENT_VALUE) {
        recordFieldUsage(
          pruneContext,
          dictionaryKey,
          new Set([callerConfig.flatKey ? idValue : firstPathSegment(idValue)])
        );
        return;
      }
    }

    // Dynamic key — cannot prune.
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // The remaining strategies (`'destructured-t'` / `'return-value'`) resolve
  // the `t` binding from the call site, so they require a call-expression path.
  // JSX-element matches never reach here (they use `'self'` / `'all'`); guard
  // defensively so a misconfigured JSX caller keeps every field instead of
  // throwing.
  if (!callExpressionPath) {
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // 3. Resolve an optional explicit keyPrefix (e.g. react-i18next's
  //    `{ keyPrefix }` option). A static prefix fixes the single consumed
  //    top-level field regardless of the individual t() paths.
  const explicitKeyPrefix = resolveKeyPrefixForAnalysis(
    babelTypes,
    callArguments,
    callerConfig.keyPrefixSources
  );
  if (explicitKeyPrefix === undefined) {
    // Prefix present but dynamic → unknown field set.
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // The namespace-derived prefix (next-intl) and the explicit keyPrefix option
  // (react-i18next / i18next) never coexist in practice; prefer whichever is
  // present. Either way, the consumed top-level field is the prefix's first
  // segment.
  const effectivePrefix = namespacePrefix ?? explicitKeyPrefix;
  if (effectivePrefix !== null) {
    recordFieldUsage(
      pruneContext,
      dictionaryKey,
      new Set([firstPathSegment(effectivePrefix)])
    );
    return;
  }

  // 4. Locate the `t` function binding.
  let translationBinding: ReturnType<NodePath['scope']['getBinding']> | null =
    null;

  if (callerConfig.translationFunction === 'destructured-t') {
    // const { t } = useTranslation('ns')
    const parentNode = callExpressionPath.parent;
    if (
      babelTypes.isVariableDeclarator(parentNode) &&
      babelTypes.isObjectPattern(parentNode.id)
    ) {
      for (const property of parentNode.id.properties) {
        if (
          babelTypes.isObjectProperty(property) &&
          babelTypes.isIdentifier(property.key) &&
          property.key.name === 't' &&
          babelTypes.isIdentifier(property.value)
        ) {
          translationBinding =
            callExpressionPath.scope.getBinding(property.value.name) ?? null;
        }
      }
    }
  } else {
    // const t = useTranslations('ns')  /  const t = await getTranslations('ns')
    const resultPath = unwrapAwait(babelTypes, callExpressionPath);
    const parentNode = resultPath.parent;
    if (
      babelTypes.isVariableDeclarator(parentNode) &&
      babelTypes.isIdentifier(parentNode.id)
    ) {
      translationBinding =
        callExpressionPath.scope.getBinding(parentNode.id.name) ?? null;
    }
  }

  // Could not statically locate `t` (e.g. result stored whole, re-exported) →
  // conservatively keep all fields.
  if (!translationBinding) {
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // 5. Inspect every reference to `t`.
  const accessedFields = new Set<string>();
  let hasUntrackedUsage = false;

  for (const referencePath of translationBinding.referencePaths) {
    const parentNode = referencePath.parent;

    // Must be a direct call: t('path')
    const isDirectCall =
      (babelTypes.isCallExpression(parentNode) ||
        babelTypes.isOptionalCallExpression(parentNode)) &&
      (parentNode as BabelTypes.CallExpression).callee === referencePath.node;

    if (!isDirectCall) {
      // t passed as a prop / argument / reassigned → fields unknown.
      hasUntrackedUsage = true;
      break;
    }

    const firstArgument = (parentNode as BabelTypes.CallExpression)
      .arguments[0];
    const segment = readStaticFirstSegment(babelTypes, firstArgument);
    if (segment === undefined) {
      hasUntrackedUsage = true;
      break;
    }
    accessedFields.add(segment);
  }

  if (hasUntrackedUsage) {
    recordFieldUsage(pruneContext, dictionaryKey, 'all');
    return;
  }

  // Only record a finite field set when at least one field was actually
  // accessed. Recording an empty set would prune every field even though the
  // dictionary may be consumed elsewhere.
  if (accessedFields.size > 0) {
    recordFieldUsage(pruneContext, dictionaryKey, accessedFields);
  }
};

/**
 * Compat half of the usage analyser, kept behind one object so the native
 * plugin body contains no adapter-specific branching.
 *
 * The analyser is created only when compat callers were injected, so a plain
 * intlayer build never allocates it and never pays for its lookups —
 * {@link createCompatUsageAnalyzer} returns `null` for an empty registry.
 */
export type CompatUsageAnalyzer = {
  /**
   * Records the local aliases one import declaration introduces. Called for
   * every import of the file, before any call site is inspected.
   */
  noteImport: (
    importSource: string,
    importedName: string,
    localName: string
  ) => void;
  /**
   * Whether any compat caller can match in this file — either an imported
   * alias was recorded, or a method-matched caller is active. Checked after
   * every import was noted, so the plugin can skip the call traversal.
   */
  hasMatchableCallers: () => boolean;
  /**
   * Analyses one call site. Returns `true` when the call belonged to a compat
   * caller and was handled, `false` when the native path should look at it.
   */
  analyzeCall: (
    callExpressionPath: NodePath<BabelTypes.CallExpression>,
    localCallerName: string,
    isMethodCall: boolean
  ) => boolean;
  /** Analyses one JSX element, e.g. `<Trans i18nKey="…" />`. */
  analyzeJsxElement: (
    jsxOpeningElementPath: NodePath<BabelTypes.JSXOpeningElement>
  ) => void;
};

/**
 * Builds the compat analyser for one source file, or `null` when no compat
 * caller was injected — the base intlayer pipeline then runs untouched.
 *
 * @param babelTypes - Babel's type helpers.
 * @param pruneContext - Shared analysis state to write into.
 * @param compatCallers - Descriptors injected by the compat packages' plugins.
 * @param fileContext - Path of the analysed file and whether it is an SFC.
 */
export const createCompatUsageAnalyzer = (
  babelTypes: typeof BabelTypes,
  pruneContext: PruneContext,
  compatCallers: readonly CallerDescriptor[],
  fileContext: { sourceFilePath: string; isSfcFile: boolean }
): CompatUsageAnalyzer | null => {
  if (compatCallers.length === 0) return null;

  const { sourceFilePath, isSfcFile } = fileContext;

  /** Local alias → the descriptor it was imported as. */
  const callersByLocalName = new Map<string, CallerDescriptor>();
  /** Module specifiers imported by the file, gating `requiresImport` callers. */
  const fileImportSources = new Set<string>();

  const analyze = (
    callArguments: BabelTypes.CallExpression['arguments'],
    descriptor: CallerDescriptor,
    callExpressionPath?: NodePath<BabelTypes.CallExpression>,
    namespaceOverride?: string
  ) =>
    analyzeNamespaceCallerUsage(
      babelTypes,
      pruneContext,
      callArguments,
      descriptor,
      isSfcFile,
      sourceFilePath,
      callExpressionPath,
      namespaceOverride
    );

  /**
   * Method-matched callers (`i18n.getFixedT(…)`, `intl.formatMessage(…)`) are
   * recognised by method name on any object, so they are resolved lazily once
   * every import has been seen.
   */
  let methodCallers: CallerDescriptor[] | undefined;
  const getMethodCallers = (): CallerDescriptor[] => {
    methodCallers ??= compatCallers.filter(
      (descriptor) =>
        descriptor.matchAsMethod &&
        (!descriptor.requiresImport ||
          descriptor.importSources.some((source) =>
            fileImportSources.has(source)
          ))
    );
    return methodCallers;
  };

  return {
    noteImport: (importSource, importedName, localName) => {
      fileImportSources.add(importSource);

      const descriptor = compatCallers.find(
        (caller) =>
          caller.callerName === importedName &&
          caller.importSources.includes(importSource)
      );
      if (descriptor) callersByLocalName.set(localName, descriptor);
    },

    hasMatchableCallers: () =>
      callersByLocalName.size > 0 || getMethodCallers().length > 0,

    analyzeCall: (callExpressionPath, localCallerName, isMethodCall) => {
      const importedDescriptor = callersByLocalName.get(localCallerName);

      if (importedDescriptor && !isMethodCall) {
        analyze(
          callExpressionPath.node.arguments,
          importedDescriptor,
          callExpressionPath
        );
        return true;
      }

      if (!isMethodCall) return false;

      const methodDescriptor = getMethodCallers().find(
        (descriptor) => descriptor.callerName === localCallerName
      );
      if (!methodDescriptor) return false;

      analyze(
        callExpressionPath.node.arguments,
        methodDescriptor,
        callExpressionPath
      );
      return true;
    },

    analyzeJsxElement: (jsxOpeningElementPath) => {
      const nameNode = jsxOpeningElementPath.node.name;
      if (!babelTypes.isJSXIdentifier(nameNode)) return;

      const descriptor = callersByLocalName.get(nameNode.name);
      if (!descriptor?.jsxIdAttribute) return;

      // Read the configured id attribute as a static string. A missing or
      // dynamic id yields an empty argument list, which resolves the namespace
      // to undefined and is skipped (consistent with how a dynamic
      // `useIntlayer(key)` call is handled).
      const idNode = readJsxAttributeString(
        babelTypes,
        jsxOpeningElementPath.node,
        descriptor.jsxIdAttribute
      );

      // Optional dedicated namespace attribute, e.g. react-i18next's
      // `<Trans ns="home" i18nKey="title" />`. When configured but
      // absent/dynamic, the dictionary cannot be attributed → skip.
      let namespaceOverride: string | undefined;
      if (descriptor.jsxNamespaceAttribute) {
        const namespaceNode = readJsxAttributeString(
          babelTypes,
          jsxOpeningElementPath.node,
          descriptor.jsxNamespaceAttribute
        );
        if (!namespaceNode) return;
        namespaceOverride = namespaceNode.value;
      }

      analyze(idNode ? [idNode] : [], descriptor, undefined, namespaceOverride);
    },
  };
};
