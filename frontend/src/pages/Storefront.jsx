import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import CartBar from "../components/shop/CartBar.jsx";
import CartCheckoutModal from "../components/CartCheckoutModal.jsx";
import OrderPlaced from "../components/shop/OrderPlaced.jsx";
import VendorMenuDrawer from "../components/VendorMenuDrawer.jsx";
import CustomBuyModal from "../components/CustomBuyModal.jsx";
import CustomOrderSheet from "../components/shop/CustomOrderSheet.jsx";
import OrdersDrawer from "../components/shop/OrdersDrawer.jsx";
import AccountSheet from "../components/shop/AccountSheet.jsx";
import BottomNav from "../components/shop/BottomNav.jsx";
import { StorefrontContext, readOrders, readProfile, rememberOrder, saveProfile } from "../components/shop/StorefrontContext.jsx";
import ZoneSheet from "../components/shop/ZoneSheet.jsx";
import { useToast } from "../components/Toast.jsx";
import { useCart } from "../hooks/useCart.js";
import api, { getErrorMessage } from "../utils/api.js";
import { fetchPlaceName } from "../utils/place.js";

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
  const { cart, carts, totals, allTotals, add, setQuantity, clear, clearAll, setActive, sync } = useCart();
  const [feed, setFeed] = useState(null);
  const [allShops, setAllShops] = useState([]); // includes shops that are closed right now
  // Everything that orders, the cart and the menus use sees only open shops.
  const vendors = useMemo(() => allShops.filter((v) => v.is_open !== false), [allShops]);
  const closedVendors = useMemo(() => allShops.filter((v) => v.is_open === false), [allShops]);
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState(() => readProfile().zone_id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [customKind, setCustomKind] = useState(null); // "CUSTOM_BUY" | "PICK_DROP" | "MINI_TRUCK"
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [vendorId, setVendorId] = useState(null); // shop whose menu drawer is open
  const [orderCount, setOrderCount] = useState(() => readOrders().length);
  // The customer's area ("Chullikode"), remembered with the saved pin.
  const [place, setPlaceState] = useState(() => readProfile().place ?? "");
  const setPlace = useCallback((name) => {
    setPlaceState(name);
    saveProfile({ place: name });
  }, []);
  useEffect(() => {
    const profile = readProfile();
    if (profile.lat != null && profile.lng != null && !profile.place) {
      fetchPlaceName(profile.lat, profile.lng).then((name) => name && setPlace(name));
    }
  }, [setPlace]);
  const location = useLocation();
  const onHomePage = location.pathname.replace(/\/+$/, "") === "/shop";
  const activeTab = accountOpen ? "account" : ordersOpen ? "orders" : customKind === "CUSTOM_BUY" ? "buy" : onHomePage ? "home" : null;
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      let cursor = null;
      const all = [];
      let first = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data } = await api.get("/marketplace/feed", {
          ...publicApi,
          params: { limit: 10, include_closed: 1, ...(cursor ? { cursor } : {}) },
        });
        first ??= data.data;
        all.push(...data.data.items);
        cursor = data.meta?.pagination?.next_cursor;
        if (!cursor) break;
      }
      setFeed(first);
      setAllShops(all);
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
  const cartsRef = useRef(carts);
  cartsRef.current = carts;
  useEffect(() => {
    if (!feed) return;
    for (const current of cartsRef.current) {
      const shop = vendors.find((v) => v.id === current.vendor_id);
      const available = new Set((shop?.products ?? []).map((p) => p.id));
      const gone = current.lines.filter((l) => !available.has(l.product_id));
      if (!shop) toast(`${current.shop_name} is closed right now — its cart was cleared.`, "warn");
      else if (gone.length) toast(`${gone.map((l) => l.name).join(", ")} ${gone.length === 1 ? "is" : "are"} not available now and left your ${current.shop_name} cart.`, "warn");
    }
    sync(vendors);
  }, [feed, vendors, sync, toast]);

  const pickZone = useCallback((id) => {
    setZoneId(id);
    saveProfile({ zone_id: id });
    setZoneOpen(false);
  }, []);

  const shopById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const quantities = useMemo(() => new Map(carts.flatMap((c) => c.lines.map((l) => [l.product_id, l.quantity]))), [carts]);
  const quantityOf = useCallback((id) => quantities.get(id) || 0, [quantities]);

  const addProduct = useCallback((product, shopName) => add(product, shopName), [add]);
  const removeOne = useCallback((id) => setQuantity(id, (quantities.get(id) || 0) - 1), [quantities, setQuantity]);

  const cartShop = shopById.get(cart.vendor_id);
  // The shop's minimum for one cart; 15:00-18:00 IST an all-snacks cart only needs the snack minimum.
  const minOrderOf = useCallback(
    (c) => {
      const base = Number(shopById.get(c.vendor_id)?.min_order_value || 0);
      const snackOnly = feed?.is_chayakadi_window && feed.pinned && c.lines.length > 0 && c.lines.every((l) => feed.pinned.products.some((p) => p.id === l.product_id));
      return snackOnly ? Math.min(base, Number(feed.pinned.min_order_value)) : base;
    },
    [shopById, feed]
  );
  const minOrder = minOrderOf(cart);
  // Carts still short of their shop's minimum, for the bar above the tabs.
  const shorts = carts
    .map((c) => {
      const subtotal = c.lines.reduce((sum, l) => sum + Math.round(Number(l.price) * 100) * l.quantity, 0) / 100;
      const min = minOrderOf(c);
      return { shop_name: c.shop_name, short: min - subtotal, progress: min > 0 ? Math.min(100, Math.round((subtotal / min) * 100)) : 100 };
    })
    .filter((x) => x.short > 0);

  useEffect(() => {
    if (allTotals.count === 0) setCartOpen(false);
  }, [allTotals.count]);

  const onPlaced = (order) => {
    if (order.orders) {
      // "Deliver together": one order per shop, one trip. Every order is remembered; tracking opens on the first.
      for (const o of order.orders) rememberOrder({ token: o.location_token, number: o.order_number, shop: o.shop_name });
      setOrderCount(readOrders().length);
      clearAll();
      setCartOpen(false);
      const first = order.orders[0];
      setPlaced({ ...first, shop_name: order.orders.map((o) => o.shop_name).join(" + ") });
      setTimeout(() => navigate(`/drop/${first.location_token}`), 900);
      return;
    }
    rememberOrder({ token: order.location_token, number: order.order_number, shop: order.shop_name, kind: order.kind });
    setOrderCount(readOrders().length);
    if (!order.kind) clear(); // shop checkout empties the cart; custom requests leave it alone
    setCartOpen(false);
    setCustomKind(null);
    setPlaced(order);
    // Straight to live tracking after a brief confirmation.
    setTimeout(() => navigate(`/drop/${order.location_token}`), 900);
  };

  const zone = zones.find((z) => String(z.id) === String(zoneId)) ?? null;
  const value = {
    feed,
    vendors,
    closedVendors,
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
    franchiseName: feed?.franchise?.name ?? null,
    place,
    openCustom: (kind) => setCustomKind(kind),
    openOrders: () => { setAccountOpen(false); setOrdersOpen(true); },
    orderCount,
    minOrder,
    cartShop,
    carts,
    allTotals,
    toast,
  };

  return (
    <StorefrontContext.Provider value={value}>
      <div className="min-h-screen bg-slate-100 font-display text-slate-900">
        {toastNode}
        <Outlet />

        {!cartOpen && !placed && !ordersOpen && !accountOpen && (
          <CartBar totals={allTotals} shorts={shorts} onOpen={() => setCartOpen(true)} />
        )}
        <BottomNav
          active={activeTab}
          orderCount={orderCount}
          onHome={() => {
            setOrdersOpen(false);
            setAccountOpen(false);
            if (!onHomePage) navigate("/shop");
            else window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onBuy={() => { setOrdersOpen(false); setAccountOpen(false); setCustomKind("CUSTOM_BUY"); }}
          onOrders={() => { setAccountOpen(false); setOrdersOpen(true); }}
          onAccount={() => { setOrdersOpen(false); setAccountOpen(true); }}
        />

        {cartOpen && allTotals.count > 0 && (
          <CartCheckoutModal
            cart={cart}
            totals={totals}
            shop={cartShop}
            carts={carts}
            activeId={cart.vendor_id}
            onSelect={setActive}
            minOrder={minOrder}
            onQuantity={setQuantity}
            minOrderOf={minOrderOf}
            onAddMore={(id) => {
              setCartOpen(false);
              setVendorId(id ?? cart.vendor_id);
            }}
            onClose={() => setCartOpen(false)}
            onPlaced={onPlaced}
          />
        )}

        {vendorId != null && (
          <VendorMenuDrawer
            shopId={vendorId}
            onClose={() => setVendorId(null)}
            onViewCart={() => {
              setActive(vendorId);
              setVendorId(null);
              setCartOpen(true);
            }}
          />
        )}

        {customKind === "CUSTOM_BUY" && (
          <CustomBuyModal
            onClose={() => setCustomKind(null)}
            onPlaced={onPlaced}
          />
        )}
        {customKind && customKind !== "CUSTOM_BUY" && (
          <CustomOrderSheet
            kind={customKind}
            onClose={() => setCustomKind(null)}
            onPlaced={onPlaced}
          />
        )}

        {ordersOpen && <OrdersDrawer onClose={() => { setOrdersOpen(false); setOrderCount(readOrders().length); }} />}

        {accountOpen && (
          <AccountSheet
            onClose={() => setAccountOpen(false)}
            onZones={() => setZoneOpen(true)}
            place={place}
            orderCount={orderCount}
            onClearedOrders={() => setOrderCount(readOrders().length)}
          />
        )}

        {zoneOpen && <ZoneSheet onClose={() => setZoneOpen(false)} onPlace={setPlace} cartCount={allTotals.count} onClearCart={() => { clearAll(); try { localStorage.removeItem("dropputt.carts"); localStorage.removeItem("dropputt.cart"); } catch { /* ignore */ } }} />}

        {placed && <OrderPlaced order={placed} />}
      </div>
    </StorefrontContext.Provider>
  );
}
