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

Upstream projects:

- Instrument Serif: https://github.com/Instrument/instrument-serif
- Geist: https://github.com/vercel/geist-font
- Noto CJK: https://github.com/notofonts/noto-cjk
- Newsreader: https://github.com/productiontype/Newsreader
- Manrope: https://github.com/sharanda/manrope
- Inter: https://github.com/rsms/inter
- Fraunces: https://github.com/undercasetype/Fraunces
- JetBrains Mono: https://github.com/JetBrains/JetBrainsMono

LXGW WenKai is intentionally not bundled in the first release because of its
large package footprint.
