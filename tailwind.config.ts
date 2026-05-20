import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        canvas: "hsl(var(--canvas))",
        surface: "hsl(var(--surface))",
        elevated: "hsl(var(--elevated))",
        overlay: "hsl(var(--overlay))",

        "border-subtle": "hsl(var(--border-subtle))",
        "border-default": "hsl(var(--border-default))",
        "border-strong": "hsl(var(--border-strong))",

        "fg-primary": "hsl(var(--fg-primary))",
        "fg-secondary": "hsl(var(--fg-secondary))",
        "fg-tertiary": "hsl(var(--fg-tertiary))",
        "fg-disabled": "hsl(var(--fg-disabled))",

        accent: {
          DEFAULT: "hsl(var(--accent))",
          hover: "hsl(var(--accent-hover))",
          muted: "hsl(var(--accent-muted))",
          fg: "hsl(var(--accent-fg))",
        },

        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        live: "hsl(var(--live))",

        // shadcn compatibility
        background: "hsl(var(--canvas))",
        foreground: "hsl(var(--fg-primary))",
        border: "hsl(var(--border-default))",
        input: "hsl(var(--border-default))",
        ring: "hsl(var(--accent))",
        muted: {
          DEFAULT: "hsl(var(--elevated))",
          foreground: "hsl(var(--fg-secondary))",
        },
        popover: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--fg-primary))",
        },
        card: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--fg-primary))",
        },
        primary: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-fg))",
        },
        secondary: {
          DEFAULT: "hsl(var(--elevated))",
          foreground: "hsl(var(--fg-primary))",
        },
        destructive: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(0 0% 100%)",
        },
      },
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono Variable",
          "JetBrains Mono",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
      },
      borderRadius: {
        xs: "3px",
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
      },
      boxShadow: {
        overlay:
          "0 0 0 1px hsl(var(--border-default)), 0 8px 24px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.25)",
        "focus-ring": "0 0 0 2px hsl(var(--accent) / 0.5)",
      },
      keyframes: {
        pulseLive: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "modal-overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "modal-overlay-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "modal-content-in": {
          from: {
            opacity: "0",
            transform: "translate(-50%, calc(-50% + 10px)) scale(0.96)",
            filter: "blur(8px)",
          },
          to: {
            opacity: "1",
            transform: "translate(-50%, -50%) scale(1)",
            filter: "blur(0)",
          },
        },
        "modal-content-out": {
          from: {
            opacity: "1",
            transform: "translate(-50%, -50%) scale(1)",
            filter: "blur(0)",
          },
          to: {
            opacity: "0",
            transform: "translate(-50%, calc(-50% + 6px)) scale(0.98)",
            filter: "blur(4px)",
          },
        },
      },
      animation: {
        "pulse-live": "pulseLive 1.6s ease-in-out infinite",
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 200ms ease-out",
        "modal-overlay-in": "modal-overlay-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "modal-overlay-out": "modal-overlay-out 160ms ease-out both",
        "modal-content-in": "modal-content-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "modal-content-out": "modal-content-out 160ms ease-out both",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
