import type { NodePath } from '@babel/core';
import type * as BabelTypes from '@babel/types';

/**
 * Static-value readers shared by every pass that has to decide, at build time,
 * which dictionary a call site reads.
 *
 * They were previously duplicated — with small behavioural drifts — between
 * `babel-plugin-intlayer-optimize` and `babel-plugin-intlayer-usage-analyzer`.
 * Both now read through this module so a call site the analyser can attribute
 * is exactly the one the optimizer can rewrite.
 */

/**
 * Reads a fully-static string from an AST node. Returns `undefined` for
 * dynamic values (identifiers, expressions, template literals with
 * interpolations, …).
 */
export const readStaticString = (
  babelTypes: typeof BabelTypes,
  node: BabelTypes.Node | null | undefined
): string | undefined => {
  if (!node) return undefined;
  if (babelTypes.isStringLiteral(node)) return node.value;
  if (
    babelTypes.isTemplateLiteral(node) &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;
  }
  return undefined;
};

/** Returns the first dot-path segment of a key, e.g. `'a.b.c'` → `'a'`. */
export const firstPathSegment = (path: string): string =>
  path.split('.')[0] ?? path;

/**
 * Reads the static first dot-path segment from a message-id node.
 *
 *   t('counter.label')      → 'counter'
 *   t(`counter.${x}`)       → 'counter'   (static prefix before the first dot)
 *   t(`${x}.label`)         → undefined   (dynamic first segment)
 *   t(someVariable)         → undefined
 */
export const readStaticFirstSegment = (
  babelTypes: typeof BabelTypes,
  node: BabelTypes.Node | null | undefined
): string | undefined => {
  const staticString = readStaticString(babelTypes, node);
  if (staticString !== undefined) return firstPathSegment(staticString);

  // Template literal whose first quasi already contains the dot delimiter, e.g.
  // `counter.${index}` → the leading `counter` segment is statically known.
  if (babelTypes.isTemplateLiteral(node) && node.quasis.length > 0) {
    const firstQuasi =
      node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;
    if (firstQuasi?.includes('.')) {
      return firstPathSegment(firstQuasi);
    }
  }
  return undefined;
};

/** Whether an object-property key (identifier or string literal) reads as `name`. */
export const propertyKeyMatches = (
  babelTypes: typeof BabelTypes,
  property: BabelTypes.ObjectProperty,
  name: string
): boolean =>
  (babelTypes.isIdentifier(property.key) && property.key.name === name) ||
  (babelTypes.isStringLiteral(property.key) && property.key.value === name);

/**
 * Returns the `ObjectProperty` named `propertyName`, or `undefined` when the
 * object has no such property. Callers that need to mutate the property in
 * place (rewriting or deleting it) use this rather than a value reader.
 */
export const findObjectProperty = (
  babelTypes: typeof BabelTypes,
  objectExpression: BabelTypes.ObjectExpression,
  propertyName: string
): BabelTypes.ObjectProperty | undefined => {
  for (const property of objectExpression.properties) {
    if (!babelTypes.isObjectProperty(property)) continue;
    if (propertyKeyMatches(babelTypes, property, propertyName)) return property;
  }
  return undefined;
};

/**
 * Marker returned by the reader helpers when the requested property or
 * argument is simply absent — distinct from present-but-dynamic, which the
 * callers must treat conservatively.
 */
export const ABSENT_VALUE = '__default__' as const;

/** Either a statically-known value, {@link ABSENT_VALUE}, or `undefined` (dynamic). */
export type StaticOrAbsent<T> = T | typeof ABSENT_VALUE | undefined;

/**
 * Reads a static string property from an object expression. Returns
 * {@link ABSENT_VALUE} when the property is absent and `undefined` when
 * present but dynamic.
 */
export const readObjectProperty = (
  babelTypes: typeof BabelTypes,
  objectExpression: BabelTypes.ObjectExpression,
  propertyName: string
): StaticOrAbsent<string> => {
  const property = findObjectProperty(
    babelTypes,
    objectExpression,
    propertyName
  );
  if (!property) return ABSENT_VALUE;
  return readStaticString(babelTypes, property.value); // present but dynamic → undefined
};

/**
 * Returns the value *node* of a named property, so callers can apply their own
 * reader to it (a full static string, or just its leading path segment).
 * Returns {@link ABSENT_VALUE} when the property is absent.
 */
export const readObjectPropertyNode = (
  babelTypes: typeof BabelTypes,
  objectExpression: BabelTypes.ObjectExpression,
  propertyName: string
): StaticOrAbsent<BabelTypes.Node> => {
  const property = findObjectProperty(
    babelTypes,
    objectExpression,
    propertyName
  );
  if (!property) return ABSENT_VALUE;
  return property.value;
};

/**
 * Reads a named JSX attribute as a static string and returns it wrapped in a
 * `StringLiteral` node so the result can be fed to the same namespace resolver
 * as a call argument. Handles both `id="home.title"` and `id={'home.title'}`.
 * Returns `undefined` when the attribute is absent or dynamic (`id={expr}`).
 */
export const readJsxAttributeString = (
  babelTypes: typeof BabelTypes,
  openingElement: BabelTypes.JSXOpeningElement,
  attributeName: string
): BabelTypes.StringLiteral | undefined => {
  for (const attribute of openingElement.attributes) {
    if (!babelTypes.isJSXAttribute(attribute)) continue;
    if (
      !babelTypes.isJSXIdentifier(attribute.name) ||
      attribute.name.name !== attributeName
    ) {
      continue;
    }

    const value = attribute.value;
    // id="home.title"
    if (babelTypes.isStringLiteral(value)) return value;
    // id={'home.title'} / id={`home.title`}
    if (babelTypes.isJSXExpressionContainer(value)) {
      const staticString = readStaticString(babelTypes, value.expression);
      if (staticString !== undefined) {
        return babelTypes.stringLiteral(staticString);
      }
    }
    return undefined; // attribute present but dynamic
  }
  return undefined; // attribute absent
};

/**
 * Splits a compat namespace at the first `.` to separate the dictionary key
 * from an optional key prefix, mirroring the SWC plugin's `split_namespace`.
 *
 *   `'about'`         → `{ dictionaryKey: 'about', keyPrefix: '' }`
 *   `'about.counter'` → `{ dictionaryKey: 'about', keyPrefix: 'counter' }`
 */
export const splitNamespace = (
  namespace: string
): { dictionaryKey: string; keyPrefix: string } => {
  const dotPosition = namespace.indexOf('.');
  if (dotPosition === -1) return { dictionaryKey: namespace, keyPrefix: '' };
  return {
    dictionaryKey: namespace.slice(0, dotPosition),
    keyPrefix: namespace.slice(dotPosition + 1),
  };
};

/**
 * Climbs past an enclosing `await` expression so that
 * `const t = await getTranslations('ns')` — or `await getIntlayerAsync('key')`
 * — is resolved to its variable declarator the same way the synchronous form
 * is.
 */
export const unwrapAwait = (
  babelTypes: typeof BabelTypes,
  path: NodePath<BabelTypes.Node>
): NodePath<BabelTypes.Node> => {
  const parentPath = path.parentPath;
  if (parentPath && babelTypes.isAwaitExpression(parentPath.node)) {
    return parentPath;
  }
  return path;
};
