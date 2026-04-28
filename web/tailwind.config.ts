import type { Config } from "tailwindcss";

export default {
  theme: {
    extend: {
      /* ── Font Families ── */
      fontFamily: {
        sans: ["Pretendard", "sans-serif"],
        heading: ["Pretendard", "sans-serif"],
      },

      /* ── Typography Scale ── */
      fontSize: {
        "3xs": ["0.5625rem", { lineHeight: "0.75rem" }],
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },

      /* ── Letter Spacing ── */
      letterSpacing: {
        caps: "0.15em",
        "caps-wide": "0.2em",
        "caps-wider": "0.25em",
        "caps-widest": "0.3em",
      },

      /* ── Spacing ── */
      spacing: {
        sidebar: "17.25rem",
      },

      /* ── Layout ── */
      maxWidth: {
        shell: "100rem",
      },
      gridTemplateColumns: {
        detail: "1.1fr 0.9fr",
        inspector: "minmax(0,1.2fr) minmax(320px,0.8fr)",
        workspace: "minmax(0,1.6fr) minmax(360px,1fr)",
      },
      gridTemplateRows: {
        preview: "minmax(0,0.95fr) minmax(0,1.05fr)",
      },
    },
  },
} satisfies Config;
