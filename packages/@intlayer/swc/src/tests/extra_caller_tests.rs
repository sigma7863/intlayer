//! Call-site rewriting for compat-adapter callers declared through
//! `extraCallers`.

use std::collections::BTreeMap;
use crate::tests::support::{
    get_config_with_extra_callers, use_i18n_caller, use_lingui_caller, use_translation_caller,
    use_translation_root_scope_caller, use_translations_root_scope_caller, TestFolder,
};
use swc_core::ecma::{parser::Syntax, transforms::testing::test_transform};

#[test]
fn extra_caller_positional_static() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_translation_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslation } from "react-i18next";
        const { t } = useTranslation("about", { keyPrefix: "counter" });
        "#,
        r#"
        import _5sczV2UpZbQ from "../.intlayer/dictionaries/about.json" with { type: "json" };
        import { useDictionary as useTranslation } from "react-i18next";
        const { t } = useTranslation(_5sczV2UpZbQ, { keyPrefix: "counter" });
        "#,
    );
}

#[test]
fn extra_caller_nested_namespace_static() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_translation_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslation } from "react-i18next";
        const { t } = useTranslation("about.counter");
        "#,
        r#"
        import _5sczV2UpZbQ from "../.intlayer/dictionaries/about.json" with { type: "json" };
        import { useDictionary as useTranslation } from "react-i18next";
        const { t } = useTranslation(_5sczV2UpZbQ, "counter");
        "#,
    );
}

#[test]
fn extra_caller_positional_dynamic() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("dynamic", vec![use_translation_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslation } from "react-i18next";
        const { t } = useTranslation("about.counter");
        "#,
        r#"
        import _5sczV2UpZbQ_dyn from "../.intlayer/dynamic_dictionaries/about.mjs";
        import { useDictionaryDynamic as useTranslation } from "react-i18next";
        const { t } = useTranslation(_5sczV2UpZbQ_dyn, "about", "counter");
        "#,
    );
}

#[test]
fn extra_caller_option_namespace_static() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_i18n_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useI18n } from "vue-i18n";
        const { t } = useI18n({ namespace: "about.counter", useScope: "global" });
        "#,
        r#"
        import _5sczV2UpZbQ from "../.intlayer/dictionaries/about.json" with { type: "json" };
        import { useDictionary as useI18n } from "vue-i18n";
        const { t } = useI18n(_5sczV2UpZbQ, { namespace: "counter", useScope: "global" });
        "#,
    );
}

#[test]
fn extra_caller_option_namespace_dropped_when_plain() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_i18n_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useI18n } from "vue-i18n";
        const { t } = useI18n({ namespace: "about" });
        "#,
        r#"
        import _5sczV2UpZbQ from "../.intlayer/dictionaries/about.json" with { type: "json" };
        import { useDictionary as useI18n } from "vue-i18n";
        const { t } = useI18n(_5sczV2UpZbQ, {});
        "#,
    );
}

#[test]
fn extra_caller_fixed_namespace_static() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_lingui_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useLingui } from "@lingui/react";
        const { t } = useLingui();
        "#,
        r#"
        import _7f0actFUfv4 from "../.intlayer/dictionaries/messages.json" with { type: "json" };
        import { useDictionary as useLingui } from "@lingui/react";
        const { t } = useLingui(_7f0actFUfv4);
        "#,
    );
}

#[test]
fn extra_caller_unresolvable_namespace_keeps_original() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_translation_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslation } from "react-i18next";
        const { t } = useTranslation("about");
        const { t: tDynamic } = useTranslation(namespace);
        "#,
        r#"
        import { useTranslation } from "react-i18next";
        const { t } = useTranslation("about");
        const { t: tDynamic } = useTranslation(namespace);
        "#,
    );
}

