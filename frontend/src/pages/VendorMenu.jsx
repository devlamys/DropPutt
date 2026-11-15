import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";
import ProductFormModal from "../components/vendor/ProductFormModal.jsx";
import { useSocket } from "../hooks/useSocket.js";
import api, { getErrorMessage } from "../utils/api.js";
import { inr } from "../utils/format.js";

/** The hotel's own menu: add dishes, set how many are left, run offers, add photos, switch on/off. */
export default function VendorMenu() {
  const { toast, node: toastNode } = useToast();
  const [products, setProducts] = useState(null);
  const [form, setForm] = useState(null); // null | "new" | product
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/vendor/me");
      setProducts(data.data.products);
    } catch (error) {
      toast(getErrorMessage(error), "error");
      setProducts([]);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  // An order takes stock and a cancelled one gives it back: keep the counts live.
  useSocket({ order_status_changed: () => void load(), order_cancelled: () => void load() });
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const replace = (saved) => setProducts((list) => list.map((p) => (p.id === saved.id ? saved : p)));

  async function patch(product, body) {
    try {
      const { data } = await api.patch(`/vendor/products/${product.id}`, body);
      replace(data.data.product);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }

  async function archive() {
    try {
      await api.delete(`/vendor/products/${removing.id}`);
      setProducts((list) => list.filter((p) => p.id !== removing.id));
      toast("Item removed from your menu", "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      {toastNode}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-white px-4 py-3">
        <Link to="/vendor" aria-label="Back to dashboard" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 text-lg font-bold">My menu</h1>
        <button type="button" onClick={() => setForm("new")} className="flex items-center gap-1 rounded-full bg-green-600 px-4 py-2 text-sm font-bold text-white">
          <Plus className="h-4 w-4" /> Add item
        </button>
      </header>

      <main className="px-4 pt-4">
        {products === null ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : products.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            Your menu is empty. Tap “Add item” to add your first dish.
          </p>
        ) : (
          <ul className="space-y-3">
            {products.map((product) => (
              <li key={product.id} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                <div className="flex items-start gap-3">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl">🍽️</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-semibold ${product.is_available ? "" : "text-slate-400 line-through"}`}>{product.name}</p>
                    <p className="text-sm">
                      {product.offer_active ? (
                        <>
                          <span className="font-bold text-orange-700">{inr(product.effective_price)}</span>{" "}
                          <span className="text-xs text-slate-400 line-through">{inr(product.price)}</span>{" "}
                          <span className="rounded bg-orange-100 px-1.5 text-[10px] font-semibold text-orange-800">{product.offer_label}</span>
                        </>
                      ) : (
                        <span className="font-bold">{inr(product.price)}</span>
                      )}
                    </p>
                    {product.stock_qty === 0 && <p className="text-xs font-semibold text-red-600">Sold out</p>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={product.is_available}
                    aria-label={`${product.name} available`}
                    onClick={() => patch(product, { is_available: !product.is_available })}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition ${product.is_available ? "bg-green-500" : "bg-slate-300"}`}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${product.is_available ? "left-[1.375rem]" : "left-0.5"}`} />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  {product.stock_qty == null ? (
                    <button type="button" onClick={() => patch(product, { stock_qty: 10 })} className="rounded-full border px-3 py-1 text-xs font-medium text-slate-600">
                      Unlimited · set quantity
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label={`Fewer ${product.name}`} disabled={product.stock_qty === 0} onClick={() => patch(product, { stock_qty: product.stock_qty - 1 })} className="flex h-8 w-8 items-center justify-center rounded-full border disabled:opacity-40">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-[4.5rem] text-center text-sm font-semibold">{product.stock_qty} left</span>
                      <button type="button" aria-label={`More ${product.name}`} onClick={() => patch(product, { stock_qty: product.stock_qty + 1 })} className="flex h-8 w-8 items-center justify-center rounded-full border">
                        <Plus className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => patch(product, { stock_qty: null })} className="ml-1 text-xs text-slate-500 underline">
                        unlimited
                      </button>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <button type="button" aria-label={`Edit ${product.name}`} onClick={() => setForm(product)} className="rounded-full p-2 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Remove ${product.name}`} onClick={() => setRemoving(product)} className="rounded-full p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {form && (
        <ProductFormModal
          product={form === "new" ? null : form}
          toast={toast}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}

      {removing && (
        <Modal title="Remove this item?" onClose={() => setRemoving(null)}>
          <p className="text-sm text-slate-600">“{removing.name}” will disappear from your menu. Old orders keep it.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setRemoving(null)} className="flex-1 rounded-2xl border py-3 font-semibold">Keep</button>
            <button type="button" onClick={archive} className="flex-1 rounded-2xl bg-red-600 py-3 font-bold text-white">Remove</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
