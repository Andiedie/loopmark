import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          50: "#fbfaf7",
          100: "#f4f1eb",
          200: "#e7e0d3",
          ink: "#1f1d1a",
          muted: "#706a60",
          line: "#d9d2c6",
          accent: "#2e6048",
          accentDark: "#214633",
          danger: "#b43b3b"
        }
      },
      fontFamily: {
        serif: ["Iowan Old Style", "Palatino Linotype", "Palatino", "Book Antiqua", "Georgia", "serif"],
        sans: ["Avenir Next", "Avenir", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["SFMono-Regular", "Menlo", "Consolas", "monospace"]
      },
      boxShadow: {
        paper: "0 1px 0 rgba(31, 29, 26, 0.05), 0 20px 60px rgba(31, 29, 26, 0.06)"
      }
    }
  },
  plugins: []
} satisfies Config;
