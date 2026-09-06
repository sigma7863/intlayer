import {
  CONDITION,
  ENUMERATION,
  formatNodeType,
  GENDER,
  HTML,
  MARKDOWN,
  PLURAL,
  SELECT,
  TRANSLATION,
} from '@intlayer/types/nodeType';

/**
 * Maximum nesting depth accepted, guarding against stack exhaustion on
 * pathologically nested input.
 */
const MAXIMUM_NESTING_DEPTH = 64;

const SIMPLE_ESCAPE_SEQUENCES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
};

const IDENTIFIER_START_PATTERN = /[A-Za-z_$]/;
const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9_$]/;
const DIGIT_PATTERN = /[0-9]/;
const HEXADECIMAL_PATTERN = /[0-9a-fA-F]/;
const WHITESPACE_PATTERN = /\s/;

/** Builds the Intlayer node produced by a helper call from its parsed arguments. */
type HelperNodeBuilder = (parsedArguments: readonly unknown[]) => unknown;

/**
 * Asserts a helper received exactly one argument and returns it.
 */
const requireSingleArgument = (
  helperName: string,
  parsedArguments: readonly unknown[]
): unknown => {
  if (parsedArguments.length !== 1) {
    throw new SyntaxError(
      `"${helperName}()" expects exactly one argument, received ${parsedArguments.length}.`
    );
  }
  return parsedArguments[0];
};

/**
 * The only callables recognised by the parser. Anything else is rejected, so no
 * host function (`fetch`, `alert`, `constructor`…) is ever reachable.
 */
const HELPER_NODE_BUILDERS: Record<string, HelperNodeBuilder> = {
  t: (args) => formatNodeType(TRANSLATION, requireSingleArgument('t', args)),
  plural: (args) =>
    formatNodeType(PLURAL, requireSingleArgument('plural', args)),
  enu: (args) =>
    formatNodeType(ENUMERATION, requireSingleArgument('enu', args)),
  cond: (args) =>
    formatNodeType(CONDITION, requireSingleArgument('cond', args)),
  gender: (args) =>
    formatNodeType(GENDER, requireSingleArgument('gender', args)),
  md: (args) => formatNodeType(MARKDOWN, requireSingleArgument('md', args)),
  html: (args) => formatNodeType(HTML, requireSingleArgument('html', args)),
  select: (args) => {
    if (args.length < 1 || args.length > 2) {
      throw new SyntaxError(
        `"select()" expects one or two arguments, received ${args.length}.`
      );
    }
    const [selectMap, variableName] = args;
    if (variableName !== undefined && typeof variableName !== 'string') {
      throw new SyntaxError(
        '"select()" expects its second argument to be a variable name string.'
      );
    }
    return formatNodeType(
      SELECT,
      selectMap,
      variableName ? { variable: variableName } : undefined
    );
  },
};

const HELPER_NAMES = Object.keys(HELPER_NODE_BUILDERS);

/**
 * Parses the Intlayer helper expression subset emitted by
 * `serializeIntlayerNodeToTs` into plain Intlayer AST nodes.
 *
 * The accepted grammar is closed and data-only — helper calls (`t`, `plural`,
 * `enu`, `cond`, `gender`, `select`, `md`, `html`), object and array literals,
 * strings, numbers, booleans, `null` and `undefined`. Identifiers that are not
 * helpers, property access, operators and trailing statements are all rejected,
 * so untrusted input is never executed.
 *
 * @throws SyntaxError when the input is not a valid helper expression.
 */
