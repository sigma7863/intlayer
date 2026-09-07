//! Root-scope bindings: `const t = useTranslations()` with no namespace, whose
//! dictionaries are named by the message ids passed to `t` rather than by an
//! argument.
//!
//! Only extra (compat) callers declaring `allowRootScope` produce these, so the
//! whole module is inert for a build with no adapters configured. Discovery
//! (during the pre-pass) and the rewrite (during the optimize transform) live
//! together here because they share one invariant: a binding may only be
//! rewritten when *every* message id reached through it named a dictionary.

use crate::{
    ast::{callee_ident_name, make_hashed_ident, make_str, read_static_string, split_namespace},
    config::ExtraCallerConfig,
    dictionary_imports::{ImportKind, InjectedImports},
    extra_caller::{resolve_extra_namespace, ExtraCallerContext},
    pre_pass::CallerMap,
};
use std::collections::{BTreeMap, HashSet};
use swc_core::{common::DUMMY_SP, ecma::ast::*};

/// A `const t = useTranslations()` binding whose dictionaries are derived from
/// the message ids passed to `t` rather than from a namespace argument.
#[derive(Clone, Debug, Default)]
pub struct RootScopeBinding {
    /// Local name of the caller that produced the binding (`useTranslations`),
    /// used to look the extra-caller config back up at rewrite time.
    pub caller_local: String,
    /// Dictionary keys used through this binding, in first-use order. The first
    /// one keeps the original local name; the rest get a generated sibling.
    pub namespaces: Vec<String>,
    /// Set when some message id reached through this binding names no dictionary
    /// and must resolve against the whole-file `index` dictionary instead, with
    /// its id kept intact. Mirrors the runtime resolver's own fallback.
    pub binds_root_dictionary: bool,
}

/// Canonical key of the single dictionary produced when a JSON source pattern
/// has no `{{key}}` segment — one file holds every key (i18next's default
/// `translation` namespace, `syncJSON({ splitKeys: false })`). The runtime
/// resolver falls back to it for any namespace that is not a registered
/// dictionary, so the rewrite has to bind it the same way.
const ROOT_DICTIONARY_KEY: &str = "index";

/// Maps the local name of a translate function to its root-scope binding.
pub type RootScopeMap = BTreeMap<String, RootScopeBinding>;

/// Accumulates root-scope candidates while the pre-pass walks the module.
#[derive(Default)]
pub struct RootScopeCollector {
    /// Candidate bindings discovered on `const t = useTranslations()`.
    bindings: RootScopeMap,
    /// Translate locals that can never be rewritten: bound more than once, or
    /// reached through a message id that is dynamic or has no `namespace.` part.
    poisoned_translate_locals: HashSet<String>,
    /// Namespace-less call sites per caller local, to check at the end that
    /// every one of them became a resolvable binding.
    bare_calls_per_caller: BTreeMap<String, usize>,
}

