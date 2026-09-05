import { basename } from 'node:path';
import type { IntlayerConfig } from '@intlayer/types/config';
import type { LocalesValues } from '@intlayer/types/module_augmentation';

export type ContentDeclarationFileName = {
  /** Dictionary key derived from the file name, locale suffix excluded */
  key: string;
  /** Locale declared as a file name suffix, e.g. `about.fr.content.md` -> `fr` */
  locale?: LocalesValues;
};

/** Fallback used when the file name matches no configured content extension */
const CONTENT_EXTENSION_PATTERN = /\.content\.[^.]+$/;

/**
 * Splits a content declaration file name into its dictionary key and its
 * optional locale suffix.
 *
 * @example
 * parseContentDeclarationFileName('src/about.content.ts', configuration)
 * // { key: 'about' }
 *
 * parseContentDeclarationFileName('src/about.fr.content.md', configuration)
 * // { key: 'about', locale: 'fr' }
 */
export const parseContentDeclarationFileName = (
  filePath: string,
  configuration: IntlayerConfig
): ContentDeclarationFileName => {
  const fileName = basename(filePath);

  // Longest match first so `.content.mdx` wins over a hypothetical `.mdx`
  const matchedExtension = configuration.content.fileExtensions
    .filter((extension) => fileName.endsWith(extension))
    .sort((a, b) => b.length - a.length)[0];

  const nameWithoutExtension = matchedExtension
    ? fileName.slice(0, -matchedExtension.length)
    : fileName.replace(CONTENT_EXTENSION_PATTERN, '');

  const lastSegmentIndex = nameWithoutExtension.lastIndexOf('.');

  // A name made of a single segment is the key itself, never a locale
  if (lastSegmentIndex <= 0) return { key: nameWithoutExtension };

  const lastSegment = nameWithoutExtension.slice(lastSegmentIndex + 1);
  const matchedLocale = configuration.internationalization.locales.find(
    (locale) => locale.toLowerCase() === lastSegment.toLowerCase()
  );

  if (!matchedLocale) return { key: nameWithoutExtension };

  return {
    key: nameWithoutExtension.slice(0, lastSegmentIndex),
    locale: matchedLocale,
  };
};
