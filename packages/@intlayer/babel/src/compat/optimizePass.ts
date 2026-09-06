import type { NodePath } from '@babel/core';
import type * as BabelTypes from '@babel/types';
import {
  type CallerDescriptor,
  getRewritableCallers,
} from '@intlayer/config/callers';
import type {
  DictionaryImportRegistry,
  ImportMode,
} from '../dictionaryImports';
import {
  findObjectProperty,
  readStaticFirstSegment,
  readStaticString,
  splitNamespace,
} from '../staticAstReaders';
import { resolveNamespaceForRewrite } from './namespaceResolution';

/**
 * Compat half of the optimize pass.
 *
 * Every adapter-specific behaviour of the build-time rewrite lives here:
 * matching a compat caller's import, resolving its namespace, binding a
 * namespace-less root scope to the dictionaries its message ids name, and
 * re-pointing the import specifier at the dictionary-accepting helper.
 *
 * The pass is created only when compat descriptors were injected by a compat
 * package's bundler plugin, so a plain intlayer build never allocates it and
 * never runs any of its traversals — {@link createCompatOptimizePass} returns
 * `null` for an empty registry.
 */
export type CompatOptimizePass = {
  /**
   * Whether `importSource` exports at least one rewritable compat caller, so
   * the optimize plugin knows the import is worth inspecting even though it is
   * not a native intlayer package.
   */
  ownsImportSource: (importSource: string) => boolean;
  /** Records the local alias one import specifier introduces. */
  noteImport: (
    importSource: string,
    importedName: string,
    localName: string
  ) => void;
  /**
   * Resolves root-scope bindings and decides the file-level helper family.
   * Must run after every import was noted and before any rewrite.
   */
  analyze: (programPath: NodePath<BabelTypes.Program>) => void;
  /**
   * Applies the root-scope rewrites and returns the call nodes it consumed, so
   * the plugin's call visitor skips them.
   */
  applyRootScopeRewrites: () => Set<BabelTypes.Node>;
  /**
   * Rewrites one compat call site. Returns `true` when the call belonged to a
   * compat caller, whether or not it could be rewritten.
   */
  rewriteCall: (callPath: NodePath<BabelTypes.CallExpression>) => boolean;
  /** Re-points the compat specifiers of one import declaration. */
  rewriteImportSpecifiers: (
    importPath: NodePath<BabelTypes.ImportDeclaration>
  ) => void;
};

/**
 * Method names on a root-scope binding that address a message rather than the
 * i18n instance itself — `i18n._('home.title')`, `intl.formatMessage(…)`.
 */
const MESSAGE_METHOD_NAMES = new Set(['formatMessage', '_', 't']);

/** One `t('namespace.key')` call reached through a root-scope binding. */
type RootScopeCallSite = {
  callPath: NodePath<BabelTypes.CallExpression>;
  dictionaryKey: string;
  /** The message id with its leading `dictionaryKey.` segment removed. */
  remainderKey: string;
  isMethodCall: boolean;
  /** The `id` property, for the `formatMessage({ id })` descriptor form. */
  objectProperty?: BabelTypes.ObjectProperty;
  argNode: BabelTypes.Node;
};

/**
 * A `const t = useTranslations()` declarator whose dictionaries are named by
 * the message ids passed to `t`, not by a namespace argument.
 */
type RootScopeCandidate = {
  declPath: NodePath<BabelTypes.VariableDeclarator>;
  callerLocal: string;
  descriptor: CallerDescriptor;
  /** Set when the binding is a plain identifier: `const t = …`. */
  identName?: string;
  /** Set when the binding destructures: `const { t } = …` (property → local). */
  destructuredProps?: Map<string, string>;
  /** Local names bound by this declarator, and how each is invoked. */
  translateLocalNames: Map<string, { propName?: string; isMethod: boolean }>;
  /** Dictionary keys reached through the binding, in first-use order. */
  namespaces: string[];
  callSites: RootScopeCallSite[];
  /** A message id was dynamic or dot-less, so the binding cannot be bound. */
  isPoisoned: boolean;
};

/**
 * Builds the compat optimize pass for one source file, or `null` when no
 * compat caller was injected.
 *
 * @param babelTypes - Babel's type helpers.
 * @param compatCallers - Descriptors injected by the compat packages' plugins.
 * @param imports - Shared dictionary-import registry for the file.
 * @param buildModes - The file's global import mode and per-dictionary overrides.
 */
