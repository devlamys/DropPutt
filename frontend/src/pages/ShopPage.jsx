import { Minus, Plus, ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CheckoutSheet from "../components/shop/CheckoutSheet.jsx";
import { useToast } from "../components/Toast.jsx";
import { useCart } from "../hooks/useCart.js";
import api, { getErrorMessage } from "../utils/api.js";
import { inr } from "../utils/format.js";

const publicApi = { skipAuth: true };

function Stepper({ quantity, onAdd, onRemove }) {
  if (!quantity) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white active:scale-95"
      >
        Add
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 rounded-xl bg-orange-50 ring-1 ring-orange-200">
      <button type="button" onClick={onRemove} aria-label="Remove one" className="p-2.5 text-orange-700">
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-6 text-center text-sm font-bold">{quantity}</span>
      <button type="button" onClick={onAdd} aria-label="Add one" className="p-2.5 text-orange-700">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ProductRow({ product, shopName, quantity, onAdd, onRemove }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {product.name}
          {product.is_combo && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Combo</span>}
        </p>
        <p className="text-sm text-slate-500">
          {inr(product.price)}
          {shopName ? ` · ${shopName}` : ""}
        </p>
      </div>
      <Stepper quantity={quantity} onAdd={onAdd} onRemove={onRemove} />
    </li>
  );
}

export default function ShopPage() {
  const navigate = useNavigate();
  const { toast, node: toastNode } = useToast();
  const { cart, totals, add, setQuantity, clear, replaceWith } = useCart();
  const [feed, setFeed] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [next, setNext] = useState(null);
  const [zones, setZones] = useState([]);
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [switching, setSwitching] = useState(null); // { product, shopName }

  const load = useCallback(async (cursor) => {
    try {
      const { data } = await api.get("/marketplace/feed", {
        ...publicApi,
        params: { limit: 10, ...(cursor ? { cursor } : {}) },
      });
      setFeed((current) => (cursor ? current : data.data));
      setVendors((current) => (cursor ? [...current, ...data.data.items] : data.data.items));
      setNext(data.meta?.pagination?.next_cursor ?? null);
      setError("");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    api
      .get("/marketplace/zones", publicApi)
      .then(({ data }) => setZones(data.data.zones))
      .catch(() => {});
  }, [load]);

  const quantityOf = useMemo(() => {
    const map = new Map(cart.lines.map((l) => [l.product_id, l.quantity]));
    return (id) => map.get(id) || 0;
  }, [cart]);

  const addProduct = (product, shopName) => {
    if (!add(product, shopName)) setSwitching({ product, shopName });
  };
  const shopById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const minOrder = Number(shopById.get(cart.vendor_id)?.min_order_value || 0);
  // 15:00–18:00 IST an all-snacks cart only needs the snack minimum.
  const snackOnly =
    feed?.is_chayakadi_window &&
    cart.lines.length > 0 &&
    cart.lines.every((l) => feed.pinned?.products.some((p) => p.id === l.product_id));
  const effectiveMin = snackOnly ? Math.min(minOrder, Number(feed.pinned.min_order_value)) : minOrder;

  const categories = (feed?.categories || []).filter((c) => c.shop_category);
  const shown = vendors.filter((v) => !category || v.shop_category === category);

  const placed = (order) => {
    clear();
    toast(`Order ${order.order_number} placed!`, "success");
    navigate(`/drop/${order.location_token}`);
  };

  return (
    <div className="mx-auto min-h-screen max-w-xl bg-slate-50 pb-28">
      {toastNode}
      <header className="sticky top-0 z-20 bg-orange-600 px-4 pb-3 pt-4 text-white shadow">
        <h1 className="text-xl font-extrabold">DropPutt</h1>
        <p className="text-sm text-orange-100">Order from local shops — delivered to your door</p>
      </header>

      <div className="space-y-5 px-4 pt-4">
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!feed && !error && <p className="py-10 text-center text-slate-500">Loading shops…</p>}

        {feed?.pinned && feed.pinned.products.length > 0 && (
          <section className="rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 p-4 ring-1 ring-orange-200">
            <h2 className="text-lg font-extrabold text-orange-900">{feed.pinned.label}</h2>
            <p className="text-xs text-orange-800">Minimum order {inr(feed.pinned.min_order_value)}</p>
            <ul className="divide-y divide-orange-200/70">
              {feed.pinned.products.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  shopName={p.shop_name}
                  quantity={quantityOf(p.id)}
                  onAdd={() => addProduct(p, p.shop_name)}
                  onRemove={() => setQuantity(p.id, quantityOf(p.id) - 1)}
                />
              ))}
            </ul>
          </section>
        )}

        {categories.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {[{ key: "", label: "All", shop_category: "" }, ...categories].map((c) => (
              <button
                key={c.key || "all"}
                type="button"
                onClick={() => setCategory(c.shop_category)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                  category === c.shop_category ? "bg-orange-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {shown.map((vendor) => (
          <section key={vendor.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">{vendor.shop_name}</h2>
              <span className="text-xs text-slate-500">Min {inr(vendor.min_order_value)}</span>
            </div>
            {vendor.address && <p className="text-xs text-slate-500">{vendor.address}</p>}
            {vendor.products.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">Nothing available right now.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {vendor.products.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    quantity={quantityOf(p.id)}
                    onAdd={() => addProduct(p, vendor.shop_name)}
                    onRemove={() => setQuantity(p.id, quantityOf(p.id) - 1)}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
        {feed && shown.length === 0 && <p className="py-10 text-center text-slate-500">No shops open in this category right now.</p>}
        {next && (
          <button type="button" onClick={() => load(next)} className="w-full rounded-xl bg-white py-3 font-semibold ring-1 ring-slate-200">
            Show more shops
          </button>
        )}
      </div>

      {totals.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-xl p-3">
          <button
            type="button"
            onClick={() => setCheckout(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-orange-600 px-5 py-4 font-bold text-white shadow-xl"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              {totals.count} item{totals.count === 1 ? "" : "s"} · {cart.shop_name}
            </span>
            <span>{inr(totals.subtotal)} · View cart</span>
          </button>
        </div>
      )}

      {checkout && (
        <CheckoutSheet
          cart={cart}
          subtotal={totals.subtotal}
          zones={zones}
          minOrder={effectiveMin}
          onClose={() => setCheckout(false)}
          onPlaced={placed}
        />
      )}

      {switching && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <p className="font-bold">Start a new cart?</p>
            <p className="mt-1 text-sm text-slate-600">
              One order can only include items from one shop. Your cart from {cart.shop_name} will be cleared.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setSwitching(null)} className="flex-1 rounded-xl bg-slate-100 py-3 font-semibold">
                Keep cart
              </button>
              <button
                type="button"
                onClick={() => {
                  replaceWith(switching.product, switching.shopName);
                  setSwitching(null);
                }}
                className="flex-1 rounded-xl bg-orange-600 py-3 font-bold text-white"
              >
                New cart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
