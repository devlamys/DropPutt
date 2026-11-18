import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "dropputt.carts";
const OLD_KEY = "dropputt.cart"; // before carts were per shop: a single { vendor_id, shop_name, lines }

const EMPTY = { carts: [], active: null };

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    if (parsed && Array.isArray(parsed.carts)) return parsed;
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
    if (old && old.vendor_id && Array.isArray(old.lines) && old.lines.length) return { carts: [old], active: old.vendor_id };
  } catch {
    /* ignore */
  }
  return EMPTY;
}

const countOf = (cart) => cart.lines.reduce((n, l) => n + l.quantity, 0);
const subtotalOf = (cart) => cart.lines.reduce((sum, l) => sum + Math.round(Number(l.price) * 100) * l.quantity, 0) / 100;
// The active cart must exist; otherwise fall back to the first one.
const settle = (state) => {
  const carts = state.carts.filter((c) => c.lines.length > 0);
  const active = carts.some((c) => c.vendor_id === state.active) ? state.active : carts[0]?.vendor_id ?? null;
  return { carts, active };
};

/**
 * One cart per shop. An order still comes from one shop, so checkout places one order for the
 * ACTIVE cart; the other carts wait. Lines keep only product_id, quantity and display data:
 * prices are shown for the customer, the server re-prices every line.
 */
export function useCart() {
  const [state, setState] = useState(() => settle(read()));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      localStorage.removeItem(OLD_KEY);
    } catch {
      /* private mode: the carts still work for this visit */
    }
  }, [state]);

  const add = useCallback((product, shop_name) => {
    setState((current) => {
      const carts = current.carts.map((c) => ({ ...c, lines: [...c.lines] }));
      let cart = carts.find((c) => c.vendor_id === product.vendor_id);
      if (!cart) {
        cart = { vendor_id: product.vendor_id, shop_name, lines: [] };
        carts.push(cart);
      }
      const line = cart.lines.find((l) => l.product_id === product.id);
      if (line) line.quantity = Math.min(99, line.quantity + 1);
      else cart.lines.push({ product_id: product.id, name: product.name, price: product.price, quantity: 1 });
      return { carts, active: product.vendor_id };
    });
  }, []);

  const setQuantity = useCallback((productId, quantity) => {
    setState((current) =>
      settle({
        ...current,
        carts: current.carts.map((c) => ({
          ...c,
          lines: c.lines.map((l) => (l.product_id === productId ? { ...l, quantity: Math.min(99, quantity) } : l)).filter((l) => l.quantity > 0),
        })),
      })
    );
  }, []);

  /** Removes one shop's cart (default: the active one), e.g. after its order was placed. */
  const clear = useCallback((vendorId) => {
    setState((current) => settle({ ...current, carts: current.carts.filter((c) => c.vendor_id !== (vendorId ?? current.active)) }));
  }, []);
  const clearAll = useCallback(() => setState(EMPTY), []);
  const setActive = useCallback((vendorId) => setState((current) => settle({ ...current, active: vendorId })), []);

  /**
   * Drops lines that can no longer be ordered (shop closed, item sold out or out of its
   * time slot) and refreshes names / prices from the live menu. Returns nothing; callers
   * compare `carts` before and after when they need to tell the customer.
   */
  const sync = useCallback((vendors) => {
    setState((current) => {
      const carts = current.carts
        .map((cart) => {
          const shop = vendors.find((v) => v.id === cart.vendor_id);
          if (!shop) return { ...cart, lines: [] };
          const byId = new Map((shop.products ?? []).map((p) => [p.id, p]));
          return {
            vendor_id: cart.vendor_id,
            shop_name: shop.shop_name,
            lines: cart.lines.filter((l) => byId.has(l.product_id)).map((l) => ({ ...l, name: byId.get(l.product_id).name, price: byId.get(l.product_id).price })),
          };
        })
        .filter((c) => c.lines.length > 0);
      const next = settle({ carts, active: current.active });
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, []);

  const cart = useMemo(() => state.carts.find((c) => c.vendor_id === state.active) ?? { vendor_id: null, shop_name: "", lines: [] }, [state]);
  // Totals of the active cart (checkout, minimum order) and of everything (the bar above the tabs).
  const totals = useMemo(() => ({ count: countOf(cart), subtotal: subtotalOf(cart) }), [cart]);
  const allTotals = useMemo(
    () => ({ count: state.carts.reduce((n, c) => n + countOf(c), 0), subtotal: state.carts.reduce((s, c) => s + Math.round(subtotalOf(c) * 100), 0) / 100, shops: state.carts.length }),
    [state]
  );

  return { cart, carts: state.carts, totals, allTotals, add, setQuantity, clear, clearAll, setActive, sync };
}
