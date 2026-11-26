# Third-party notices

Roamlog bundles its font files locally through Fontsource packages. No font is
loaded from Google Fonts or another CDN at runtime.

The full SIL Open Font License 1.1 texts are copied under
`packages/ui/src/styles/font-licenses/`.

| Family           | Fontsource package                    | Version | License | License text                         |
| ---------------- | ------------------------------------- | ------- | ------- | ------------------------------------ |
| Instrument Serif | `@fontsource/instrument-serif`        | 5.3.0   | OFL-1.1 | `font-licenses/instrument-serif.txt` |
| Geist            | `@fontsource-variable/geist`          | 5.3.0   | OFL-1.1 | `font-licenses/geist.txt`            |
| Geist Mono       | `@fontsource-variable/geist-mono`     | 5.3.0   | OFL-1.1 | `font-licenses/geist-mono.txt`       |
| Noto Sans SC     | `@fontsource-variable/noto-sans-sc`   | 5.3.1   | OFL-1.1 | `font-licenses/noto-sans-sc.txt`     |
| Noto Serif SC    | `@fontsource-variable/noto-serif-sc`  | 5.3.1   | OFL-1.1 | `font-licenses/noto-serif-sc.txt`    |
| Newsreader       | `@fontsource-variable/newsreader`     | 5.3.0   | OFL-1.1 | `font-licenses/newsreader.txt`       |
| Manrope          | `@fontsource-variable/manrope`        | 5.3.0   | OFL-1.1 | `font-licenses/manrope.txt`          |
| Inter            | `@fontsource-variable/inter`          | 5.3.0   | OFL-1.1 | `font-licenses/inter.txt`            |
| Fraunces         | `@fontsource-variable/fraunces`       | 5.3.0   | OFL-1.1 | `font-licenses/fraunces.txt`         |
| JetBrains Mono   | `@fontsource-variable/jetbrains-mono` | 5.3.0   | OFL-1.1 | `font-licenses/jetbrains-mono.txt`   |
| Mona Sans        | `@fontsource-variable/mona-sans`      | 5.3.0   | OFL-1.1 | `font-licenses/mona-sans.txt`        |
| IBM Plex Sans    | `@fontsource-variable/ibm-plex-sans`  | 5.3.0   | OFL-1.1 | `font-licenses/ibm-plex-sans.txt`    |
| IBM Plex Mono    | `@fontsource/ibm-plex-mono`           | 5.3.0   | OFL-1.1 | `font-licenses/ibm-plex-mono.txt`    |

Upstream projects:

- Instrument Serif: https://github.com/Instrument/instrument-serif
- Geist: https://github.com/vercel/geist-font
- Noto CJK: https://github.com/notofonts/noto-cjk
- Newsreader: https://github.com/productiontype/Newsreader
- Manrope: https://github.com/sharanda/manrope
- Inter: https://github.com/rsms/inter
- Fraunces: https://github.com/undercasetype/Fraunces
- JetBrains Mono: https://github.com/JetBrains/JetBrainsMono
- Mona Sans: https://github.com/github/mona-sans
- IBM Plex: https://github.com/IBM/plex

LXGW WenKai is intentionally not bundled in the first release because of its
large package footprint.

Fluent's Segoe UI stack is a system-font fallback and is not redistributed.
`font-licenses/fluent-system.txt` records that boundary.

### Enterprise theme token sources

| Source | Revision/version | License | Role |
| --- | --- | --- | --- |
| `primer/primitives` | `11.10.0` (`3f51f80ee9510974032917c9b8ac9586656c88bc`) | MIT | Default enterprise palette, focus, radius and shadow roles |
| `@fluentui/react-theme` | `9.2.2` (`2dd2a9a96210919c35b210a1aa8e873ab67dbada`) | MIT | Fluent 2 neutral, brand and status roles |
| `@carbon/themes` | `11.86.0` (`4c2a5622e18ba209282ca0d70c23b1b34be8dc8e`) | Apache-2.0 | Carbon White/Gray 10/90/100 roles |
| `@carbon/type` | `11.71.0` | Apache-2.0 | Plex typography scale and font families |
| `tweakcn` | `a3b47b37cba97dd637de517aab52c45ec0f83456` | Apache-2.0 | Mist/Geist/Sandstone neutral, accent and radius roles |
| `radix-ui/colors` | `dbdb85470547c7d34b9001f48fddb08ded335979` | MIT | Iris/mauve and shared status roles |

Roamlog copies token values into its own semantic variables. It does not add a
Primer, Fluent, Carbon, tweakcn or Radix runtime dependency. The Apache-2.0
license text for the tweakcn source is the same license already copied at
`LICENSES/vercel-chatbot-Apache-2.0.txt`; the Radix source is MIT and is listed
with its pinned revision in the table above.

## Modified source ports

### vercel/chatbot

- Source: https://github.com/vercel/chatbot
- Revision: `a8989b522fa3672a2ae52f053105e40993b36ca1`
- License: Apache-2.0
- Copied license notice: `LICENSES/vercel-chatbot-Apache-2.0.txt`
- Modified areas: the AI conversation shell, message actions/editor, composer,
  model selector, conversation history, resumable stream integration,
  Artifact/Document panel and server-side artifact tools. Roamlog adaptations
  replace Vercel AI SDK persistence/NextAuth/Vercel Blob with assistant-ui,
  Better Auth, NestJS, Prisma and the Roamlog media pipeline. Each ported file
  carries the upstream path, revision and a description of its local changes.

### assistant-ui

- Source: https://github.com/assistant-ui/assistant-ui
- Revision: `4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc`
- License: MIT
- Copied license notice: `LICENSES/assistant-ui-MIT.txt`
- Modified areas: the `"use generative"` toolkit/runtime integration
  (`@assistant-ui/next` and `@assistant-ui/x-generative-compiler`), generic
  `ask_user` / `confirm_brief` human tools, multi-question validation,
  `requires-action` pause/resume, and the human-tool renderer registration.
  Roamlog adaptations replace the upstream example transport and fixed
  contact/date schemas with its NestJS SSE adapter and contract-backed generic
  question schemas. The compiler, `humanTool()` marker, `defineToolkit`,
  `addResult` and local-runtime pause/resume semantics are used as published
  upstream. Each ported file carries its upstream path and revision.

### vercel/ai-elements

- Source: https://github.com/vercel/ai-elements
- Revision: `ca8be600bfd01b3131f9bf6134b51602a71f4374`
- License: Apache-2.0
- Copied license notice: `LICENSES/vercel-ai-elements-Apache-2.0.txt`
- Modified areas: `Question`, `Plan`, `ChainOfThought` and `Confirmation`
  presentation primitives used by the assistant workflow and plan surface.
  Roamlog adaptations replace shadcn imports and design tokens with local
  `@roamlog/ui` components and Roamlog color tokens; component state,
  keyboard/accessibility behavior and render branches are retained. Each ported
  file carries its upstream path and revision.

### models.dev

- Source: https://github.com/anomalyco/models.dev
- Revision: `5192a691eea9a5e890caa31ec47983a2da31f7e6`
- License: MIT
- Copied license notice: `LICENSES/models-dev-MIT.txt`
- Usage: the generated reasoning-effort snapshot under
  `apps/api/src/common/data/models-dev-reasoning.generated.ts` is produced from
  `https://models.dev/api.json` by
  `tooling/scripts/generate-ai-model-capabilities.mjs`. It contains only model
  ids, canonical ids and `reasoning_options` effort values; no upstream code is
  executed at runtime.
