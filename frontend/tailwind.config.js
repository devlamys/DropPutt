/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      keyframes: {
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: { "0%": { transform: "scale(1)" }, "45%": { transform: "scale(1.14)" }, "100%": { transform: "scale(1)" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
        "check-draw": { to: { strokeDashoffset: "0" } },
        "scale-in": { from: { transform: "scale(0.6)", opacity: "0" }, to: { transform: "scale(1)", opacity: "1" } },
        "ring-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(249,115,22,0.65)" },
          "70%": { boxShadow: "0 0 0 14px rgba(249,115,22,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(249,115,22,0)" },
        },
      },
      animation: {
        "ring-pulse": "ring-pulse 1.6s ease-out infinite",
        "sheet-up": "sheet-up 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
        "fade-in": "fade-in 0.2s ease-out",
        pop: "pop 0.25s ease-out",
        shimmer: "shimmer 1.4s linear infinite",
        "check-draw": "check-draw 0.5s 0.25s ease-out forwards",
        "scale-in": "scale-in 0.35s cubic-bezier(0.2, 1.4, 0.4, 1)",
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans Malayalam", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
