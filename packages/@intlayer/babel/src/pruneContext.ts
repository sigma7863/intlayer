import type { NestedFieldReferences } from '@intlayer/core/dictionaryManipulator';

/**
 * Dictionary field usage result for a single dictionary key.
 *
 *   'all'        → could not determine statically which fields are used;
 *                  keep every field (no pruning possible).
 *   Set<string>  → the exact top-level content field names that were accessed.
 */
export type DictionaryFieldUsage = Set<string> | 'all';

/**
 * One node in the nested field-rename tree.
 *
 *   shortName – the compact alias assigned to this field name.
 *   children  – rename table for the next level of user-defined keys inside
 *               this field's value (empty when the value is a leaf / primitive).
 */
export type NestedRenameEntry = {
  shortName: string;
  children: NestedRenameMap;
};

/** A level of the field-rename tree, mapping original field names to entries. */
export type NestedRenameMap = Map<string, NestedRenameEntry>;

/**
 * One opaque consumption of a dictionary content value: the value at
 * `fieldPath` escapes static analysis (passed as-is to a child component or a
 * function argument), so its children must keep their original key names in
 * the compiled JSON.
 */
export type OpaqueFieldOccurrence = {
  /**
   * Original (pre-rename) user-defined field names from the content root to
   * the escaping value, e.g. `['sections', 'hero']` for
   * `<Card data={content.sections.hero} />`.
   */
  fieldPath: string[];

  /** Source locations (`filePath:line`) where the value escapes. */
  locations: string[];
};

/**
 * Shared mutable state created once by the vite plugin and passed by reference
 * to the usage-analyzer (writer) and the prune/minify plugins (readers).
 *
 * All mutations happen during the usage-analysis `buildStart` phase; readers
 * only access this state during the subsequent `transform` phase.
 */
export type PruneContext = {
  /**
   * Maps every dictionary key seen in source files to the set of top-level
   * content fields statically accessed, or `'all'` when the access pattern
   * could not be determined.
   */
  dictionaryKeyToFieldUsageMap: Map<string, DictionaryFieldUsage>;

  /**
   * Dictionary keys for which the prune/minify step must be skipped entirely
   * because an edge case was detected during analysis or structure recognition.
   */
  dictionariesWithEdgeCases: Set<string>;

  /**
   * True if at least one source file failed to parse during the analysis phase.
   * The prune plugin uses this flag conservatively: any dictionary key without
   * a usage entry might have been referenced by the unparsable file.
   */
  hasUnparsableSourceFiles: boolean;

  /**
   * Maps dictionary keys to the source file paths where the result of
   * `useIntlayer` / `getIntlayer` was assigned to a plain variable, making
   * static field analysis impossible.
   */
  dictionaryKeysWithUntrackedBindings: Map<string, string[]>;

  /**
   * Maps each dictionary key to a nested field-rename tree built after the
   * usage analysis phase (only populated when `build.minify` is active and
   * the field usage for that dictionary is a finite `Set<string>`).
   */
  dictionaryKeyToFieldRenameMap: Map<string, NestedRenameMap>;

  /**
   * Maps each dictionary key to the content field paths whose values are
   * consumed "opaquely" (passed as-is to a child component or function
   * argument). When an opaque value has nested user-defined structure, its
   * children must not be renamed.
   *
   * The inner map is keyed by the dot-joined field path for de-duplication
   * only; the authoritative path is {@link OpaqueFieldOccurrence.fieldPath}.
   *
   * Structure: dictionaryKey → joinedFieldPath → { fieldPath, locations }
   */
  dictionaryKeysWithOpaqueFields: Map<
    string,
    Map<string, OpaqueFieldOccurrence>
  >;

  /**
   * Dictionary keys for which field-key renaming must be skipped even if a
   * finite field-usage set was determined.
   *
   * Populated for dictionaries whose plain-variable bindings were resolved by
   * the framework-specific extractor (Vue / Svelte SFCs), because the Babel
   * rename plugin cannot update the source-code property accesses for those
   * indirect patterns (Vue `.value.field` / Svelte `$store.field`).
   *
   * Pruning and basic minification still apply; only field-key renaming is
   * suppressed.
   */
  dictionariesSkippingFieldRename: Set<string>;

  /**
   * Plain variable bindings that require a framework-specific secondary pass.
   *
   * Populated during the Babel analysis phase for `.vue` and `.svelte` source
   * files where direct field access is not visible to Babel scope analysis:
   *   - Vue:    `content.value.fieldName` – the `.value` ref-accessor is hidden
   *   - Svelte: `$varName.fieldName`     – the `$` prefix creates a new identifier
   *
   * Structure: filePath → [{variableName, dictionaryKey}, …]
   */
  pendingFrameworkAnalysis: Map<
    string,
    { variableName: string; dictionaryKey: string }[]
  >;
};

