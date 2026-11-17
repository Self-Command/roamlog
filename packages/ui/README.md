# `@roamlog/ui`

Roamlog's shared design foundation: semantic CSS tokens, Tailwind helpers, accessible
primitives, and product-shell patterns. This package does not own routes, API data, or
business state.

## Consumption

In a Tailwind CSS 4 app stylesheet:

```css
@import "tailwindcss";
@import "@roamlog/ui/tokens.css";
```

The token stylesheet includes an `@source` directive for this package's primitives, so
utilities used inside `@roamlog/ui` are emitted by the consuming app's Tailwind build.

For a Tailwind config-based app, use:

```ts
import { roamlogTailwindPreset } from "@roamlog/config/tailwind-preset";

export default {
  presets: [roamlogTailwindPreset],
  content: ["./app/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
};
```

The app owns font loading through `next/font` and must expose the CSS variables named in
`fontVariableNames`. The serif, sans, and mono channels intentionally remain separate.

## Usage Rules

- One white `Button variant="primary"` per screen.
- Do not add shadows; use surface luminance and hairline borders.
- Keep page/trip/journal title sizes within 56/48/36px.
- Import `tokens.css` once at the app root and respect reduced motion globally.
- Keep product data outside these shell components.
