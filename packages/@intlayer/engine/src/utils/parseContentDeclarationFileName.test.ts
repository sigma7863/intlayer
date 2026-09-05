import { FILE_EXTENSIONS } from '@intlayer/config/defaultValues';
import type { IntlayerConfig } from '@intlayer/types/config';
import { describe, expect, it } from 'vitest';
import { parseContentDeclarationFileName } from './parseContentDeclarationFileName';

const configuration = {
  content: { fileExtensions: FILE_EXTENSIONS },
  internationalization: { locales: ['en', 'fr', 'en-GB'], defaultLocale: 'en' },
} as unknown as IntlayerConfig;

describe('parseContentDeclarationFileName', () => {
  it('returns the file name as key when no locale suffix is present', () => {
    expect(
      parseContentDeclarationFileName('src/about.content.ts', configuration)
    ).toEqual({ key: 'about' });
  });

  it('extracts the locale suffix of a markdown declaration', () => {
    expect(
      parseContentDeclarationFileName('src/about.fr.content.md', configuration)
    ).toEqual({ key: 'about', locale: 'fr' });
  });

  it('extracts the locale suffix of an mdx declaration', () => {
    expect(
      parseContentDeclarationFileName('src/about.fr.content.mdx', configuration)
    ).toEqual({ key: 'about', locale: 'fr' });
  });

  it('matches a locale suffix regardless of its casing', () => {
    expect(
      parseContentDeclarationFileName(
        'src/about.EN-gb.content.md',
        configuration
      )
    ).toEqual({ key: 'about', locale: 'en-GB' });
  });

  it('keeps a suffix that matches no configured locale in the key', () => {
    expect(
      parseContentDeclarationFileName('src/about.v2.content.md', configuration)
    ).toEqual({ key: 'about.v2' });
  });

  it('keeps a dotted key that is not a locale', () => {
    expect(
      parseContentDeclarationFileName(
        'src/about.section.content.ts',
        configuration
      )
    ).toEqual({ key: 'about.section' });
  });

  it('treats a single-segment name as a key, not as a locale', () => {
    expect(
      parseContentDeclarationFileName('src/fr.content.md', configuration)
    ).toEqual({ key: 'fr' });
  });

  it('falls back to the generic .content.* pattern for unlisted extensions', () => {
    expect(
      parseContentDeclarationFileName('src/about.fr.content.po', configuration)
    ).toEqual({ key: 'about', locale: 'fr' });
  });
});
