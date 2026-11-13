import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import CartBar from "../components/shop/CartBar.jsx";
import CartSheet, { OrderPlaced } from "../components/shop/CartSheet.jsx";
import { StorefrontContext, readProfile, saveLastOrder, saveProfile } from "../components/shop/StorefrontContext.jsx";
import ZoneSheet from "../components/shop/ZoneSheet.jsx";
import { useToast } from "../components/Toast.jsx";
import { useCart } from "../hooks/useCart.js";
import api, { getErrorMessage } from "../utils/api.js";

const publicApi = { skipAuth: true };
const MAX_PAGES = 10; // 10 shops per page
const STALE_MS = 2 * 60 * 1000;

/**
 * Customer storefront shell: loads the menu once, owns the cart and the
 * delivery area, and renders the home page or one shop's menu inside it.
 */
export default function Storefront() {
  const navigate = useNavigate();
  const { toast, node: toastNode } = useToast();
  const { cart, totals, add, setQuantity, clear, replaceWith, sync } = useCart();
  const [feed, setFeed] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState(() => readProfile().zone_id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [switching, setSwitching] = useState(null); // { product, shopName }
  const [placed, setPlaced] = useState(null);
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      let cursor = null;
      const all = [];
      let first = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data } = await api.get("/marketplace/feed", {
          ...publicApi,
          params: { limit: 10, ...(cursor ? { cursor } : {}) },
        });
        first ??= data.data;
        all.push(...data.data.items);
        cursor = data.meta?.pagination?.next_cursor;
        if (!cursor) break;
      }
      setFeed(first);
      setVendors(all);
      setError("");
      loadedAt.current = Date.now();
      return all;
    } catch (err) {
      setError(getErrorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "DropPutt — order from local shops";
    load();
    api
      .get("/marketplace/zones", publicApi)
      .then(({ data }) => setZones(data.data.zones))
      .catch(() => {});
    // Menus change with the clock (lunch, 4 PM snacks): refresh when the
    // customer comes back to the tab after a while.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // A cart saved earlier may hold things that can't be ordered any more.
  const cartRef = useRef(cart);
  cartRef.current = cart;
  useEffect(() => {
    if (!feed) return;
    const current = cartRef.current;
    if (current.vendor_id) {
      const shop = vendors.find((v) => v.id === current.vendor_id);
      const available = new Set((shop?.products ?? []).map((p) => p.id));
      const gone = current.lines.filter((l) => !available.has(l.product_id));
      if (!shop) toast(`${current.shop_name} is closed right now — your cart was cleared.`, "warn");
      else if (gone.length) toast(`${gone.map((l) => l.name).join(", ")} ${gone.length === 1 ? "is" : "are"} not available now and left your cart.`, "warn");
    }
    sync(vendors);
  }, [feed, vendors, sync, toast]);

  const pickZone = useCallback((id) => {
    setZoneId(id);
    saveProfile({ zone_id: id });
    setZoneOpen(false);
  }, []);

  const shopById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const quantities = useMemo(() => new Map(cart.lines.map((l) => [l.product_id, l.quantity])), [cart]);
  const quantityOf = useCallback((id) => quantities.get(id) || 0, [quantities]);

  const addProduct = useCallback(
    (product, shopName) => {
      if (!add(product, shopName)) setSwitching({ product, shopName });
    },
    [add]
  );
  const removeOne = useCallback((id) => setQuantity(id, (quantities.get(id) || 0) - 1), [quantities, setQuantity]);

  const cartShop = shopById.get(cart.vendor_id);
  const baseMin = Number(cartShop?.min_order_value || 0);
  // 15:00–18:00 IST an all-snacks cart only needs the snack minimum.
  const snackOnly =
    feed?.is_chayakadi_window &&
    feed.pinned &&
    cart.lines.length > 0 &&
    cart.lines.every((l) => feed.pinned.products.some((p) => p.id === l.product_id));
  const minOrder = snackOnly ? Math.min(baseMin, Number(feed.pinned.min_order_value)) : baseMin;

  useEffect(() => {
    if (totals.count === 0) setCartOpen(false);
  }, [totals.count]);

  const onPlaced = (order) => {
    saveLastOrder({ token: order.location_token, number: order.order_number, shop: order.shop_name });
    clear();
    setCartOpen(false);
    setPlaced(order);
    setTimeout(() => navigate(`/drop/${order.location_token}`), 1600);
  };

  const zone = zones.find((z) => String(z.id) === String(zoneId)) ?? null;
  const value = {
    feed,
    vendors,
    shopById,
    zones,
    zone,
    loading,
    error,
    reload: load,
    cart,
    quantityOf,
    addProduct,
    removeOne,
    openZones: () => setZoneOpen(true),
    pickZone,
    totals,
    openCart: () => setCartOpen(true),
  };

  return (
    <StorefrontContext.Provider value={value}>
      <div className="min-h-screen bg-[#F3F3F0] font-display text-pine-950">
        {toastNode}
        <Outlet />
        {/* room for the floating cart bar so it never covers the footer text */}
        {totals.count > 0 && <div className="h-24 bg-pine-950" aria-hidden="true" />}

        {!cartOpen && !placed && (
          <CartBar cart={cart} totals={totals} minOrder={minOrder} shopCategory={cartShop?.shop_category} onOpen={() => setCartOpen(true)} />
        )}

        {cartOpen && totals.count > 0 && (
          <CartSheet
            cart={cart}
            totals={totals}
            shop={cartShop}
            zones={zones}
            zoneId={zoneId}
            onZone={(id) => {
              setZoneId(id);
              saveProfile({ zone_id: id });
            }}
            minOrder={minOrder}
            onQuantity={setQuantity}
            onAddMore={() => {
              setCartOpen(false);
              navigate(`/shop/${cart.vendor_id}`);
            }}
            onClose={() => setCartOpen(false)}
            onPlaced={onPlaced}
          />
        )}

        {zoneOpen && <ZoneSheet zones={zones} value={zoneId} onPick={pickZone} onClose={() => setZoneOpen(false)} />}

        {switching && (
          <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 p-4 motion-safe:animate-fade-in sm:items-center" role="alertdialog" aria-modal="true" aria-label="Start a new cart?">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl motion-safe:animate-sheet-up">
              <p className="text-lg font-semibold text-pine-950">Start a new cart?</p>
              <p className="mt-1 text-sm text-slate-600">
                One order comes from one shop. Adding this will clear your items from <b>{cart.shop_name}</b>.
              </p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setSwitching(null)} className="flex-1 rounded-full bg-slate-100 py-3 text-sm font-semibold text-slate-700">
                  Keep cart
                </button>
                <button
                  type="button"
                  onClick={() => {
                    replaceWith(switching.product, switching.shopName);
                    setSwitching(null);
                  }}
                  className="flex-1 rounded-full bg-flame-600 py-3 text-sm font-semibold text-white hover:bg-flame-700"
                >
                  New cart
                </button>
              </div>
            </div>
          </div>
        )}

        {placed && <OrderPlaced order={placed} />}
      </div>
    </StorefrontContext.Provider>
  );
}
