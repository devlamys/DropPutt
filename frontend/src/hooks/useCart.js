import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "dropputt.cart";

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    if (parsed && parsed.vendor_id && Array.isArray(parsed.lines)) return parsed;
  } catch {
    /* ignore */
  }
  return { vendor_id: null, shop_name: "", lines: [] };
}

/**
 * One-shop cart (checkout orders from a single vendor). Lines keep only
 * product_id, quantity, and display data — prices are shown for the customer,
 * the server re-prices every line.
 */
export function useCart() {
  const [cart, setCart] = useState(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart));
    } catch {
      /* private mode: the cart still works for this visit */
    }
  }, [cart]);

  /** Returns false when the product belongs to another shop (cart untouched). */
  const add = useCallback(
    (product, shop_name) => {
      // Decided from the current render's cart: a state updater runs later,
      // so it cannot report back synchronously.
      if (cart.vendor_id && cart.vendor_id !== product.vendor_id && cart.lines.length) return false;
      setCart((current) => {
        const lines = [...current.lines];
        const index = lines.findIndex((l) => l.product_id === product.id);
        if (index >= 0) {
          lines[index] = { ...lines[index], quantity: Math.min(99, lines[index].quantity + 1) };
        } else {
          lines.push({ product_id: product.id, name: product.name, price: product.price, quantity: 1 });
        }
        return { vendor_id: product.vendor_id, shop_name, lines };
      });
      return true;
    },
    [cart]
  );

  const setQuantity = useCallback((productId, quantity) => {
    setCart((current) => {
      const lines = current.lines
        .map((l) => (l.product_id === productId ? { ...l, quantity: Math.min(99, quantity) } : l))
        .filter((l) => l.quantity > 0);
      return lines.length ? { ...current, lines } : { vendor_id: null, shop_name: "", lines: [] };
    });
  }, []);

  const clear = useCallback(() => setCart({ vendor_id: null, shop_name: "", lines: [] }), []);
  const replaceWith = useCallback((product, shop_name) => {
    setCart({
      vendor_id: product.vendor_id,
      shop_name,
      lines: [{ product_id: product.id, name: product.name, price: product.price, quantity: 1 }],
    });
  }, []);

  const totals = useMemo(() => {
    const count = cart.lines.reduce((n, l) => n + l.quantity, 0);
    const subtotal = cart.lines.reduce((sum, l) => sum + Math.round(Number(l.price) * 100) * l.quantity, 0) / 100;
    return { count, subtotal };
  }, [cart]);

  return { cart, totals, add, setQuantity, clear, replaceWith };
}
