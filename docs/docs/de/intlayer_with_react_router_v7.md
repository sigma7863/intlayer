#### Lokalisierte Startseite

<Tabs group="routing-type">
<Tab label="Config-basiertes Routing" value="config-based">

```tsx fileName="app/routes/page.tsx"
import { getIntlayer, validatePrefix } from "intlayer";
import { useIntlayer } from "react-intlayer";
import { data } from "react-router";

import { LocaleSwitcher } from "~/components/locale-switcher";

import { Navbar } from "~/components/navbar";
import type { Route } from "./+types/page";

export const loader = ({ params }: Route.LoaderArgs) => {
  const { locale } = params;

  const { isValid } = validatePrefix(locale);

  if (!isValid) {
    throw data("Locale not supported", { status: 404 });
  }
};

export const meta: Route.MetaFunction = ({ params }) => {
  const content = getIntlayer("page", params.locale);

  return [
    { title: content.title },
    { content: content.description, name: "description" },
  ];
};

export default function Page() {
  const { title, description, aboutLink } = useIntlayer("page");

  return (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <nav>
        <LocalizedLink to="/about">{aboutLink}</LocalizedLink>
      </nav>
    </div>
  );
}
```

</Tab>
<Tab label="File-system-Routes" value="fs-routes">

```tsx fileName="app/routes/($locale)._index.tsx"
import { getIntlayer, validatePrefix } from "intlayer";
import { useIntlayer } from "react-intlayer";
import { data } from "react-router";

import { LocaleSwitcher } from "~/components/locale-switcher";

import { Navbar } from "~/components/navbar";
import type { Route } from "./+types/($locale)._index";

export const loader = ({ params }: Route.LoaderArgs) => {
  const { locale } = params;

  const { isValid } = validatePrefix(locale);

  if (!isValid) {
    throw data("Locale not supported", { status: 404 });
  }
};

export const meta: Route.MetaFunction = ({ params }) => {
  const content = getIntlayer("page", params.locale);

  return [
    { title: content.title },
    { content: content.description, name: "description" },
  ];
};

export default function Page() {
  const { title, description, aboutLink } = useIntlayer("page");

  return (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      <nav>
        <LocalizedLink to="/about">{aboutLink}</LocalizedLink>
      </nav>
    </div>
  );
}
```

</Tab>
</Tabs>

> Weitere Informationen zum `useIntlayer` Hook finden Sie in der [Dokumentation](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/packages/react-intlayer/useIntlayer.md).

> Falls Ihre App bereits vorhanden ist, können Sie den [Intlayer Compiler](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/compiler.md) sowie den [extract-Befehl](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/cli/extract.md) verwenden, um Tausende von Komponenten in einer Sekunde zu transformieren.

</Step>

<Step number={9} title="Erstellen Sie eine Locale-Switcher-Komponente">

Erstellen Sie eine Komponente, um Benutzern den Sprachwechsel zu ermöglichen:

<Tabs group="routing-type">
<Tab label="Config-basiertes Routing" value="config-based">

```tsx fileName="app/components/locale-switcher.tsx"
import type { FC } from "react";

import {
  getHTMLTextDir,
  getLocaleName,
  getLocalizedUrl,
  getPathWithoutLocale,
  defaultLocale,
} from "intlayer";
import { useIntlayer, useLocale } from "react-intlayer";
import { Link, useLocation } from "react-router";

export const LocaleSwitcher: FC = () => {
  const { localeSwitcherLabel } = useIntlayer("locale-switcher");
  const { pathname } = useLocation();

  const { availableLocales, locale, setLocale } = useLocale();

  const pathWithoutLocale = getPathWithoutLocale(pathname);

  return (
    <ol>
      {availableLocales.map((localeItem) => (
        <li key={localeItem}>
          <Link
            aria-current={localeItem === locale ? "page" : undefined}
            aria-label={`${localeSwitcherLabel.value} ${getLocaleName(localeItem)}`}
            onClick={() => setLocale(localeItem)}
            to={getLocalizedUrl(pathWithoutLocale, localeItem)}
          >
            <span>
              {/* Locale - z.B. FR */}
              {localeItem}
            </span>
            <span>
              {/* Sprache in ihrer eigenen Locale - z.B. Français */}
              {getLocaleName(localeItem, locale)}
            </span>
            <span dir={getHTMLTextDir(localeItem)} lang={localeItem}>
              {/* Sprache in aktueller Locale - z.B. Francés mit aktueller Locale auf Locales.SPANISH */}
              {getLocaleName(localeItem)}
            </span>
            <span dir="ltr" lang={defaultLocale}>
              {/* Sprache auf Englisch - z.B. French */}
              {getLocaleName(localeItem, defaultLocale)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
};
```

