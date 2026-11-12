import { useCallback, useEffect, useRef, useState } from "react";

/** Tiny toast helper: const { toast, node } = useToast(); render {node}. */
export function useToast() {
  const [item, setItem] = useState(null);
  const timer = useRef(null);
  const toast = useCallback((message, type = "info") => {
    clearTimeout(timer.current);
    setItem({ message, type });
    timer.current = setTimeout(() => setItem(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const colors = {
    info: "bg-slate-900 text-white",
    success: "bg-green-600 text-white",
    error: "bg-red-600 text-white",
    warn: "bg-amber-500 text-slate-900",
  };
  const node = item && (
    <div
      role="status"
      className={`fixed inset-x-4 top-4 z-[60] mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${colors[item.type]}`}
    >
      {item.message}
    </div>
  );
  return { toast, node };
}
