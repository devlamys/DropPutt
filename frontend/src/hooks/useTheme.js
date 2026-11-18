import { useEffect } from "react";

const BROWSER_BAR = { mart: "#039855" };

/** Re-colours the whole page (overlays and sheets included) while mounted. `theme` null = the default red-orange. */
export function useTheme(theme) {
  useEffect(() => {
    if (!theme) return undefined;
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = meta?.getAttribute("content");
    root.dataset.theme = theme;
    if (meta && BROWSER_BAR[theme]) meta.setAttribute("content", BROWSER_BAR[theme]);
    return () => {
      delete root.dataset.theme;
      if (meta && before) meta.setAttribute("content", before);
    };
  }, [theme]);
}