#[test]
fn root_scope_binds_whole_file_dictionary_when_segment_is_not_a_dictionary() {
    // `syncJSON({ splitKeys: false })` keeps one whole-file dictionary, so the
    // `about` in `t("about.grid.title")` names a group *inside* `index`, not a
    // dictionary. The binding falls back to `index` and keeps the id intact,
    // mirroring the runtime resolver.
    let mut cfg =
        get_config_with_extra_callers("static", vec![use_translations_root_scope_caller()]);
    cfg.dictionary_mode_map = Some(BTreeMap::from([(
        "index".to_string(),
        "static".to_string(),
    )]));

    test_transform(
        Syntax::default(),
        None,
        move |_| TestFolder {
            cfg: cfg.clone(),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const About = () => {
            const t = useTranslations();
            return t("about.grid.title");
        };
        "#,
        r#"
        import _Q8rtfG1AbW from "../.intlayer/dictionaries/index.json" with { type: "json" };
        import { useDictionary as useTranslations } from "next-intl";
        const About = () => {
            const t = useTranslations(_Q8rtfG1AbW);
            return t("about.grid.title");
        };
        "#,
    );
}

#[test]
fn root_scope_declines_when_no_dictionary_matches_and_no_whole_file_one_exists() {
    // No `index` dictionary to fall back on, so nothing can be bound and the
    // call site is left exactly as written.
    let mut cfg =
        get_config_with_extra_callers("static", vec![use_translations_root_scope_caller()]);
    cfg.dictionary_mode_map = Some(BTreeMap::from([(
        "footer".to_string(),
        "static".to_string(),
    )]));

    test_transform(
        Syntax::default(),
        None,
        move |_| TestFolder {
            cfg: cfg.clone(),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const About = () => {
            const t = useTranslations();
            return t("about.grid.title");
        };
        "#,
        r#"
        import { useTranslations } from "next-intl";
        const About = () => {
            const t = useTranslations();
            return t("about.grid.title");
        };
        "#,
    );
}

#[test]
fn root_scope_single_namespace_binds_the_dictionary() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers(
                "static",
                vec![use_translations_root_scope_caller()],
            ),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const Footer = () => {
            const t = useTranslations();
            return t("footer.github") + t("footer.contact");
        };
        "#,
        r#"
        import _LLEcdnHnMhk from "../.intlayer/dictionaries/footer.json" with { type: "json" };
        import { useDictionary as useTranslations } from "next-intl";
        const Footer = () => {
            const t = useTranslations(_LLEcdnHnMhk);
            return t("github") + t("contact");
        };
        "#,
    );
}

#[test]
fn root_scope_multiple_namespaces_split_into_sibling_bindings() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers(
                "static",
                vec![use_translations_root_scope_caller()],
            ),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const Header = () => {
            const t = useTranslations();
            return t("header.home") + t("footer.contact");
        };
        "#,
        r#"
        import _CphMekJRng from "../.intlayer/dictionaries/header.json" with { type: "json" };
        import _LLEcdnHnMhk from "../.intlayer/dictionaries/footer.json" with { type: "json" };
        import { useDictionary as useTranslations } from "next-intl";
        const Header = () => {
            const t = useTranslations(_CphMekJRng), _5Zzab6DhAwD_ns = useTranslations(_LLEcdnHnMhk);
            return t("home") + _5Zzab6DhAwD_ns("contact");
        };
        "#,
    );
}

#[test]
fn root_scope_with_dynamic_key_is_left_untouched() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers(
                "static",
                vec![use_translations_root_scope_caller()],
            ),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const C = ({ k }) => {
            const t = useTranslations();
            return t(k);
        };
        "#,
        r#"
        import { useTranslations } from "next-intl";
        const C = ({ k }) => {
            const t = useTranslations();
            return t(k);
        };
        "#,
    );
}

#[test]
fn scoped_call_still_wins_over_root_scope() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers(
                "static",
                vec![use_translations_root_scope_caller()],
            ),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const t = useTranslations("footer");
        "#,
        r#"
        import _LLEcdnHnMhk from "../.intlayer/dictionaries/footer.json" with { type: "json" };
        import { useDictionary as useTranslations } from "next-intl";
        const t = useTranslations(_LLEcdnHnMhk);
        "#,
    );
}

#[test]
fn root_scope_dot_less_id_binds_the_dictionary_root() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers(
                "static",
                vec![use_translations_root_scope_caller()],
            ),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslations } from "next-intl";
        const Banner = () => {
            const t = useTranslations();
            return t("mockBanner");
        };
        "#,
        r#"
        import _EZuxxcYz3WW from "../.intlayer/dictionaries/mockBanner.json" with { type: "json" };
        import { useDictionary as useTranslations } from "next-intl";
        const Banner = () => {
            const t = useTranslations(_EZuxxcYz3WW);
            return t("");
        };
        "#,
    );
}

#[test]
fn root_scope_destructured_use_translation() {
    test_transform(
        Syntax::default(),
        None,
        |_| TestFolder {
            cfg: get_config_with_extra_callers("static", vec![use_translation_root_scope_caller()]),
            filename: "/app/src/page.tsx".to_string(),
        },
        r#"
        import { useTranslation } from "react-i18next";
        const Header = () => {
            const { t } = useTranslation();
            return t("home.title");
        };
        "#,
        r#"
        import _9Wz1N8dLIVz from "../.intlayer/dictionaries/home.json" with { type: "json" };
        import { useDictionary as useTranslation } from "react-i18next";
        const Header = () => {
            const { t } = useTranslation(_9Wz1N8dLIVz);
            return t("title");
        };
        "#,
    );
}
