//! The dictionary imports one file needs, accumulated while its call sites are
//! rewritten and injected in one pass at the end.
//!
//! Both the native and the extra-caller rewrites allocate through this registry,
//! so a dictionary read through `useIntlayer("about")` and through
//! `useTranslation("about")` in the same file shares a single import.

use crate::ast::make_hashed_ident;
use std::collections::BTreeMap;
use swc_core::ecma::ast::Ident;

/// Per-call import mode. Dynamic and fetch resolve to the same helper but to
/// different generated loader directories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportKind {
    Static,
    Dynamic,
    Fetch,
}

impl ImportKind {
    /// Parses the wire value of `importMode` / `dictionaryModeMap`.
    /// Unrecognised values are treated as `"static"` so a typo never silently
    /// promotes a dictionary to a dynamic loader.
    pub fn from_option(raw: Option<&str>) -> Option<Self> {
        match raw {
            Some("dynamic") => Some(ImportKind::Dynamic),
            Some("fetch") => Some(ImportKind::Fetch),
            Some(_) => Some(ImportKind::Static),
            None => None,
        }
    }

    /// Suffix appended to the generated import identifier, which also tells the
    /// import-injection step which directory the loader lives in.
    fn ident_suffix(self) -> &'static str {
        match self {
            ImportKind::Static => "",
            ImportKind::Dynamic => "_dyn",
            ImportKind::Fetch => "_fetch",
        }
    }

    /// Whether the call site receives a loader plus its dictionary key rather
    /// than a plain dictionary object.
    pub fn is_dynamic_helper(self) -> bool {
        !matches!(self, ImportKind::Static)
    }
}

/// Dictionary imports the transform decided to inject, in insertion order.
#[derive(Default)]
pub struct InjectedImports {
    /// Dictionary key → identifier of the static JSON (or nested companion) import.
    pub static_imports: BTreeMap<String, Ident>,
    /// Dictionary key → identifier of the dynamic / fetch loader import.
    pub dynamic_imports: BTreeMap<String, Ident>,
}

impl InjectedImports {
    /// Returns the identifier for `key` in the map matching `import_kind`,
    /// creating and registering it on first use. Dynamic and fetch identifiers
    /// share one map because they resolve to the same import slot,
    /// distinguished only by their `_dyn` / `_fetch` suffix.
    pub fn ident_for(&mut self, key: &str, import_kind: ImportKind) -> Ident {
        let map = match import_kind {
            ImportKind::Static => &mut self.static_imports,
            ImportKind::Dynamic | ImportKind::Fetch => &mut self.dynamic_imports,
        };

        if let Some(ident) = map.get(key) {
            return ident.clone();
        }

        let ident = make_hashed_ident(key, import_kind.ident_suffix());
        map.insert(key.to_string(), ident.clone());
        ident
    }
}
