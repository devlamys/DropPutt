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
        // Customer storefront only.
        display: ["Poppins", "Inter", "Noto Sans Malayalam", "system-ui", "sans-serif"],
      },
      colors: {
        // Storefront palette: deep kitchen green + warm orange.
        pine: {
          50: "#F2F6F3",
          100: "#DFE9E3",
          200: "#BFD2C7",
          300: "#94B3A2",
          400: "#6A9480",
          500: "#4D7763",
          600: "#3C5F4F",
          700: "#324E41",
          800: "#2A4237",
          900: "#1C3027",
          950: "#0F2018",
        },
        flame: {
          50: "#FFF5EA",
          100: "#FFE7CF",
          200: "#FFCF9F",
          300: "#FFB066",
          400: "#FA9535",
          500: "#F27F1B",
          600: "#D96A08",
          700: "#B45607",
          800: "#8C440A",
          900: "#6E370C",
        },
      },
    },
  },
  plugins: [],
};
