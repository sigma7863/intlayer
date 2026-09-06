import type * as BabelTypes from '@babel/types';
import type {
  CallerDescriptor,
  CallerValueSource,
} from '@intlayer/config/callers';
import {
  ABSENT_VALUE,
  findObjectProperty,
  readObjectProperty,
  readObjectPropertyNode,
  readStaticFirstSegment,
  readStaticString,
  type StaticOrAbsent,
} from '../staticAstReaders';

/**
 * Resolution of a compat caller's namespace from its
 * {@link CallerValueSource} list.
 *
 * Two flavours coexist on purpose, because the two passes ask different
 * questions of the same descriptor:
 *
 * - {@link resolveNamespaceForAnalysis} answers *which dictionary does this
 *   call read* — used by the usage analyser, which only needs to attribute a
 *   call to a dictionary and may fall back to the caller's default namespace.
 * - {@link resolveNamespaceForRewrite} answers *can this call be rewritten,
 *   and where do I edit it* — used by the optimize pass, which needs an exact
 *   static namespace plus a handle on the node it must replace. It has no
 *   default-namespace fallback: rewriting a call whose namespace is only
 *   implied would bind the wrong dictionary.
 */

/** Namespace used by compat callers when no namespace argument is given. */
export const DEFAULT_COMPAT_NAMESPACE = 'translation';

/**
 * Resolves the namespace (dictionary key) for a compat caller call-site from
 * one `CallerValueSource`. Returns the static key, {@link ABSENT_VALUE} when
 * the configured argument is absent (caller falls back to its default
 * namespace), or `undefined` when the value is present but dynamic.
 */
const resolveNamespaceFromSource = (
  babelTypes: typeof BabelTypes,
  callArguments: BabelTypes.CallExpression['arguments'],
  source: CallerValueSource
): StaticOrAbsent<string> => {
  if (source.from === 'fixed') return source.value;

  if (source.from === 'path-first-segment') {
    const firstArgument = callArguments[0];
    // No sensible default: the dictionary key is *derived* from the id, so an
    // absent id means the call cannot be attributed to any dictionary → skip.
    if (firstArgument === undefined) return undefined;

    // String form: formatMessage('home.title', values). A template literal
    // whose leading quasi already carries the dot — formatMessage(`home.${x}`)
    // — names its dictionary just as unambiguously as a plain string, even
    // though the full id stays dynamic.
    const firstSegment = readStaticFirstSegment(babelTypes, firstArgument);
    if (firstSegment !== undefined) return firstSegment;

    // Descriptor form: formatMessage({ id: 'home.title', ... }, values)
    if (babelTypes.isObjectExpression(firstArgument)) {
      const idNode = readObjectPropertyNode(babelTypes, firstArgument, 'id');
      if (idNode === ABSENT_VALUE) return ABSENT_VALUE;
      if (idNode === undefined) return undefined;
      // Same reasoning as above for `{ id: `home.${x}` }`.
      return readStaticFirstSegment(babelTypes, idNode);
    }

    return undefined; // dynamic first argument
  }

  if (source.from === 'argument') {
    const argument = callArguments[source.index];
    if (argument === undefined) return ABSENT_VALUE;

    // Direct string namespace: useTranslations('about')
    const staticString = readStaticString(babelTypes, argument);
    if (staticString !== undefined) return staticString;

    // Object form: getTranslations({ locale, namespace: 'about' })
    if (babelTypes.isObjectExpression(argument)) {
      return readObjectProperty(babelTypes, argument, 'namespace');
    }
    return undefined; // present but dynamic
  }

  // from === 'option'
  const optionsArgument = callArguments[source.argumentIndex];
  if (optionsArgument === undefined) return ABSENT_VALUE;
  if (!babelTypes.isObjectExpression(optionsArgument)) return undefined;
  return readObjectProperty(babelTypes, optionsArgument, source.property);
};