export const parseIntlayerHelperExpression = (source: string): unknown => {
  let cursor = 0;

  const syntaxError = (message: string): SyntaxError =>
    new SyntaxError(`${message} (at character ${cursor + 1}).`);

  const peek = (): string | undefined => source[cursor];

  const skipWhitespace = (): void => {
    while (cursor < source.length && WHITESPACE_PATTERN.test(source[cursor])) {
      cursor += 1;
    }
  };

  const consume = (expectedCharacter: string): void => {
    skipWhitespace();
    if (peek() !== expectedCharacter) {
      throw syntaxError(`Expected "${expectedCharacter}"`);
    }
    cursor += 1;
  };

  const readIdentifier = (): string => {
    const startIndex = cursor;
    const firstCharacter = peek();
    if (
      firstCharacter === undefined ||
      !IDENTIFIER_START_PATTERN.test(firstCharacter)
    ) {
      throw syntaxError('Expected an identifier');
    }
    cursor += 1;
    while (
      cursor < source.length &&
      IDENTIFIER_PART_PATTERN.test(source[cursor])
    ) {
      cursor += 1;
    }
    return source.slice(startIndex, cursor);
  };

  /** Reads exactly `length` hexadecimal digits and returns their numeric value. */
  const readHexadecimalDigits = (length: number): number => {
    const startIndex = cursor;
    while (
      cursor < source.length &&
      cursor - startIndex < length &&
      HEXADECIMAL_PATTERN.test(source[cursor])
    ) {
      cursor += 1;
    }
    if (cursor - startIndex !== length) {
      throw syntaxError('Invalid escape sequence');
    }
    return Number.parseInt(source.slice(startIndex, cursor), 16);
  };

  const readUnicodeEscape = (): string => {
    if (peek() === '{') {
      cursor += 1;
      const startIndex = cursor;
      while (
        cursor < source.length &&
        HEXADECIMAL_PATTERN.test(source[cursor])
      ) {
        cursor += 1;
      }
      if (cursor === startIndex || peek() !== '}') {
        throw syntaxError('Invalid unicode escape sequence');
      }
      const codePoint = Number.parseInt(source.slice(startIndex, cursor), 16);
      cursor += 1;
      if (codePoint > 0x10ffff) {
        throw syntaxError('Unicode escape sequence out of range');
      }
      return String.fromCodePoint(codePoint);
    }
    return String.fromCharCode(readHexadecimalDigits(4));
  };

  const readStringLiteral = (): string => {
    const quote = source[cursor];
    cursor += 1;
    let value = '';

    while (cursor < source.length) {
      const character = source[cursor];

      if (character === quote) {
        cursor += 1;
        return value;
      }

      if (character === '\\') {
        cursor += 1;
        const escaped = peek();
        if (escaped === undefined) break;
        cursor += 1;
        if (escaped === 'u') {
          value += readUnicodeEscape();
        } else if (escaped === 'x') {
          value += String.fromCharCode(readHexadecimalDigits(2));
        } else if (escaped !== '\n') {
          // A backslash before a newline is a line continuation: it adds nothing.
          value += SIMPLE_ESCAPE_SEQUENCES[escaped] ?? escaped;
        }
        continue;
      }

      // Template literals are read as plain text: interpolation would require
      // evaluating an expression, which this parser deliberately cannot do.
      if (quote === '`' && character === '$' && source[cursor + 1] === '{') {
        throw syntaxError('Template literal interpolation is not supported');
      }

      if (quote !== '`' && (character === '\n' || character === '\r')) {
        throw syntaxError('Unterminated string literal');
      }

      value += character;
      cursor += 1;
    }

    throw syntaxError('Unterminated string literal');
  };

  const readNumberLiteral = (): number => {
    const startIndex = cursor;

    if (peek() === '-' || peek() === '+') cursor += 1;
    while (cursor < source.length && DIGIT_PATTERN.test(source[cursor])) {
      cursor += 1;
    }
    if (peek() === '.') {
      cursor += 1;
      while (cursor < source.length && DIGIT_PATTERN.test(source[cursor])) {
        cursor += 1;
      }
    }
    if (peek() === 'e' || peek() === 'E') {
      cursor += 1;
      if (peek() === '-' || peek() === '+') cursor += 1;
      while (cursor < source.length && DIGIT_PATTERN.test(source[cursor])) {
        cursor += 1;
      }
    }

    const rawNumber = source.slice(startIndex, cursor);
    const parsedNumber = Number(rawNumber);
    if (rawNumber === '' || Number.isNaN(parsedNumber)) {
      throw syntaxError(`Invalid number literal "${rawNumber}"`);
    }
    return parsedNumber;
  };

  const readPropertyKey = (): string => {
    skipWhitespace();
    const character = peek();
    if (character === undefined) throw syntaxError('Expected a property key');
    if (character === '"' || character === "'" || character === '`') {
      return readStringLiteral();
    }
    if (DIGIT_PATTERN.test(character) || character === '-') {
      return String(readNumberLiteral());
    }
    return readIdentifier();
  };

  const readObjectLiteral = (depth: number): Record<string, unknown> => {
    consume('{');
    const objectValue: Record<string, unknown> = {};

    skipWhitespace();
    if (peek() === '}') {
      cursor += 1;
      return objectValue;
    }

    while (cursor < source.length) {
      const key = readPropertyKey();
      consume(':');
      const value = readValue(depth + 1);

      // `defineProperty` rather than assignment: a "__proto__" key must become
      // an own property instead of walking the prototype setter.
      Object.defineProperty(objectValue, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      skipWhitespace();
      if (peek() === ',') {
        cursor += 1;
        skipWhitespace();
        if (peek() === '}') {
          cursor += 1;
          return objectValue;
        }
        continue;
      }
      if (peek() === '}') {
        cursor += 1;
        return objectValue;
      }
      throw syntaxError('Expected "," or "}" in object literal');
    }

    throw syntaxError('Unterminated object literal');
  };

  const readArrayLiteral = (depth: number): unknown[] => {
    consume('[');
    const arrayValue: unknown[] = [];

    skipWhitespace();
    if (peek() === ']') {
      cursor += 1;
      return arrayValue;
    }

    while (cursor < source.length) {
      arrayValue.push(readValue(depth + 1));

      skipWhitespace();
      if (peek() === ',') {
        cursor += 1;
        skipWhitespace();
        if (peek() === ']') {
          cursor += 1;
          return arrayValue;
        }
        continue;
      }
      if (peek() === ']') {
        cursor += 1;
        return arrayValue;
      }
      throw syntaxError('Expected "," or "]" in array literal');
    }

    throw syntaxError('Unterminated array literal');
  };

  const readArgumentList = (depth: number): unknown[] => {
    consume('(');
    const argumentValues: unknown[] = [];

    skipWhitespace();
    if (peek() === ')') {
      cursor += 1;
      return argumentValues;
    }

    while (cursor < source.length) {
      argumentValues.push(readValue(depth + 1));

      skipWhitespace();
      if (peek() === ',') {
        cursor += 1;
        skipWhitespace();
        if (peek() === ')') {
          cursor += 1;
          return argumentValues;
        }
        continue;
      }
      if (peek() === ')') {
        cursor += 1;
        return argumentValues;
      }
      throw syntaxError('Expected "," or ")" in argument list');
    }

    throw syntaxError('Unterminated argument list');
  };

  const readValue = (depth: number): unknown => {
    if (depth > MAXIMUM_NESTING_DEPTH) {
      throw syntaxError(
        `Expression nested deeper than ${MAXIMUM_NESTING_DEPTH} levels`
      );
    }

    skipWhitespace();
    const character = peek();
    if (character === undefined) throw syntaxError('Unexpected end of input');

    if (character === '"' || character === "'" || character === '`') {
      return readStringLiteral();
    }
    if (character === '{') return readObjectLiteral(depth);
    if (character === '[') return readArrayLiteral(depth);
    if (
      character === '-' ||
      character === '+' ||
      DIGIT_PATTERN.test(character) ||
      (character === '.' && DIGIT_PATTERN.test(source[cursor + 1] ?? ''))
    ) {
      return readNumberLiteral();
    }

    if (IDENTIFIER_START_PATTERN.test(character)) {
      const identifier = readIdentifier();
      if (identifier === 'true') return true;
      if (identifier === 'false') return false;
      if (identifier === 'null') return null;
      if (identifier === 'undefined') return undefined;

      const buildHelperNode = Object.hasOwn(HELPER_NODE_BUILDERS, identifier)
        ? HELPER_NODE_BUILDERS[identifier]
        : undefined;
      if (!buildHelperNode) {
        throw syntaxError(
          `Unknown identifier "${identifier}"; only the Intlayer helpers (${HELPER_NAMES.join(', ')}) are allowed`
        );
      }

      skipWhitespace();
      if (peek() !== '(') {
        throw syntaxError(`"${identifier}" must be called as a function`);
      }
      return buildHelperNode(readArgumentList(depth));
    }

    throw syntaxError(`Unexpected character "${character}"`);
  };

  const parsedValue = readValue(0);

  skipWhitespace();
  if (cursor < source.length) {
    throw syntaxError('Unexpected trailing characters after the expression');
  }

  return parsedValue;
};
