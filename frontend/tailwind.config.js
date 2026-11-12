/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      keyframes: {
        "ring-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(249,115,22,0.65)" },
          "70%": { boxShadow: "0 0 0 14px rgba(249,115,22,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(249,115,22,0)" },
        },
      },
      animation: { "ring-pulse": "ring-pulse 1.6s ease-out infinite" },
      fontFamily: {
        sans: ["Inter", "Noto Sans Malayalam", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