</Tab>
<Tab label="File-system-Routes" value="fs-routes">

```tsx fileName="app/components/locale-switcher.tsx"
import type { FC } from "react";

import {
  getHTMLTextDir,
  getLocaleName,
  getLocalizedUrl,
  getPathWithoutLocale,
  defaultLocale,
} from "intlayer";
import { useIntlayer, useLocale } from "react-intlayer";
import { Link, useLocation } from "react-router";

export const LocaleSwitcher: FC = () => {
  const { localeSwitcherLabel } = useIntlayer("locale-switcher");
  const { pathname } = useLocation();

  const { availableLocales, locale, setLocale } = useLocale();

  const pathWithoutLocale = getPathWithoutLocale(pathname);

  return (
    <ol>
      {availableLocales.map((localeItem) => (
        <li key={localeItem}>
          <Link
            aria-current={localeItem === locale ? "page" : undefined}
            aria-label={`${localeSwitcherLabel.value} ${getLocaleName(localeItem)}`}
            onClick={() => setLocale(localeItem)}
            reloadDocument // Seite neu laden, um die neue Locale anzuwenden
            to={getLocalizedUrl(pathWithoutLocale, localeItem)}
          >
            <span>
              {/* Locale - z.B. FR */}
              {localeItem}
            </span>
            <span>
              {/* Sprache in ihrer eigenen Locale - z.B. Français */}
              {getLocaleName(localeItem, locale)}
            </span>
            <span dir={getHTMLTextDir(localeItem)} lang={localeItem}>
              {/* Sprache in aktueller Locale - z.B. Francés mit aktueller Locale auf Locales.SPANISH */}
              {getLocaleName(localeItem)}
            </span>
            <span dir="ltr" lang={defaultLocale}>
              {/* Sprache auf Englisch - z.B. French */}
              {getLocaleName(localeItem, defaultLocale)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
};
```

</Tab>
</Tabs>

> Weitere Informationen zum `useLocale` Hook finden Sie in der [Dokumentation](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/packages/react-intlayer/useLocale.md).

</Step>

<Step number={10} title="HTML-Attribute-Verwaltung hinzufügen">

Erstellen Sie einen Hook zur Verwaltung von HTML lang- und dir-Attributen:

```tsx fileName="app/hooks/useI18nHTMLAttributes.tsx"
import { getHTMLTextDir } from "intlayer";
import { useEffect } from "react";
import { useLocale } from "react-intlayer";

export const useI18nHTMLAttributes = () => {
  const { locale } = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getHTMLTextDir(locale);
  }, [locale]);
};
```

Verwenden Sie es dann in Ihrer Root-Komponente:

```tsx fileName="app/routes/layout.tsx"
import { Outlet } from "react-router";
import { IntlayerProvider } from "react-intlayer";

import { useI18nHTMLAttributes } from "app/hooks/useI18nHTMLAttributes"; // Hook importieren

export default function RootLayout() {
  useI18nHTMLAttributes(); // Hook aufrufen

  return (
    <IntlayerProvider>
      <Outlet />
    </IntlayerProvider>
  );
}
```

</Step>

<Step number={11} title="Middleware hinzufügen">

Sie können auch `intlayerProxy` verwenden, um Server-seitiges Routing zu Ihrer Anwendung hinzuzufügen. Dieses Plugin erkennt automatisch die aktuelle Locale basierend auf der URL und setzt das entsprechende Locale-Cookie. Wenn keine Locale angegeben ist, bestimmt das Plugin die am besten geeignete Locale basierend auf den Spracheinstellungen des Browsers des Benutzers. Wenn keine Locale erkannt wird, wird es zur Standard-Locale weitergeleitet.

> Beachten Sie, dass Sie das `vite-intlayer` Paket von `devDependencies` zu `dependencies` verschieben müssen, um `intlayerProxy` in der Produktion zu verwenden.

