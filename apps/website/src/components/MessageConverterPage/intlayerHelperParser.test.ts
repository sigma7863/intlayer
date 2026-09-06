import { describe, expect, it } from 'vitest';
import { INTLAYER_TEMPLATES } from '../MessageFormatterPage/templates/intlayerTemplates';
import { parseIntlayerHelperCode } from './converterUtils';
import { parseIntlayerHelperExpression } from './intlayerHelperParser';

describe('parseIntlayerHelperExpression', () => {
  describe('accepted grammar', () => {
    it('should parse each helper into its Intlayer node', () => {
      expect(parseIntlayerHelperExpression('t({ en: "Hi" })')).toEqual({
        nodeType: 'translation',
        translation: { en: 'Hi' },
      });
      expect(parseIntlayerHelperExpression('plural({ one: "1" })')).toEqual({
        nodeType: 'plural',
        plural: { one: '1' },
      });
      expect(parseIntlayerHelperExpression('enu({ 0: "Zero" })')).toEqual({
        nodeType: 'enumeration',
        enumeration: { '0': 'Zero' },
      });
      expect(
        parseIntlayerHelperExpression('cond({ true: "On", false: "Off" })')
      ).toEqual({
        nodeType: 'condition',
        condition: { true: 'On', false: 'Off' },
      });
      expect(parseIntlayerHelperExpression('gender({ male: "He" })')).toEqual({
        nodeType: 'gender',
        gender: { male: 'He' },
      });
      expect(parseIntlayerHelperExpression('md("**bold**")')).toEqual({
        nodeType: 'markdown',
        markdown: '**bold**',
      });
      expect(parseIntlayerHelperExpression('html("<p>Hi</p>")')).toEqual({
        nodeType: 'html',
        html: '<p>Hi</p>',
      });
    });

    it('should parse select() with its optional variable name', () => {
      expect(
        parseIntlayerHelperExpression('select({ admin: "Admin" }, "role")')
      ).toEqual({
        nodeType: 'select',
        select: { admin: 'Admin' },
        variable: 'role',
      });
      expect(parseIntlayerHelperExpression('select({ a: "A" })')).toEqual({
        nodeType: 'select',
        select: { a: 'A' },
      });
    });

    it('should parse nested helpers, arrays and trailing commas', () => {
      expect(
        parseIntlayerHelperExpression(
          't({\n  en: md("# Title"),\n  fr: html("<b>Titre</b>"),\n})'
        )
      ).toEqual({
        nodeType: 'translation',
        translation: {
          en: { nodeType: 'markdown', markdown: '# Title' },
          fr: { nodeType: 'html', html: '<b>Titre</b>' },
        },
      });
      expect(parseIntlayerHelperExpression('[1, "two", true, null,]')).toEqual([
        1,
        'two',
        true,
        null,
      ]);
    });

    it('should parse quoted, numeric and reserved-looking property keys', () => {
      expect(
        parseIntlayerHelperExpression(
          'plural({ "=0": "None", 1: "One", other: "Many" })'
        )
      ).toEqual({
        nodeType: 'plural',
        plural: { '=0': 'None', '1': 'One', other: 'Many' },
      });
    });

    it('should parse string literals in all three quote styles', () => {
      expect(parseIntlayerHelperExpression('md(`line1\nline2`)')).toEqual({
        nodeType: 'markdown',
        markdown: 'line1\nline2',
      });
      expect(
        parseIntlayerHelperExpression(`html('<a href="/x">x</a>')`)
      ).toEqual({ nodeType: 'html', html: '<a href="/x">x</a>' });
    });

    it('should decode escape sequences', () => {
      expect(parseIntlayerHelperExpression('"a\\nb\\tc\\\\d\\"e"')).toBe(
        'a\nb\tc\\d"e'
      );
      expect(parseIntlayerHelperExpression('"\\u0041\\u{1F600}\\x41"')).toBe(
        'A\u{1F600}A'
      );
    });

    it('should parse bare literals', () => {
      expect(parseIntlayerHelperExpression('42')).toBe(42);
      expect(parseIntlayerHelperExpression('-1.5e2')).toBe(-150);
      expect(parseIntlayerHelperExpression('true')).toBe(true);
      expect(parseIntlayerHelperExpression('null')).toBeNull();
      expect(parseIntlayerHelperExpression('undefined')).toBeUndefined();
    });
  });

  describe('rejected input (no code execution)', () => {
    const maliciousInputs = [
      'alert(1)',
      'globalThis',
      'fetch("https://evil.test")',
      '(() => 1)()',
      'constructor.constructor("return 1")()',
      't({ en: "x" }).constructor',
      'this',
      'window.location',
      'process.env',
      't({ en: "ok" }); alert(1)',
      't({ en: "ok" }) + alert(1)',
      '[].map(alert)',
      'new Date()',
      'typeof alert',
      `t({ en: \`\${alert(1)}\` })`,
    ];

    it.each(maliciousInputs)('should reject %j', (input) => {
      expect(() => parseIntlayerHelperExpression(input)).toThrow(SyntaxError);
    });

    it('should not execute side effects through the public entry point', () => {
      const globalScope = globalThis as Record<string, unknown>;
      Reflect.deleteProperty(globalScope, '__intlayerParserProbe');

      parseIntlayerHelperCode('globalThis.__intlayerParserProbe = 1');
      parseIntlayerHelperCode(
        '(() => { globalThis.__intlayerParserProbe = 1 })()'
      );

      expect(globalScope.__intlayerParserProbe).toBeUndefined();
    });

    it('should reject malformed literals', () => {
      expect(() => parseIntlayerHelperExpression('t({ en: "Hello })')).toThrow(
        /Unterminated string literal/
      );
      expect(() => parseIntlayerHelperExpression('t({ en: "x" }')).toThrow(
        SyntaxError
      );
      expect(() => parseIntlayerHelperExpression('{ en: "x" ')).toThrow(
        SyntaxError
      );
      expect(() => parseIntlayerHelperExpression('t()')).toThrow(
        /exactly one argument/
      );
      expect(() =>
        parseIntlayerHelperExpression('select({ a: "A" }, "b", "c")')
      ).toThrow(/one or two arguments/);
    });

    it('should reject nesting beyond the depth limit', () => {
      const deeplyNested = `${'['.repeat(200)}1${']'.repeat(200)}`;
      expect(() => parseIntlayerHelperExpression(deeplyNested)).toThrow(
        /nested deeper/
      );
    });
  });

  describe('prototype safety', () => {
    it('should keep "__proto__" an own property', () => {
      const parsed = parseIntlayerHelperExpression(
        '{ "__proto__": { "polluted": true } }'
      ) as Record<string, unknown>;

      expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('parseIntlayerHelperCode fallback', () => {
    it('should return the raw string when the input is not a helper expression', () => {
      expect(parseIntlayerHelperCode('Hello {{name}}!')).toBe(
        'Hello {{name}}!'
      );
      expect(parseIntlayerHelperCode('alert(1)')).toBe('alert(1)');
    });

    it('should parse object literals with unquoted keys', () => {
      expect(parseIntlayerHelperCode('{ en: "Hello", fr: "Bonjour" }')).toEqual(
        {
          en: 'Hello',
          fr: 'Bonjour',
        }
      );
    });
  });

  describe('shipped templates', () => {
    const helperTemplates = INTLAYER_TEMPLATES.filter((template) =>
      /^\s*(t|plural|enu|cond|gender|select|md|html)\s*\(/.test(
        template.template
      )
    );

    it('should cover every helper template shipped by the formatter page', () => {
      expect(helperTemplates.length).toBeGreaterThan(0);
    });

    it.each(
      helperTemplates.map((template) => [template.id, template.template])
    )('should parse template %s', (_id, template) => {
      const parsed = parseIntlayerHelperExpression(template);
      expect(parsed).toHaveProperty('nodeType');
    });
  });
});