export const createCompatOptimizePass = (
  babelTypes: typeof BabelTypes,
  compatCallers: readonly CallerDescriptor[],
  imports: DictionaryImportRegistry,
  buildModes: {
    importMode: ImportMode | undefined;
    dictionaryModeMap?: Record<string, ImportMode | undefined>;
  }
): CompatOptimizePass | null => {
  const rewritableCallers = getRewritableCallers([...compatCallers]);
  if (rewritableCallers.length === 0) return null;

  const { importMode, dictionaryModeMap } = buildModes;

  /** Local alias → the descriptor it was imported as. */
  const callersByLocalName = new Map<string, CallerDescriptor>();
  /**
   * Locals with at least one unresolvable call site: re-pointing the shared
   * import while leaving those calls untouched would hand a raw namespace
   * string to the dictionary-accepting helper.
   */
  const unresolvableLocalNames = new Set<string>();

  const candidatesByDecl = new Map<
    BabelTypes.VariableDeclarator,
    RootScopeCandidate
  >();
  const bareCallsPerCaller = new Map<string, number>();
  let activeCandidates: RootScopeCandidate[] = [];

  /**
   * File-level decision: one import specifier serves every call in the file, so
   * a global dynamic/fetch mode — or any per-dictionary override reached from
   * this file — flips all rewritten compat calls to the dynamic helper.
   */
  let useDynamicHelpers = false;

  const isDynamicMode = (mode: ImportMode | undefined): boolean =>
    mode === 'dynamic' || mode === 'fetch';

  /** Import mode a compat call site resolves to for `dictionaryKey`. */
  const importModeFor = (dictionaryKey: string): ImportMode => {
    if (!useDynamicHelpers) return 'static';

    const override = dictionaryModeMap?.[dictionaryKey];
    if (isDynamicMode(override)) return override!;

    return isDynamicMode(importMode) ? importMode! : 'dynamic';
  };

  /**
   * Reads the dictionary key and remaining path of a message id, handling both
   * the string form `t('home.title')` and the descriptor form
   * `formatMessage({ id: 'home.title' })`.
   */
  const readMessageId = (
    argNode: BabelTypes.Node | undefined
  ): {
    dictionaryKey?: string;
    remainderKey: string;
    objectProperty?: BabelTypes.ObjectProperty;
  } => {
    if (!argNode) return { remainderKey: '' };

    const idNode = babelTypes.isObjectExpression(argNode)
      ? findObjectProperty(babelTypes, argNode, 'id')
      : undefined;

    if (babelTypes.isObjectExpression(argNode) && !idNode) {
      return { remainderKey: '' };
    }

    const valueNode = idNode ? idNode.value : argNode;
    const dictionaryKey = readStaticFirstSegment(babelTypes, valueNode);
    const staticId = readStaticString(babelTypes, valueNode);

    return {
      dictionaryKey,
      remainderKey: staticId ? splitNamespace(staticId).keyPrefix : '',
      objectProperty: idNode,
    };
  };

  /**
   * Records `const t = useTranslations()` / `const { t } = useTranslation()` as
   * a root-scope candidate. A call whose namespace the normal resolver can read
   * is handled by the scoped path instead.
   */
  const noteRootScopeCandidate = (
    declPath: NodePath<BabelTypes.VariableDeclarator>
  ): void => {
    const init = declPath.node.init;
    if (!babelTypes.isCallExpression(init)) return;
    if (!babelTypes.isIdentifier(init.callee)) return;

    const callerLocal = init.callee.name;
    const descriptor = callersByLocalName.get(callerLocal);
    if (!descriptor?.allowRootScope) return;

    if (resolveNamespaceForRewrite(babelTypes, init.arguments, descriptor)) {
      return;
    }
    if (init.arguments.length !== 0) return;

    const id = declPath.node.id;
    const translateLocalNames = new Map<
      string,
      { propName?: string; isMethod: boolean }
    >();
    let identName: string | undefined;
    let destructuredProps: Map<string, string> | undefined;

    if (babelTypes.isIdentifier(id)) {
      identName = id.name;
      translateLocalNames.set(id.name, { isMethod: false });
    } else if (babelTypes.isObjectPattern(id)) {
      destructuredProps = new Map<string, string>();
      for (const prop of id.properties) {
        if (!babelTypes.isObjectProperty(prop)) continue;

        const propName = babelTypes.isIdentifier(prop.key)
          ? prop.key.name
          : babelTypes.isStringLiteral(prop.key)
            ? prop.key.value
            : undefined;
        if (!propName || !babelTypes.isIdentifier(prop.value)) continue;

        destructuredProps.set(propName, prop.value.name);
        translateLocalNames.set(prop.value.name, {
          propName,
          // `i18n` is the instance, reached as `i18n._(…)` / `i18n.t(…)`.
          isMethod: propName === 'i18n',
        });
      }
    }

    if (translateLocalNames.size === 0) return;

    candidatesByDecl.set(declPath.node, {
      declPath,
      callerLocal,
      descriptor,
      identName,
      destructuredProps,
      translateLocalNames,
      namespaces: [],
      callSites: [],
      isPoisoned: false,
    });
  };

  /**
   * Attributes a `t(…)` call to its root-scope candidate. Returns `true` when
   * the call was consumed by a candidate.
   */
  const noteRootScopeUsage = (
    callPath: NodePath<BabelTypes.CallExpression>,
    translateLocalName: string,
    isMethodCall: boolean,
    methodName: string | undefined
  ): boolean => {
    const binding = callPath.scope.getBinding(translateLocalName);
    if (!binding || !babelTypes.isVariableDeclarator(binding.path.node)) {
      return false;
    }

    const candidate = candidatesByDecl.get(binding.path.node);
    if (!candidate) return false;

    const localInfo = candidate.translateLocalNames.get(translateLocalName);
    if (!localInfo) return false;

    const addressesMessage = isMethodCall
      ? MESSAGE_METHOD_NAMES.has(methodName ?? '')
      : !localInfo.isMethod;
    if (!addressesMessage) return false;

    const argNode = callPath.node.arguments[0];
    const { dictionaryKey, remainderKey, objectProperty } =
      readMessageId(argNode);

    if (!dictionaryKey) {
      candidate.isPoisoned = true;
      return true;
    }

    if (!candidate.namespaces.includes(dictionaryKey)) {
      candidate.namespaces.push(dictionaryKey);
    }
    candidate.callSites.push({
      callPath,
      dictionaryKey,
      remainderKey,
      isMethodCall,
      objectProperty,
      argNode: argNode as BabelTypes.Node,
    });
    return true;
  };

  /** Rewrites a message id in place, dropping its `dictionaryKey.` prefix. */
  const stripDictionaryPrefix = (site: RootScopeCallSite): void => {
    if (site.objectProperty) {
      site.objectProperty.value = babelTypes.stringLiteral(site.remainderKey);
      return;
    }

    if (babelTypes.isStringLiteral(site.argNode)) {
      site.argNode.value = site.remainderKey;
      return;
    }

    if (
      babelTypes.isTemplateLiteral(site.argNode) &&
      site.argNode.quasis.length > 0
    ) {
      const firstQuasi = site.argNode.quasis[0];
      if (!firstQuasi) return;

      const dot = firstQuasi.value.raw.indexOf('.');
      if (dot === -1) return;

      firstQuasi.value.raw = firstQuasi.value.raw.slice(dot + 1);
      if (firstQuasi.value.cooked) {
        firstQuasi.value.cooked = firstQuasi.value.cooked.slice(dot + 1);
      }
    }
  };

  /** Argument list binding a root-scope call to `dictionaryKey`. */
  const rootScopeCallArgs = (
    dictionaryKey: string
  ): BabelTypes.Expression[] => {
    const mode = importModeFor(dictionaryKey);
    const ident = imports.identFor(dictionaryKey, mode);

    return mode === 'static'
      ? [babelTypes.identifier(ident.name)]
      : [
          babelTypes.identifier(ident.name),
          babelTypes.stringLiteral(dictionaryKey),
        ];
  };

  return {
    ownsImportSource: (importSource) =>
      rewritableCallers.some((descriptor) =>
        descriptor.importSources.includes(importSource)
      ),

    noteImport: (importSource, importedName, localName) => {
      const descriptor = rewritableCallers.find(
        (caller) =>
          caller.callerName === importedName &&
          caller.importSources.includes(importSource)
      );
      if (descriptor) callersByLocalName.set(localName, descriptor);
    },

    analyze: (programPath) => {
      if (callersByLocalName.size === 0) return;

      // Pass 1 — collect the namespace-less declarators that may bind a root
      // scope. Their dictionaries are only known once their call sites are in.
      programPath.traverse({
        VariableDeclarator: noteRootScopeCandidate,
      });

      // Pass 2 — attribute every call site, and note whether any resolved
      // dictionary is overridden to a per-locale loader.
      let hasDynamicCall = false;

      programPath.traverse({
        CallExpression: (callPath) => {
          const callee = callPath.node.callee;

          if (babelTypes.isIdentifier(callee)) {
            const descriptor = callersByLocalName.get(callee.name);

            if (descriptor) {
              const namespaceMatch = resolveNamespaceForRewrite(
                babelTypes,
                callPath.node.arguments,
                descriptor
              );

              if (namespaceMatch) {
                const { dictionaryKey } = splitNamespace(
                  namespaceMatch.fullNamespace
                );
                if (isDynamicMode(dictionaryModeMap?.[dictionaryKey])) {
                  hasDynamicCall = true;
                }
                return;
              }

              if (
                descriptor.allowRootScope &&
                callPath.node.arguments.length === 0
              ) {
                bareCallsPerCaller.set(
                  callee.name,
                  (bareCallsPerCaller.get(callee.name) ?? 0) + 1
                );
                return;
              }

              unresolvableLocalNames.add(callee.name);
              return;
            }
          }

          if (babelTypes.isIdentifier(callee)) {
            noteRootScopeUsage(callPath, callee.name, false, undefined);
            return;
          }

          if (
            babelTypes.isMemberExpression(callee) &&
            babelTypes.isIdentifier(callee.object) &&
            babelTypes.isIdentifier(callee.property)
          ) {
            noteRootScopeUsage(
              callPath,
              callee.object.name,
              true,
              callee.property.name
            );
          }
        },
      });

      const resolvedCandidates = [...candidatesByDecl.values()].filter(
        (candidate) => !candidate.isPoisoned && candidate.namespaces.length > 0
      );

      // A caller local is only safe to rewrite when *every* one of its
      // namespace-less call sites became a resolvable binding — otherwise the
      // shared import would be re-pointed while some call still passes nothing.
      for (const [callerLocal, bareCount] of bareCallsPerCaller) {
        const resolvedCount = resolvedCandidates.filter(
          (candidate) => candidate.callerLocal === callerLocal
        ).length;
        if (resolvedCount !== bareCount) {
          unresolvableLocalNames.add(callerLocal);
        }
      }

      activeCandidates = resolvedCandidates.filter(
        (candidate) => !unresolvableLocalNames.has(candidate.callerLocal)
      );

      for (const candidate of activeCandidates) {
        for (const namespace of candidate.namespaces) {
          if (isDynamicMode(dictionaryModeMap?.[namespace])) {
            hasDynamicCall = true;
          }
        }
      }

      for (const localName of unresolvableLocalNames) {
        callersByLocalName.delete(localName);
      }

      useDynamicHelpers = isDynamicMode(importMode) || hasDynamicCall;
    },

    applyRootScopeRewrites: () => {
      const handledCalls = new Set<BabelTypes.Node>();

      for (const candidate of activeCandidates) {
        const [firstNamespace, ...restNamespaces] = candidate.namespaces;
        if (!firstNamespace) continue;

        const initCall = candidate.declPath.node
          .init as BabelTypes.CallExpression;
        initCall.arguments = rootScopeCallArgs(firstNamespace);
        handledCalls.add(initCall);

        // Every dictionary beyond the first gets a sibling declarator holding
        // its own binding, so `t('a.x')` and `t('b.y')` each read their own.
        const siblingAliases = new Map<string, BabelTypes.Identifier>();

        if (restNamespaces.length > 0) {
          const siblingDecls: BabelTypes.VariableDeclarator[] = [];

          for (const namespace of restNamespaces) {
            const aliasIdent = candidate.declPath.scope.generateUidIdentifier(
              `_${namespace}`
            );
            siblingAliases.set(namespace, aliasIdent);

            const siblingId: BabelTypes.LVal = candidate.destructuredProps
              ? babelTypes.objectPattern(
                  [...candidate.destructuredProps.keys()].map((propName) =>
                    babelTypes.objectProperty(
                      babelTypes.identifier(propName),
                      aliasIdent
                    )
                  )
                )
              : aliasIdent;

            const siblingInit = babelTypes.callExpression(
              babelTypes.identifier(candidate.callerLocal),
              rootScopeCallArgs(namespace)
            );
            handledCalls.add(siblingInit);
            siblingDecls.push(
              babelTypes.variableDeclarator(siblingId, siblingInit)
            );
          }

          if (candidate.declPath.parentPath.isVariableDeclaration()) {
            const parent = candidate.declPath.parentPath.node;
            const index = parent.declarations.indexOf(candidate.declPath.node);
            if (index === -1) {
              parent.declarations.push(...siblingDecls);
            } else {
              parent.declarations.splice(index + 1, 0, ...siblingDecls);
            }
          }
        }

        for (const site of candidate.callSites) {
          handledCalls.add(site.callPath.node);

          if (site.dictionaryKey !== firstNamespace) {
            const aliasIdent = siblingAliases.get(site.dictionaryKey);
            if (aliasIdent) {
              if (site.isMethodCall) {
                (
                  site.callPath.node.callee as BabelTypes.MemberExpression
                ).object = aliasIdent;
              } else {
                site.callPath.node.callee = aliasIdent;
              }
            }
          }

          stripDictionaryPrefix(site);
        }
      }

      return handledCalls;
    },

    rewriteCall: (callPath) => {
      const callee = callPath.node.callee;
      if (!babelTypes.isIdentifier(callee)) return false;

      const descriptor = callersByLocalName.get(callee.name);
      if (!descriptor) return false;

      const callArguments = callPath.node.arguments;
      const namespaceMatch = resolveNamespaceForRewrite(
        babelTypes,
        callArguments,
        descriptor
      );
      // Filtered out by `analyze` — the import keeps its original specifier.
      if (!namespaceMatch) return true;

      const { dictionaryKey, keyPrefix } = splitNamespace(
        namespaceMatch.fullNamespace
      );
      const mode = importModeFor(dictionaryKey);
      const ident = imports.identFor(dictionaryKey, mode);
      const isDynamicHelper = mode !== 'static';

      if (namespaceMatch.argumentIndex !== undefined) {
        // Positional namespace: replace the string with the dictionary, then
        // the (dynamic) key and the (nested) prefix.
        //   useTranslation('about.counter', opts)
        //     static  → useDictionary(_hash, 'counter', opts)
        //     dynamic → useDictionaryDynamic(_hash_dyn, 'about', 'counter', opts)
        callArguments[namespaceMatch.argumentIndex] = babelTypes.identifier(
          ident.name
        );

        const insertedArguments: BabelTypes.Expression[] = [];
        if (isDynamicHelper) {
          insertedArguments.push(babelTypes.stringLiteral(dictionaryKey));
        }
        if (keyPrefix) {
          insertedArguments.push(babelTypes.stringLiteral(keyPrefix));
        }
        callArguments.splice(
          namespaceMatch.argumentIndex + 1,
          0,
          ...insertedArguments
        );
      } else if (isDynamicHelper) {
        // Fixed / option namespace: prepend the loader and the dictionary key.
        callArguments.unshift(
          babelTypes.identifier(ident.name),
          babelTypes.stringLiteral(dictionaryKey)
        );
      } else {
        // Fixed / option namespace, static helper: prepend the dictionary.
        //   useLingui() → useDictionary(_hash)
        callArguments.unshift(babelTypes.identifier(ident.name));
      }

      // Option namespace: leave only the key-prefix remainder in the options
      // object (or drop the property entirely), so the runtime helper does not
      // re-apply the dictionary key as a lookup prefix.
      //   useI18n({ namespace: 'about' }) → useDictionary(_hash, {})
      if (namespaceMatch.optionProperty && namespaceMatch.optionsObject) {
        if (keyPrefix) {
          namespaceMatch.optionProperty.value =
            babelTypes.stringLiteral(keyPrefix);
        } else {
          namespaceMatch.optionsObject.properties =
            namespaceMatch.optionsObject.properties.filter(
              (property) => property !== namespaceMatch.optionProperty
            );
        }
      }

      return true;
    },

    rewriteImportSpecifiers: (importPath) => {
      const importSource = importPath.node.source.value;

      for (const specifier of importPath.node.specifiers) {
        if (!babelTypes.isImportSpecifier(specifier)) continue;

        const descriptor = callersByLocalName.get(specifier.local.name);
        if (!descriptor) continue;
        if (!descriptor.importSources.includes(importSource)) continue;

        // Keep the local alias so call sites read unchanged; only the imported
        // name moves to the dictionary-accepting helper.
        specifier.imported = babelTypes.identifier(
          useDynamicHelpers
            ? descriptor.dynamicReplacement!
            : descriptor.staticReplacement!
        );
      }
    },
  };
};
