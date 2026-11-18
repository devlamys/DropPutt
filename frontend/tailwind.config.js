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
          "0%": { boxShadow: "0 0 0 0 rgba(232,67,26,0.65)" },
          "70%": { boxShadow: "0 0 0 14px rgba(232,67,26,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(232,67,26,0)" },
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
        // Brand palette: DropPutt red-orange (flame) + deep kitchen green (pine, storefront chrome).
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
        // Red-orange by default; the Mart switches these variables to green (see index.css).
        flame: {
          50: "rgb(var(--flame-50) / <alpha-value>)",
          100: "rgb(var(--flame-100) / <alpha-value>)",
          200: "rgb(var(--flame-200) / <alpha-value>)",
          300: "rgb(var(--flame-300) / <alpha-value>)",
          400: "rgb(var(--flame-400) / <alpha-value>)",
          500: "rgb(var(--flame-500) / <alpha-value>)",
          600: "rgb(var(--flame-600) / <alpha-value>)",
          700: "rgb(var(--flame-700) / <alpha-value>)",
          800: "rgb(var(--flame-800) / <alpha-value>)",
          900: "rgb(var(--flame-900) / <alpha-value>)",
        },
        // The whole app (rider, vendor, admin, login) shares the brand red-orange.
        orange: {
          50: "#FFF1EC",
          100: "#FFDFD3",
          200: "#FFBFA6",
          300: "#FF9774",
          400: "#F56A41",
          500: "#E8431A",
          600: "#D93A12",
          700: "#B02E0E",
          800: "#8A250E",
          900: "#6C1F0F",
        },
      },
    },
  },
  plugins: [],
};
