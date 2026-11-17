export const roamlogTailwindPreset = {
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        "surface-1": "var(--surface-1)",
        "surface-2": "var(--surface-2)",
        "surface-deep": "var(--surface-deep)",
        ink: "var(--ink)",
        body: "var(--body)",
        muted: "var(--muted)",
        ash: "var(--ash)",
        stone: "var(--stone)",
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        divider: "var(--divider)",
        "accent-orange": "var(--accent-orange)",
        "accent-blue": "var(--accent-blue)",
        "accent-green": "var(--accent-green)",
        "accent-red": "var(--accent-red)",
        "accent-yellow": "var(--accent-yellow)",
        "accent-slate": "var(--accent-slate)",
      },
      borderRadius: {
        card: "var(--roamlog-radius-card)",
        control: "var(--roamlog-radius-control)",
        pill: "var(--roamlog-radius-pill)",
      },
      fontFamily: {
        sans: ["var(--roamlog-font-sans)"],
        serif: ["var(--roamlog-font-serif)"],
        mono: ["var(--roamlog-font-mono)"],
      },
      fontSize: {
        "page-title": [
          "var(--roamlog-text-page-title)",
          { lineHeight: "1.1", letterSpacing: "-0.035em" },
        ],
        "trip-title": [
          "var(--roamlog-text-trip-title)",
          { lineHeight: "1.1", letterSpacing: "-0.035em" },
        ],
        "journal-title": [
          "var(--roamlog-text-journal-title)",
          { lineHeight: "1.12", letterSpacing: "-0.025em" },
        ],
        meta: ["0.625rem", { lineHeight: "1.4", letterSpacing: "0.12em" }],
      },
      letterSpacing: {
        display: "-0.035em",
        meta: "0.12em",
      },
      maxWidth: {
        content: "75rem",
        reading: "60rem",
        "form-narrow": "26.25rem",
      },
    },
  },
};

export default roamlogTailwindPreset;
