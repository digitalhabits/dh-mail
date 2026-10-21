import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

/*
 * Mail's colours follow the Centre for Digital Habits design system
 * (Claude Design; Ulrik, 2026-10-21).
 *
 * Text is the system's ink, #1B3D4A, never warm black. Mail writes its
 * text as `text-stone-*` in some 1,400 places, so the stone shades are
 * changed for text alone: fills and borders keep their warm greys, which
 * sit well on the cream. The middle shades are the system's ink-soft
 * (80%) and ink-muted (72%), laid over the cream as solid colours, so a
 * `/70` after a class still works. The lightest shades are for text on
 * dark grounds and stay as they were.
 */
const INK_TEXT = {
  ...colors.stone,
  300: "#9ea9aa", // ink 40%: the faintest asides
  400: "#7d8e92", // ink 55%: placeholders, times
  500: "#586f77", // ink-muted 72%: captions, dates
  600: "#47616a", // ink-soft 80%: secondary text
  700: "#314f5a", // ink 90%
  800: "#1b3d4a", // ink
  900: "#1b3d4a", // ink
  950: "#122a33",
};

/*
 * Hairlines are the system's `rule`: ink at 8 to 28%, laid over the cream.
 * Mail draws its borders as `border-stone-*`, so these are the stone
 * shades for borders alone.
 */
const INK_RULE = {
  ...colors.stone,
  100: "#e4e3dd", // ink 8%: a white card's edge
  200: "#dbdbd7", // ink 12%
  300: "#d2d4d0", // ink 16%: rule
  400: "#b8bfbd", // ink 28%: an outline pill
  500: "#93a0a2", // ink 45%
};

/*
 * Fills on the cream: the system's sand family. `bg-stone-50` is the
 * system's field ground, 100 a hover between cream and sand, 200 sand
 * itself; the dark end is ink, for a tooltip or the one callout.
 */
const SAND_FILL = {
  ...colors.stone,
  50: "#f8f6f1",
  100: "#efeae2",
  200: "#e9e4da",
  300: "#ddd6ca",
  400: "#c9c0b1",
  800: "#234b59",
  900: "#1b3d4a",
  950: "#122a33",
};

/*
 * The system's error colour, #B4432E, for destructive actions and error
 * words. Mail writes it as `red-*`.
 */
const ERROR_RED = {
  ...colors.red,
  50: "#faf4f2",
  100: "#f6e8e6",
  200: "#ecd0cb",
  500: "#c4573f",
  600: "#b4432e",
  700: "#9a3826",
  800: "#7d2e20",
};

/*
 * The accent is the system's green, #005D53, where Mail had teal. The
 * scale keeps Tailwind's steps, so `bg-teal-600` (buttons) is the green,
 * `text-teal-700` (links) a step darker, and the pale steps are tints of
 * it; 300 is the system's mint.
 */
const BRAND_GREEN = {
  50: "#eff8f5",
  100: "#dbf0ea",
  200: "#bfe5dc",
  300: "#a7ded2",
  400: "#5fb3a4",
  500: "#2a8a7d",
  600: "#005d53",
  700: "#004d45",
  800: "#003f39",
  900: "#00332e",
  950: "#001f1c",
};

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/shared/**/*.{js,ts,jsx,tsx,mdx}",
    "../../products/mail/packages/mail/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // The system's two faces: Schibsted Grotesk for text (bundled, see
        // standalone.css), Georgia for headings.
        serif: ["Georgia", '"Times New Roman"', "serif"],
        sans: [
          '"Schibsted Grotesk"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      textColor: {
        stone: INK_TEXT,
      },
      borderColor: {
        stone: INK_RULE,
      },
      backgroundColor: {
        stone: SAND_FILL,
        // A green button turns ink under the pointer, as the system's
        // primary button does: `hover:bg-teal-700` is ink for fills.
        teal: { ...BRAND_GREEN, 700: "#1b3d4a", 800: "#122a33" },
      },
      colors: {
        teal: BRAND_GREEN,
        red: ERROR_RED,
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        navy: {
          DEFAULT: "hsl(var(--navy))",
          light: "hsl(var(--navy-light))",
        },
        /** Brand navy and teal. */
        brandNavy: "#1e2d3e",
        brandTeal: "#2a9d8f",
        cream: "hsl(var(--cream))",
        "cream-hero": "#faf8f5",
        "cream-section": "var(--cream-section)",
        "warm-grey": "hsl(var(--warm-grey))",
      },
      borderRadius: {
        /*
          Mail's four corners, the design system's (2026-10-21): 6px for
          buttons and fields, 8px for cards and panels, 12px for the one
          large raised thing. Nested ones step down, so the gap stays even.
            inner    4px   small things inside a control; screenshots
            control  6px   buttons, fields, tabs, menu rows, answer rows
            surface  8px   menus, popovers, cards, tab tracks, pictures
            dialog  12px   dialogs and large sheets
          Pills (rounded-full) for tabs, chips, badges and what is round by
          nature: avatars, dots, switches.
        */
        inner: "4px",
        control: "6px",
        surface: "8px",
        dialog: "12px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