impl RootScopeCollector {
    /// Records `const t = useTranslations()` as a root-scope candidate.
    ///
    /// A call whose namespace the normal resolver can read is handled by the
    /// scoped path instead, and a binding that is neither a plain identifier
    /// nor an object pattern cannot be tracked back to its call sites safely.
    pub fn note_declarator(
        &mut self,
        declarator: &VarDeclarator,
        caller_map: &CallerMap,
        extra_callers: &[ExtraCallerConfig],
    ) {
        let Some(Expr::Call(call)) = declarator.init.as_deref() else {
            return;
        };
        let Some(caller_local) = callee_ident_name(&call.callee) else {
            return;
        };
        let Some(extra_index) = caller_map
            .get(caller_local)
            .and_then(|meta| meta.extra_index)
        else {
            return;
        };
        let extra_caller = &extra_callers[extra_index];
        if !extra_caller.allow_root_scope {
            return;
        }
        // Only a namespace-less call is a root scope; anything the normal
        // resolver can read is handled by the existing path.
        if resolve_extra_namespace(extra_caller, &call.args).is_some() {
            return;
        }

        let mut translate_locals: Vec<String> = Vec::new();
        match &declarator.name {
            Pat::Ident(binding) => {
                translate_locals.push(binding.id.sym.to_string());
            }
            Pat::Object(object_pat) => {
                for prop in &object_pat.props {
                    match prop {
                        ObjectPatProp::Assign(assign) => {
                            translate_locals.push(assign.key.id.sym.to_string());
                        }
                        ObjectPatProp::KeyValue(kv) => {
                            if let Pat::Ident(binding) = &*kv.value {
                                translate_locals.push(binding.id.sym.to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => return,
        }

        for translate_local in translate_locals {
            if self.bindings.contains_key(&translate_local) {
                self.poisoned_translate_locals.insert(translate_local);
                continue;
            }
            self.bindings.insert(
                translate_local,
                RootScopeBinding {
                    caller_local: caller_local.to_string(),
                    namespaces: Vec::new(),
                    binds_root_dictionary: false,
                },
            );
        }
    }

    /// Records the dictionary a `t("namespace.key")` call site reaches.
    pub fn note_usage(&mut self, callee_name: &str, call: &CallExpr) {
        if !self.bindings.contains_key(callee_name) {
            return;
        }

        let dictionary_key = call
            .args
            .first()
            .and_then(|arg| read_static_string(&arg.expr))
            .map(|message_id| split_namespace(&message_id).0.to_string())
            .filter(|dictionary_key| !dictionary_key.is_empty());

        // A dot-less id addresses the dictionary root (`t("mockBanner")` reads
        // the whole `mockBanner` dictionary); `navigatePath` returns the root
        // for an empty path, so it binds like any other id.
        let Some(dictionary_key) = dictionary_key else {
            self.poisoned_translate_locals
                .insert(callee_name.to_string());
            return;
        };

        if let Some(binding) = self.bindings.get_mut(callee_name) {
            if !binding.namespaces.iter().any(|ns| ns == &dictionary_key) {
                binding.namespaces.push(dictionary_key);
            }
        }
    }

    /// Records one namespace-less call site of `caller_local`, whose verdict is
    /// deferred until every declarator has been visited.
    pub fn note_bare_call(&mut self, caller_local: &str) {
        *self
            .bare_calls_per_caller
            .entry(caller_local.to_string())
            .or_insert(0) += 1;
    }

    /// Finalises the collected candidates.
    ///
    /// Adds to `unresolvable_extra_locals` every caller with a namespace-less
    /// call site that did *not* become a resolvable binding — re-pointing the
    /// shared import while some call still passes nothing would hand the
    /// dictionary-accepting helper an empty argument list.
    ///
    /// Returns the surviving bindings and whether any of their dictionaries is
    /// overridden to a per-locale loader.
    pub fn finish(
        self,
        unresolvable_extra_locals: &mut HashSet<String>,
        dictionary_mode_map: &BTreeMap<String, String>,
    ) -> (RootScopeMap, bool) {
        let RootScopeCollector {
            mut bindings,
            poisoned_translate_locals,
            bare_calls_per_caller,
        } = self;

        // Keep only the bindings that reached exactly the dictionaries we can bind.
        bindings.retain(|translate_local, binding| {
            !poisoned_translate_locals.contains(translate_local) && !binding.namespaces.is_empty()
        });

        // The first id segment only *looks* like a dictionary key. When the
        // project keeps a single whole-file dictionary (i18next's default
        // `translation` namespace, `syncJSON({ splitKeys: false })`), a call
        // such as `t("about.grid.title")` addresses the `about` group *inside*
        // that dictionary — there is no `about` dictionary to import, and
        // rewriting would emit an unresolvable import and fail the build.
        //
        // `dictionary_mode_map` carries one entry per dictionary in the
        // project, so it doubles as the set of keys that can be bound. Dropping
        // the binding here also marks its caller unresolvable below, leaving
        // the call site to the runtime registry.
        //
        // An empty map carries no information (no dictionary list was supplied),
        // so the check is skipped rather than rejecting every binding.
        if !dictionary_mode_map.is_empty() {
            let has_root_dictionary = dictionary_mode_map.contains_key(ROOT_DICTIONARY_KEY);
            let mut unbindable_locals: Vec<String> = Vec::new();

            for (translate_local, binding) in bindings.iter_mut() {
                let has_unknown = binding
                    .namespaces
                    .iter()
                    .any(|namespace| !dictionary_mode_map.contains_key(namespace));
                if !has_unknown {
                    continue;
                }

                // Without a whole-file dictionary to fall back on there is
                // nothing to bind; leave the call site to the runtime.
                if !has_root_dictionary {
                    unbindable_locals.push(translate_local.clone());
                    continue;
                }

                binding
                    .namespaces
                    .retain(|namespace| dictionary_mode_map.contains_key(namespace));
                if !binding
                    .namespaces
                    .iter()
                    .any(|namespace| namespace == ROOT_DICTIONARY_KEY)
                {
                    binding.namespaces.push(ROOT_DICTIONARY_KEY.to_string());
                }
                binding.binds_root_dictionary = true;
            }

            for translate_local in unbindable_locals {
                bindings.remove(&translate_local);
            }
        }

        for (caller_local, bare_call_count) in &bare_calls_per_caller {
            let resolved = bindings
                .values()
                .filter(|binding| &binding.caller_local == caller_local)
                .count();
            if resolved != *bare_call_count {
                unresolvable_extra_locals.insert(caller_local.clone());
            }
        }

        // Drop bindings whose caller ended up unrewritable for another reason.
        bindings.retain(|_, binding| !unresolvable_extra_locals.contains(&binding.caller_local));

        let has_dynamic_dictionary = bindings.values().any(|binding| {
            binding.namespaces.iter().any(|namespace| {
                ImportKind::from_option(dictionary_mode_map.get(namespace).map(String::as_str))
                    .is_some_and(|kind| kind.is_dynamic_helper())
            })
        });

        (bindings, has_dynamic_dictionary)
    }
}

/// Deterministic sibling name for the 2nd..nth dictionary of a root scope.
fn root_scope_alias(translate_local: &str, dictionary_key: &str) -> Ident {
    make_hashed_ident(&format!("{translate_local}#{dictionary_key}"), "_ns")
}

/// Builds the pattern a sibling declarator binds to, mirroring the shape of the
/// original declarator so `const { t } = …` yields `const { t: _alias } = …`.
fn sibling_pattern(original: &Pat, alias_ident: &Ident) -> Pat {
    let Pat::Object(object_pat) = original else {
        return Pat::Ident(BindingIdent {
            id: alias_ident.clone(),
            type_ann: None,
        });
    };

    let mut new_pat = object_pat.clone();
    for prop in &mut new_pat.props {
        match prop {
            ObjectPatProp::Assign(assign) => {
                *prop = ObjectPatProp::KeyValue(KeyValuePatProp {
                    key: PropName::Ident(assign.key.id.clone().into()),
                    value: Box::new(Pat::Ident(BindingIdent {
                        id: alias_ident.clone(),
                        type_ann: None,
                    })),
                });
            }
            ObjectPatProp::KeyValue(kv) => {
                kv.value = Box::new(Pat::Ident(BindingIdent {
                    id: alias_ident.clone(),
                    type_ann: None,
                }));
            }
            _ => {}
        }
    }
    Pat::Object(new_pat)
}

/// The translate local a declarator binds, when it is one the root scope knows.
fn declarator_translate_local(
    declarator: &VarDeclarator,
    root_scope: &RootScopeMap,
) -> Option<String> {
    match &declarator.name {
        Pat::Ident(binding_ident) => {
            let local = binding_ident.id.sym.to_string();
            root_scope.contains_key(&local).then_some(local)
        }
        Pat::Object(object_pat) => object_pat.props.iter().find_map(|prop| {
            let local = match prop {
                ObjectPatProp::Assign(assign) => assign.key.id.sym.to_string(),
                ObjectPatProp::KeyValue(kv) => match &*kv.value {
                    Pat::Ident(binding) => binding.id.sym.to_string(),
                    _ => return None,
                },
                _ => return None,
            };
            root_scope.contains_key(&local).then_some(local)
        }),
        _ => None,
    }
}

/// Binds each root-scope declarator in `var_decl` to its dictionary, adding a
/// sibling declarator for every dictionary beyond the first:
///
/// ```js
/// const t = useTranslations();            // t("header.home"), t("footer.contact")
/// // becomes
/// const t = useDictionary(_header), _tFooter = useDictionary(_footer);
/// ```
pub fn rewrite_root_scope_declarators(
    var_decl: &mut VarDecl,
    root_scope: &RootScopeMap,
    extra: &ExtraCallerContext,
    imports: &mut InjectedImports,
) {
    let mut siblings: Vec<VarDeclarator> = Vec::new();

    for declarator in &mut var_decl.decls {
        let Some(translate_local) = declarator_translate_local(declarator, root_scope) else {
            continue;
        };
        let Some(binding) = root_scope.get(&translate_local) else {
            continue;
        };
        let Some(Expr::Call(call)) = declarator.init.as_deref_mut() else {
            continue;
        };
        let Some((first_namespace, rest_namespaces)) = binding.namespaces.split_first() else {
            continue;
        };

        // Snapshot before rewriting so each sibling starts from the original
        // argument list.
        let original_call = call.clone();
        extra.bind_call_to_dictionary(call, first_namespace, imports);

        for dictionary_key in rest_namespaces {
            let mut sibling_call = original_call.clone();
            extra.bind_call_to_dictionary(&mut sibling_call, dictionary_key, imports);

            let alias_ident = root_scope_alias(&translate_local, dictionary_key);
            siblings.push(VarDeclarator {
                span: DUMMY_SP,
                name: sibling_pattern(&declarator.name, &alias_ident),
                init: Some(Box::new(Expr::Call(sibling_call))),
                definite: false,
            });
        }
    }

    var_decl.decls.extend(siblings);
}

/// Rewrites `t("footer.github")` into `t("github")`, re-pointing the callee at
/// the sibling binding when the dictionary is not the declarator's first one.
///
/// Returns `true` when `callee_name` is a root-scope translate function, so the
/// caller stops treating the call as a regular caller invocation.
pub fn rewrite_root_scope_message_call(
    call: &mut CallExpr,
    callee_name: &str,
    root_scope: &RootScopeMap,
) -> bool {
    let Some(binding) = root_scope.get(callee_name) else {
        return false;
    };

    let Some(message_id) = call
        .args
        .first()
        .and_then(|arg| read_static_string(&arg.expr))
    else {
        return true;
    };

    let (segment_key, stripped_id) = split_namespace(&message_id);

    // A leading segment naming a real dictionary is stripped and bound to it.
    // Anything else resolves against the whole-file dictionary with the id
    // kept intact — exactly what the runtime resolver does.
    let (dictionary_key, resolved_id) = if binding.namespaces.iter().any(|ns| ns == segment_key) {
        (segment_key, stripped_id)
    } else if binding.binds_root_dictionary {
        (ROOT_DICTIONARY_KEY, message_id.as_str())
    } else {
        return true;
    };

    if let Some(first_arg) = call.args.first_mut() {
        first_arg.expr = Box::new(Expr::Lit(Lit::Str(make_str(resolved_id))));
    }
    if binding.namespaces.first().map(String::as_str) != Some(dictionary_key) {
        call.callee = Callee::Expr(Box::new(Expr::Ident(root_scope_alias(
            callee_name,
            dictionary_key,
        ))));
    }

    true
}
