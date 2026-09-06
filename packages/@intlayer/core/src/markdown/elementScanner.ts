/**
 * Lean, non-backtracking element scanner for HTML blocks, custom components, and self-closing tags.
 */

const findTagEnd = (source: string, from: number): number => {
  const len = source.length;
  let pos = from;
  while (pos < len) {
    const code = source.charCodeAt(pos);
    if (code === 62) return pos; // '>'
    if (code === 34 || code === 39) {
      // '"' or "'"
      let cur = pos + 1;
      while (
        cur < len &&
        source.charCodeAt(cur) !== code &&
        source.charCodeAt(cur) !== 10
      )
        cur++;
      pos = source.charCodeAt(cur) === code ? cur + 1 : pos + 1;
      continue;
    }
    pos++;
  }
  return -1;
};

/** Fold an ASCII upper-case letter to lower case, leaving anything else alone. */
const foldAscii = (code: number): number =>
  code >= 65 && code <= 90 ? code + 32 : code;

/**
 * Compare `needle` against `source` at `at`, ignoring ASCII case.
 *
 * HTML tag names are case-insensitive, and the scanner asks this question once
 * per `<` it walks past — so it must not allocate. Slicing the candidate out and
 * lower-casing it built two strings per question, which is what made the tag
 * walk the most expensive frame in an element-heavy document.
 */