export const createPruneContext = (): PruneContext => ({
  dictionaryKeyToFieldUsageMap: new Map(),
  dictionariesWithEdgeCases: new Set(),
  hasUnparsableSourceFiles: false,
  dictionaryKeysWithUntrackedBindings: new Map(),
  dictionaryKeyToFieldRenameMap: new Map(),
  dictionaryKeysWithOpaqueFields: new Map<
    string,
    Map<string, OpaqueFieldOccurrence>
  >(),
  dictionariesSkippingFieldRename: new Set(),
  pendingFrameworkAnalysis: new Map(),
});

/**
 * Records `nest()` references in a prune context so nest targets stay
 * resolvable — and no larger than they need to be — after purge and minify.
 *
 * A nested node stores the ORIGINAL dot path of the field it reads
 * (`nest('common', 'period')` → `'period'`) and `getNesting` resolves it at
 * runtime against the compiled JSON. That drives three adjustments:
 *
 * - Nest targets never take part in field renaming, since the stored path
 *   would no longer match the renamed keys.
 * - A target already consumed by a call site keeps its analysed fields plus
 *   the nested ones, so neither consumer loses content.
 * - A target reached *only* through `nest()` is given a usage entry holding
 *   exactly the nested fields. Without one, the purge pass leaves the whole
 *   dictionary untouched; with one, it trims the dictionary down to what the
 *   nest references actually read. This matters most for `dynamic` / `fetch`
 *   dictionaries, whose full static snapshot would otherwise be pulled into
 *   the eager bundle just to satisfy a single nested field.
 *
 * Seeding is skipped when a source file failed to parse: that file could
 * reference the dictionary in a way the analysis never saw, which is the same
 * guard the purge pass applies to keys with no usage entry.
 *
 * @param pruneContext - Shared analysis state to update in place.
 * @param nestedDictionaryReferences - Nest-target key → referenced top-level
 *   fields, as returned by `getNestedDictionaryReferences`.
 */
export const preserveNestedDictionaryFields = (
  pruneContext: PruneContext,
  nestedDictionaryReferences: Map<string, NestedFieldReferences>
): void => {
  for (const [
    dictionaryKey,
    nestedFields,
  ] of nestedDictionaryReferences.entries()) {
    pruneContext.dictionariesSkippingFieldRename.add(dictionaryKey);

    const currentFieldUsage =
      pruneContext.dictionaryKeyToFieldUsageMap.get(dictionaryKey);

    // A whole-dictionary reference (`nest('common')`) reads every field, so no
    // field set can describe it — leave the dictionary unpruned.
    if (nestedFields === 'all') {
      pruneContext.dictionaryKeyToFieldUsageMap.set(dictionaryKey, 'all');
      continue;
    }

    if (!currentFieldUsage) {
      if (pruneContext.hasUnparsableSourceFiles) continue;

      pruneContext.dictionaryKeyToFieldUsageMap.set(
        dictionaryKey,
        new Set(nestedFields)
      );
      continue;
    }

    // Already consumed by a call site that reads every field.
    if (currentFieldUsage === 'all') continue;

    for (const nestedField of nestedFields) {
      currentFieldUsage.add(nestedField);
    }
  }
};

/**
 * Records the usage of a specific dictionary key's fields into `pruneContext`.
 * Merges with any previously recorded usage for the same key.
 */
export const recordFieldUsage = (
  pruneContext: PruneContext,
  dictionaryKey: string,
  fieldUsage: DictionaryFieldUsage
): void => {
  const existingUsage =
    pruneContext.dictionaryKeyToFieldUsageMap.get(dictionaryKey);

  if (existingUsage === 'all') return; // already saturated

  if (fieldUsage === 'all') {
    pruneContext.dictionaryKeyToFieldUsageMap.set(dictionaryKey, 'all');
    return;
  }

  if (existingUsage instanceof Set) {
    // Merge in place — the set is owned by the map.
    for (const fieldName of fieldUsage) existingUsage.add(fieldName);
    return;
  }

  pruneContext.dictionaryKeyToFieldUsageMap.set(
    dictionaryKey,
    new Set(fieldUsage)
  );
};