> Seit Intlayer v9 ist `intlayerProxy()` direkt im `intlayer()` Plugin gebündelt und standardmäßig über die `routing.enableProxy` Option (`true` standardmäßig) aktiviert. Das separate Registrieren wie unten gezeigt ist jetzt optional – es wird aus Gründen der Rückwärtskompatibilität und für Setups, die die Plugin-Reihenfolge kontrollieren müssen, beibehalten. Setzen Sie `routing.enableProxy: false`, um zu deaktivieren. Siehe [v9 Release Notes](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/releases/v9.md).

```typescript {3,7} fileName="vite.config.ts"
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { intlayer } from "vite-intlayer";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    intlayer({
      proxy: {
        ignore: (req) => req.url?.startsWith("/api"),
      },
    }),
  ],
});
```

</Step>

<Step number={12} title="Extrahieren Sie den Inhalt Ihrer Komponenten" isOptional={true}>

Falls Sie bereits eine vorhandene Codebasis haben, kann die Transformation von Tausenden von Dateien zeitaufwendig sein.

Um diesen Prozess zu erleichtern, stellt Intlayer einen [Compiler](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/compiler.md) / [Extractor](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/cli/extract.md) bereit, um Ihre Komponenten zu transformieren und den Inhalt zu extrahieren.

Um das einzurichten, können Sie einen `compiler` Bereich in Ihrer `intlayer.config.ts` Datei hinzufügen:

```typescript fileName="intlayer.config.ts" codeFormat={["typescript", "esm", "commonjs"]}
import { type IntlayerConfig } from "intlayer";

const config: IntlayerConfig = {
  // ... Rest Ihrer Config
  compiler: {
    /**
     * Zeigt an, ob der Compiler aktiviert sein soll.
     */
    enabled: true,

    /**
     * Definiert den Ausgabedateipfad
     */
    output: ({ fileName, extension }) => `./${fileName}${extension}`,

    /**
     * Zeigt an, ob die Komponenten nach der Transformation gespeichert werden sollen.
     *
     * - Falls `true`, schreibt der Compiler die Komponentendatei auf die Festplatte. So wird die Transformation permanent, und der Compiler überspringt die Transformation beim nächsten Prozess. Auf diese Weise kann der Compiler die App transformieren und anschließend entfernt werden.
     *
     * - Falls `false`, wird der Compiler den `useIntlayer()` Funktionsaufruf nur in die Buildausgabe einfügen und die Basis-Codebasis intakt halten. Die Transformation wird nur im Speicher durchgeführt.
     */
    saveComponents: false,

    /**
     * Dictionary-Schlüssel-Präfix
     */
    dictionaryKeyPrefix: "",
  },
};

export default config;
```

<Tabs>
 <Tab value='Extract-Befehl'>

Führen Sie den Extractor aus, um Ihre Komponenten zu transformieren und den Inhalt zu extrahieren

```bash packageManager="npm"
npx intlayer extract
```

```bash packageManager="pnpm"
pnpm intlayer extract
```

```bash packageManager="yarn"
yarn intlayer extract
```

```bash packageManager="bun"
bun x intlayer extract
```

 </Tab>
 <Tab value='Babel-Compiler'>

> Seit v9 ist der `intlayerCompiler` im `intlayer` Plugin enthalten. Sie müssen ihn also nicht manuell hinzufügen.

Aktualisieren Sie Ihre `vite.config.ts`, um das `intlayerCompiler` Plugin einzuschließen:

```ts fileName="vite.config.ts"
import { defineConfig } from "vite";
import { intlayer, intlayerCompiler } from "vite-intlayer";

export default defineConfig({
  plugins: [
    intlayer(),
    intlayerCompiler(), // Fügt das Compiler-Plugin hinzu
  ],
});
```

```bash packageManager="npm"
npm run build # Oder npm run dev
```

```bash packageManager="pnpm"
pnpm run build # Oder pnpm run dev
```

```bash packageManager="yarn"
yarn build # Oder yarn dev
```

```bash packageManager="bun"
bun run build # Oder bun run dev
```

 </Tab>
</Tabs>

</Step>

</Steps>

## TypeScript konfigurieren

Intlayer verwendet module augmentation, um die Vorteile von TypeScript zu nutzen und Ihre Codebase zu stärken.

Stellen Sie sicher, dass Ihre TypeScript-Konfiguration die automatisch generierten Typen enthält:

```json5 fileName="tsconfig.json"
{
  // ... Ihre vorhandenen Konfigurationen
  include: [
    // ... Ihre vorhandenen includes
    ".intlayer/**/*.ts", // Include the auto-generated types
  ],
}
```

## Git-Konfiguration

Es wird empfohlen, die von Intlayer generierten Dateien zu ignorieren. Dies ermöglicht es Ihnen, zu vermeiden, dass diese in Ihr Git-Repository committed werden.

Dazu können Sie die folgenden Anweisungen zu Ihrer `.gitignore`-Datei hinzufügen:

```plaintext fileName=".gitignore"
# Von Intlayer generierte Dateien ignorieren
.intlayer
```

## VS Code Extension

Um Ihre Entwicklungserfahrung mit Intlayer zu verbessern, können Sie die offizielle **Intlayer VS Code Extension** installieren.

[Installieren Sie es vom VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=intlayer.intlayer-vs-code-extension)

Diese Extension bietet:

- **Autocompletion** für Übersetzungsschlüssel.
- **Echtzeit-Fehlererkennung** für fehlende Übersetzungen.
- **Inline-Vorschau** des übersetzten Inhalts.
- **Quick Actions** zum einfachen Erstellen und Aktualisieren von Übersetzungen.

Weitere Details zur Verwendung der Extension finden Sie in der [Intlayer VS Code Extension-Dokumentation](https://intlayer.org/doc/vs-code-extension).

## Weiter geht's

Um noch tiefer einzusteigen, kannst du den [visuellen Editor](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/intlayer_visual_editor.md) implementieren oder deinen Inhalt mit dem [CMS](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/intlayer_CMS.md) externalisieren.

## Dokumentationsreferenzen

- [Intlayer Documentation](https://intlayer.org)
- [React Router v7 Documentation](https://reactrouter.com/)
- [useIntlayer hook](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/packages/react-intlayer/useIntlayer.md)
- [useLocale hook](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/packages/react-intlayer/useLocale.md)
- [Content Declaration](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/dictionary/content_file.md)
- [Configuration](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/configuration.md)

Dieser umfassende Leitfaden bietet alles, was Sie benötigen, um Intlayer mit React Router v7 für eine vollständig internationalisierte Anwendung mit locale-aware Routing und TypeScript-Unterstützung zu integrieren.

## Häufig gestellte Fragen

<FAQ>

<Question title="Welche verschiedenen Lösungen stehen zur Verfügung, um eine React Router v7 App zu internationalisieren?">

React Router v7 wird ohne Message Layer ausgeliefert, daher kombinieren Sie es mit einer i18n-Bibliothek:

- **`react-i18next` / `i18next`**: JSON-Namespaces, die zur Laufzeit geladen werden, mit einem separaten Locale-Detektor zum Verbinden mit dem Router.
- **`react-intl`** und **`Lingui`**: ICU-Nachrichten mit einem Extraktionsschritt.
- **`Intlayer`**: die fortschrittlichste Lösung. Inhalte werden überall in Ihrer Codebase deklariert ([neben jeder Komponente oder zentralisiert](https://intlayer.org/blog/per-component-vs-centralized-i18n)), zur Build-Zeit kompiliert, durchgehend typisiert, mit Locale-aware Routing-Helfer, AI-Übersetzung, einem visuellen Editor und einem CMS.

Siehe [warum Intlayer](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/interest_of_intlayer.md) und das [Benchmark](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/benchmark/index.md).

</Question>

<Question title="Wie viel fügt i18n zur Bundle-Größe meiner React Router App hinzu?">

Deutlich weniger als ein Namespace-basiertes Setup, da eine Seite nie einen Katalog herunterlädt, den sie nicht rendert. Server-gerenderte Markup werden auf dem Server aufgelöst, und der Build-Zeit-Compiler ersetzt `useIntlayer`-Aufrufe durch die exakten Dictionary-Einträge, die eine Komponente verwendet. Daher werden ungenutzte Schlüssel und ungenutzte Sprachen gelöscht, und [dynamische Wörterbücher](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/dynamic_dictionaries/index.md) teilen den Rest pro Locale auf. Im Vergleich zu den üblichen Alternativen reduziert Intlayer die Bundle- und Seitengröße um bis zu 50 %. Siehe [Bundle-Optimierung](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/bundle_optimization.md) und das [Benchmark](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/benchmark/index.md).

</Question>

<Question title="Kann ich von `react-i18next` oder `react-intl` migrieren, ohne meine Komponenten umzuschreiben?">

Ja, und es gibt zwei Wege. Sie können den Inhalt schrittweise mit der [react-i18next Migrationsleitfaden](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/migration_from_react-i18next_to_intlayer.md) oder dem [i18next Migrationsleitfaden](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/migration_from_i18next_to_intlayer.md) migrieren. Oder Sie behalten Ihre aktuelle API vollständig bei: die [Kompatibilitätsadapter](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/compat/index.md) stellen dieselbe API wie `react-i18next`, `react-intl` und `i18next` bereit, aber bedient durch Intlayer-Wörterbücher, sodass sich nur die Importe ändern und der Komponenten-Code nicht.

</Question>

<Question title="Kann ich meine bestehenden JSON-Übersetzungsdateien behalten?">

Ja. Das [Sync JSON Plugin](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/plugins/sync-json.md) behält Ihre `/messages/{locale}/{namespace}.json`-Dateien als Single Source of Truth und generiert Intlayer-Wörterbücher daraus, in beide Richtungen. Ein [Sync PO Plugin](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/plugins/sync-po.md) macht dasselbe für Gettext-Kataloge, und [Pro-Locale-Dateien](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/per_locale_file.md) ermöglichen es Ihnen, Inhalte nach Sprache zu teilen, anstatt Locales in einer Datei zu gruppieren.

</Question>

<Question title="Muss ich meinen Inhalt Schlüssel für Schlüssel verschieben?">

Nein. Führen Sie `npx intlayer extract` aus und Intlayer liest Ihre Komponenten, extrahiert die benutzerorientierten Strings und schreibt eine `.content`-Datei neben jede, sodass Sie einen Diff überprüfen, anstatt Strings einzeln in einen Katalog zu kopieren. Schritt 12 dieser Anleitung beschreibt dies ausführlich.

Für eine vollständig automatisierte Pipeline macht der [Intlayer Compiler](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/compiler.md) dasselbe zur Build-Zeit: er scannt bei jeder Änderung Ihre JSX-, TSX-, Vue- und Svelte-Quellen, generiert die Wörterbücher und hält sie durch Hot-Module-Replacement in Sync, sodass es keine Schlüssel gibt, die Sie von Hand pflegen müssen.

Zwei Grenzen sind es wert, vor dem Einschalten des Compilers bekannt zu sein. Er funktioniert durch statische Analyse, daher bleiben Strings, die nur zur Laufzeit existieren, wie API-Fehlercodes oder CMS-Felder, unerreichbar. Und er muss benutzerorientierte Texte von Anwendungslogik wie `className="active"` oder einem Statuscode unterscheiden, was in einer großen Codebase einige Annotationen erfordert. Der [extract-Befehl](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/cli/extract.md) vermeidet beides, indem er Sie in der Schleife hält.

</Question>

<Question title="Welche Editor- und AI-Agent-Tools sind verfügbar?">

Fünf Komponenten, alle optional:

- **[VS Code Extension](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/vs_code_extension.md)**: Springen Sie von einem `useIntlayer`-Schlüssel zur Inhaltsdatei, die ihn deklariert, extrahieren Sie Inhalte aus einer Komponente, und führen Sie Build, Fill, Test, Push und Pull aus der Befehlspalette oder einem dedizierten Intlayer-Tab aus.
- **[LSP-Server](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/lsp.md)**: dieselbe Awareness in jedem Editor, der LSP spricht, mit Goto Definition, Find All References, Hover-Vorschauen eines übersetzten Werts, Autovervollständigung von Schlüsseln und Feldern, und eine Warnung, wenn ein Schlüssel nirgendwo deklariert ist. Er löst auch `i18next`-, `react-i18next`-, `next-intl`- und `use-intl`-Aufrufe auf, was während der Migration hilft.
- **[MCP-Server](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/mcp_server.md)**: stellt die Intlayer-Dokumentation und CLI für Cursor, VS Code, Claude Desktop, Claude Code und ChatGPT bereit, sodass ein Assistent aus aktuellen Dokumenten antwortet, anstatt zu raten, und Befehle wie `intlayer fill` selbst ausführen kann.
- **[Agent Skills](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/agent_skills.md)**: fokussierte Skills wie `intlayer-config`, `intlayer-cli` und `intlayer-content`, plus einer pro Framework, die einem Agent Ihr Routing-Setup und die Inhaltsknoten-Typen beibringen.
- **[ESLint Plugin](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/eslint.md)**: `no-raw-text` kennzeichnet hartcodierte Strings, mit weiteren Regeln für statische Dictionary-Schlüssel und ungenutzten Inhalt.

</Question>

<Question title="Wie füge ich ein Locale-Segment zu meinen Routen hinzu?">

Deklarieren Sie ein `:locale`-Segment auf Ihrem Route-Tree und lassen Sie Intlayer es auflösen. `validatePrefix` teilt Ihnen mit, ob das Segment ein deklariertes Locale ist, daher gibt ein unbekanntes Präfix einen 404 zurück, anstatt eine doppelte Seite zu rendern, und `getLocalizedUrl` schreibt jeden Pfad in die Zielsprache um. Wenn Sie Dateisystem-Routen verwenden, stellen Sie das `($locale)` dynamische Segment in Ihren Route-Dateinamen voran.

</Question>

<Question title="Muss ich das Locale in die URL einfügen?">

Nein. `routing.mode` akzeptiert `"prefix-no-default"` (Standard), `"prefix-all"`, `"no-prefix"` und `"search-params"`, und `routing.domains` ordnet ein Locale seiner eigenen Domäne zu. Das Locale wird trotzdem in einem Cookie persistiert. Siehe die [Konfigurationsreferenz](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/configuration.md).

</Question>

<Question title="Funktioniert es mit React Router im Framework-Modus, mit SSR und Loadern?">

Ja. Inhalte werden während des Server-Rendering aufgelöst, und das aktive Locale ist in Loaders und Actions verfügbar, sodass Server-Daten im gleichen Durchlauf wie die Seite lokalisiert werden können. Client-Navigation behält das Locale ohne vollständiges Neuladen bei.

</Question>

<Question title="Wie füge ich hreflang-Tags für SEO hinzu?">

Erstellen Sie die Alternates-Karte mit `getMultilingualUrls` und geben Sie sie aus dem Route `meta` oder `links` Export aus, einschließlich eines `x-default`-Eintrags. Der gleiche Helper speist eine lokalisierte `sitemap.xml`.

</Question>

<Question title="Wie baue ich einen Sprachschalter, der auf der aktuellen Seite bleibt?">

Verwenden Sie `useLocale` für die aktiven und verfügbaren Locales und `getLocalizedUrl`, um den aktuellen Pfad in das Ziel-Locale zu übersetzen. Der Benutzer bleibt auf der gleichen Route, anstatt zur Homepage zurückgesendet zu werden, was auch verhindert, dass die Scroll-Position und Query-Parameter verloren gehen.

</Question>

<Question title="Wie übersetze ich die App automatisch mit AI?">

Führen Sie `npx intlayer fill` aus, das fehlende Übersetzungen mit dem LLM Ihrer Wahl mit Ihrem eigenen Provider und API-Schlüssel ausfüllt. Siehe den [fill-Befehl](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/cli/fill.md) und die [CI/CD-Integration](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/CI_CD.md).

</Question>

<Question title="Unterstützt Intlayer Plurale, Geschlecht und Rich Text?">

Ja: [Pluralformen](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/dictionary/plurial.md), [geschlechtsspezifische Inhalte](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/dictionary/gender.md), Bedingungen, [Insertionen](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/dictionary/insertion.md), [Markdown](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/dictionary/markdown.md) und [Formatter](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/formatters.md) für Zahlen, Daten und Währungen.

</Question>

<Question title="Wie können Übersetzer den Inhalt bearbeiten, ohne den Code zu berühren?">

Durch den selbst gehosteten [visuellen Editor](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/intlayer_visual_editor.md) oder das [CMS](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/intlayer_CMS.md), das Inhalte externalisiert, sodass sie sich ohne Deployment ändern können.

</Question>

<Question title="Ist Intlayer kostenlos und Open Source?">

Ja, unter der Apache-2.0-Lizenz, kommerzielle Nutzung inbegriffen. Das gehostete CMS ist ein optionaler kostenpflichtiger Service, der auch [selbst gehostet](https://github.com/aymericzip/intlayer/blob/main/docs/docs/de/self_hosting.md) werden kann.

</Question>

</FAQ>