const matchesFolded = (source: string, needle: string, at: number): boolean => {
  for (let index = 0; index < needle.length; index++) {
    if (
      foldAscii(source.charCodeAt(at + index)) !==
      foldAscii(needle.charCodeAt(index))
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Index of the next `needle` tag at or after `from`, or -1 when there is none
 * starting before `limit`.
 *
 * `limit` is what keeps the nesting walk linear: an opening tag only matters
 * when it precedes the closing one, so searching past the closing tag walks the
 * rest of the document — once per element — for an answer that is thrown away.
 */
const findTag = (
  source: string,
  needle: string,
  from: number,
  caseInsensitive: boolean,
  limit: number
): number => {
  if (!caseInsensitive) {
    const idx = source.indexOf(needle, from);
    return idx === -1 || idx >= limit ? -1 : idx;
  }
  const max = Math.min(limit, source.length - needle.length + 1);
  let pos = from;
  while (pos < max) {
    const idx = source.indexOf('<', pos);
    if (idx === -1 || idx >= max) return -1;
    if (matchesFolded(source, needle, idx)) return idx;
    pos = idx + 1;
  }
  return -1;
};

const makeMatch = (
  source: string,
  end: number,
  tagName: string,
  attrs?: string,
  content?: string
): RegExpMatchArray => {
  const result = [
    source.slice(0, end),
    tagName,
    attrs,
    content,
  ] as unknown as RegExpMatchArray;
  result.index = 0;
  result.input = source;
  return result;
};

/** ASCII letter or digit — the characters a tag name is built from. */
const isNameChar = (code: number): boolean =>
  (code >= 97 && code <= 122) ||
  (code >= 65 && code <= 90) ||
  (code >= 48 && code <= 57);

const skipLeadingSpaces = (source: string): number => {
  let i = 0;
  while (source.charCodeAt(i) === 32) i++;
  return source.charCodeAt(i) === 60 ? i : -1;
};

export const matchElement = (
  source: string,
  customComponent: boolean
): RegExpMatchArray | null => {
  const bracket = skipLeadingSpaces(source);
  if (bracket === -1) return null;

  const nameStart = bracket + 1;
  let nameEnd = nameStart;
  const first = source.charCodeAt(nameStart);

  if (customComponent) {
    if (first < 65 || first > 90) return null; // [A-Z]
    while (nameEnd < source.length && isNameChar(source.charCodeAt(nameEnd)))
      nameEnd++;
  } else {
    if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122)))
      return null;
    while (nameEnd < source.length) {
      const c = source.charCodeAt(nameEnd);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 62 || c === 47)
        break;
      nameEnd++;
    }
  }

  const tagName = source.slice(nameStart, nameEnd);
  const openTagEnd = findTagEnd(source, nameEnd);
  if (openTagEnd === -1) return null;
  if (!customComponent && source.charCodeAt(openTagEnd - 1) === 47) return null;

  let contentStart = openTagEnd + 1;
  if (source.charCodeAt(contentStart) === 10) contentStart++;

  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}`;

  let depth = 1;
  let cursor = contentStart;
  const len = source.length;
  let contentEnd = -1;
  let end = -1;

  while (cursor < len) {
    const closeIdx = findTag(source, closeTag, cursor, !customComponent, len);

    if (closeIdx === -1) return null;

    const openIdx = findTag(
      source,
      openTag,
      cursor,
      !customComponent,
      closeIdx
    );

    if (openIdx !== -1) {
      const next = source.charCodeAt(openIdx + openTag.length);
      if (
        next === 32 ||
        next === 9 ||
        next === 10 ||
        next === 13 ||
        next === 62 ||
        next === 47
      ) {
        const nestedEnd = findTagEnd(source, openIdx + openTag.length);
        if (nestedEnd === -1) return null;
        depth++;
        cursor = nestedEnd + 1;
      } else {
        cursor = openIdx + 1;
      }
      continue;
    }

    if (source.charCodeAt(closeIdx + closeTag.length) !== 62) {
      cursor = closeIdx + 1;
      continue;
    }

    const closeTagEnd = closeIdx + closeTag.length + 1;
    depth--;

    if (depth > 0) {
      cursor = closeTagEnd;
      continue;
    }

    // (?!</\1>)
    if (
      findTag(source, closeTag, closeTagEnd, !customComponent, len) ===
        closeTagEnd &&
      source.charCodeAt(closeTagEnd + closeTag.length) === 62
    ) {
      depth = 1;
      cursor = closeTagEnd;
      continue;
    }

    contentEnd = closeIdx;
    end = closeTagEnd;
    break;
  }

  if (end === -1) return null;
  while (source.charCodeAt(end) === 10) end++;

  return makeMatch(
    source,
    end,
    tagName,
    source.slice(nameEnd, openTagEnd),
    source.slice(contentStart, contentEnd)
  );
};

export const matchSelfClosingElement = (
  source: string
): RegExpMatchArray | null => {
  const bracket = skipLeadingSpaces(source);
  if (bracket === -1) return null;

  const nameStart = bracket + 1;
  const first = source.charCodeAt(nameStart);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122)))
    return null;

  let nameEnd = nameStart + 1;
  while (
    nameEnd < source.length &&
    (isNameChar(source.charCodeAt(nameEnd)) ||
      source.charCodeAt(nameEnd) === 58) /* : */
  )
    nameEnd++;

  const c = source.charCodeAt(nameEnd);
  const hasAttrs = c === 32 || c === 9 || c === 10 || c === 13;
  let tagEnd: number;

  if (hasAttrs) {
    tagEnd = findTagEnd(source, nameEnd);
    if (tagEnd === -1) return null;
  } else {
    tagEnd = source.charCodeAt(nameEnd) === 47 ? nameEnd + 1 : nameEnd;
    if (source.charCodeAt(tagEnd) !== 62) return null;
  }

  const tagName = source.slice(nameStart, nameEnd);
  const tailStart = tagEnd + 1;

  // `<tag/></tag>` is a paired element written oddly, not a self-closing one.
  if (
    source.charCodeAt(tailStart) === 60 /* < */ &&
    source.charCodeAt(tailStart + 1) === 47 /* / */ &&
    matchesFolded(source, tagName, tailStart + 2) &&
    source.charCodeAt(tailStart + 2 + tagName.length) === 62 /* > */
  ) {
    return null;
  }

  let end = tailStart;
  let scan = tailStart;
  while (scan < source.length) {
    const sc = source.charCodeAt(scan);
    if (sc !== 32 && sc !== 9 && sc !== 10 && sc !== 13) break;
    scan++;
    if (source.charCodeAt(scan - 1) === 10) end = scan;
  }

  return makeMatch(
    source,
    end,
    tagName,
    hasAttrs ? source.slice(nameEnd + 1, tagEnd) : undefined,
    end > tailStart ? source.slice(tailStart, end) : undefined
  );
};

export const matchHtmlBlockElement = (source: string) =>
  matchElement(source, false);
export const matchCustomComponent = (source: string) =>
  matchElement(source, true);
export const startsWithHtmlBlockElement = (source: string) =>
  matchHtmlBlockElement(source) !== null;
export const startsWithSelfClosingElement = (source: string) =>
  matchSelfClosingElement(source) !== null;
export const startsWithCustomComponent = (source: string) =>
  matchCustomComponent(source) !== null;
export const startsWithElement = (source: string) =>
  startsWithHtmlBlockElement(source) || startsWithSelfClosingElement(source);