/**
 * Resolves the namespace from a list of `CallerValueSource`s, tried in
 * declaration order. The first source yielding a static string wins.
 * Returns {@link ABSENT_VALUE} when every source reports an absent value, and
 * `undefined` when the namespace is present somewhere but dynamic.
 */
export const resolveNamespaceForAnalysis = (
  babelTypes: typeof BabelTypes,
  callArguments: BabelTypes.CallExpression['arguments'],
  sources: CallerValueSource[]
): StaticOrAbsent<string> => {
  let sawAbsentValue = false;

  for (const source of sources) {
    const resolved = resolveNamespaceFromSource(
      babelTypes,
      callArguments,
      source
    );
    if (typeof resolved === 'string' && resolved !== ABSENT_VALUE) {
      return resolved;
    }
    if (resolved === ABSENT_VALUE) sawAbsentValue = true;
  }

  return sawAbsentValue ? ABSENT_VALUE : undefined;
};

/**
 * Resolves an optional `keyPrefix` for a compat caller. Returns the static
 * prefix string, `null` when no prefix is configured/present, or `undefined`
 * when a prefix is present but dynamic.
 */
export const resolveKeyPrefixForAnalysis = (
  babelTypes: typeof BabelTypes,
  callArguments: BabelTypes.CallExpression['arguments'],
  sources: CallerValueSource[] | undefined
): string | null | undefined => {
  if (!sources || sources.length === 0) return null;

  const resolved = resolveNamespaceForAnalysis(
    babelTypes,
    callArguments,
    sources
  );
  if (resolved === ABSENT_VALUE) return null; // prefix absent
  return resolved; // string or undefined (dynamic)
};

/**
 * Result of statically resolving the namespace of a compat caller call-site
 * for rewriting, carrying the handles the optimize pass mutates.
 */
export type RewritableNamespaceMatch = {
  /** The full namespace string, e.g. `'about.counter'`. */
  fullNamespace: string;
  /** Index of the positional namespace argument, when read from an argument. */
  argumentIndex?: number;
  /**
   * The options-object property holding the namespace, when read from an
   * option. The rewrite mutates it in place (key-prefix remainder) or removes
   * it from `optionsObject`.
   */
  optionProperty?: BabelTypes.ObjectProperty;
  /** The options object owning `optionProperty`. */
  optionsObject?: BabelTypes.ObjectExpression;
};

/**
 * Statically resolves the namespace of a compat caller call-site for the
 * optimize pass. Only the `argument` / `option` / `fixed` sources qualify: the
 * per-message-id `path-first-segment` form cannot bind one dictionary to the
 * call site and is skipped.
 *
 * Returns `undefined` when the namespace is absent or dynamic, in which case
 * the call is left untouched and resolves through the runtime dictionary
 * registry.
 */
export const resolveNamespaceForRewrite = (
  babelTypes: typeof BabelTypes,
  callArguments: BabelTypes.CallExpression['arguments'],
  descriptor: CallerDescriptor
): RewritableNamespaceMatch | undefined => {
  for (const source of descriptor.namespaceSources) {
    if (source.from === 'fixed') {
      return { fullNamespace: source.value };
    }

    if (source.from === 'argument') {
      const namespace = readStaticString(
        babelTypes,
        callArguments[source.index]
      );
      if (namespace !== undefined) {
        return { fullNamespace: namespace, argumentIndex: source.index };
      }
      continue;
    }

    if (source.from === 'option') {
      const optionsArgument = callArguments[source.argumentIndex];
      if (!optionsArgument || !babelTypes.isObjectExpression(optionsArgument)) {
        continue;
      }

      const property = findObjectProperty(
        babelTypes,
        optionsArgument,
        source.property
      );
      if (!property) continue;

      const namespace = readStaticString(babelTypes, property.value);
      if (namespace !== undefined) {
        return {
          fullNamespace: namespace,
          optionProperty: property,
          optionsObject: optionsArgument,
        };
      }
    }
  }

  return undefined;
};
