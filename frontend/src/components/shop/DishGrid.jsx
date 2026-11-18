import { ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { inr } from "../../utils/format.js";
import MedicalNotice from "./MedicalNotice.jsx";
import { ProductImage } from "./parts.jsx";
import Stepper from "./Stepper.jsx";
import { useStorefront } from "./StorefrontContext.jsx";

const shimmer = "bg-[linear-gradient(90deg,#E7E7E2_25%,#D9D9D2_37%,#E7E7E2_63%)] bg-[length:400%_100%] motion-safe:animate-shimmer";

export function DishSkeletons({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Loading dishes">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <div className={`aspect-[4/3] ${shimmer}`} />
          <div className="space-y-2 p-3">
            <div className={`h-4 w-4/5 rounded-md ${shimmer}`} />
            <div className={`h-3 w-3/5 rounded-md ${shimmer}`} />
            <div className={`h-10 rounded-xl ${shimmer}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Calls `onVisible` whenever the marker nears the screen: the next page loads before the customer reaches the end. */
function Sentinel({ onVisible, watch }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && onVisible(), { rootMargin: "700px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible, watch]);
  return <div ref={ref} aria-hidden="true" className="h-px" />;
}

function DishCard({ product, quantity, onOpen, onAdd, onRemove }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 [content-visibility:auto] [contain-intrinsic-size:auto_270px]">
      <button type="button" onClick={onOpen} aria-label={`${product.name}, details`} className="text-left">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
          <ProductImage product={product} shopCategory={product.shop_category} className="h-full w-full" />
          {product.original_price && product.offer_label && (
            <span className="absolute left-2 top-2 rounded-full bg-flame-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow">{product.offer_label}</span>
          )}
          {product.stock_left ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-red-600">Only {product.stock_left} left</span>
          ) : null}
        </div>
        <div className="px-3 pt-2.5">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-[15px] font-bold leading-tight text-slate-900">{product.name}</h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">{product.shop_name}</p>
          <p className="mt-1 text-base font-extrabold tabular-nums text-slate-900">
            {inr(product.price)}
            {product.original_price && <span className="ml-1.5 text-xs font-semibold text-slate-400 line-through">{inr(product.original_price)}</span>}
          </p>
        </div>
      </button>
      <div className="mt-auto p-3 pt-2">
        <Stepper compact quantity={quantity} label={product.name} onAdd={onAdd} onRemove={onRemove} />
      </div>
    </article>
  );
}

/** A dish in full: big photo, offer, and a link to the shop's other dishes. */
function DishSheet({ product, onClose }) {
  const navigate = useNavigate();
  const { quantityOf, addProduct, removeOne } = useStorefront();
  const quantity = quantityOf(product.id);
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/50 motion-safe:animate-fade-in" role="dialog" aria-modal="true" aria-label={product.name} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white pb-6 shadow-2xl motion-safe:animate-sheet-up" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-3xl bg-slate-100">
          <ProductImage product={product} shopCategory={product.shop_category} className="h-full w-full" />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 px-5 pt-4">
          <div>
            <h2 className="text-xl font-extrabold leading-tight">{product.name}</h2>
            {product.offer_label && product.original_price && <p className="mt-1 text-sm font-bold text-flame-700">{product.offer_label}</p>}
          </div>
          {product.description && <p className="text-sm text-slate-600">{product.description}</p>}
          {product.shop_category === "MEDICAL_PHARMACY" && <MedicalNotice />}
          <button
            type="button"
            onClick={() => { onClose(); navigate(`/shop/restaurant/${product.vendor_id}`); }}
            className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left ring-1 ring-slate-200/80"
          >
            <span>
              <span className="block text-xs text-slate-500">From</span>
              <span className="block text-base font-bold text-slate-900">{product.shop_name}</span>
              <span className="block text-xs font-semibold text-flame-700">See all dishes from this shop</span>
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <div className="flex items-center justify-between gap-3">
            <p className="text-2xl font-extrabold tabular-nums">
              {inr(product.price)}
              {product.original_price && <span className="ml-2 text-sm font-semibold text-slate-400 line-through">{inr(product.original_price)}</span>}
            </p>
            <Stepper quantity={quantity} label={product.name} onAdd={() => addProduct(product, product.shop_name)} onRemove={() => removeOne(product.id)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The dish grid with infinite scroll. `list` is the result of useProducts().
 * `empty` is what to show when nothing can be ordered right now.
 */
export default function DishGrid({ list, empty }) {
  const { quantityOf, addProduct, removeOne } = useStorefront();
  const [open, setOpen] = useState(null);
  const { items, loading, loadingMore, hasMore, error, loadMore, reload } = list;

  if (loading && items.length === 0) return <DishSkeletons />;
  if (error && items.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/70">
        <p className="font-bold">We couldn't load the dishes</p>
        <p className="mt-1 text-sm text-slate-500">{error}</p>
        <button type="button" onClick={reload} className="mt-4 h-12 rounded-2xl bg-flame-600 px-6 text-sm font-bold text-white">Try again</button>
      </div>
    );
  }
  if (items.length === 0) return empty;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {items.map((product) => (
          <DishCard
            key={product.id}
            product={product}
            quantity={quantityOf(product.id)}
            onOpen={() => setOpen(product)}
            onAdd={() => addProduct(product, product.shop_name)}
            onRemove={() => removeOne(product.id)}
          />
        ))}
      </div>
      {hasMore && <Sentinel onVisible={loadMore} watch={items.length} />}
      {loadingMore && <div className="mt-3"><DishSkeletons count={2} /></div>}
      {error && items.length > 0 && (
        <button type="button" onClick={loadMore} className="mx-auto mt-3 block h-11 rounded-full bg-slate-100 px-5 text-sm font-bold text-slate-700">Could not load more · Tap to retry</button>
      )}
      {!hasMore && !loadingMore && items.length > 6 && <p className="py-4 text-center text-xs text-slate-400">That's everything for now</p>}
      {open && <DishSheet product={open} onClose={() => setOpen(null)} />}
    </>
  );
}
