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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" aria-busy="true" aria-label="Loading dishes">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3 border-b border-slate-200 px-4 py-4 last:border-b-0">
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-3/5 rounded-md ${shimmer}`} />
            <div className={`h-4 w-1/4 rounded-md ${shimmer}`} />
            <div className={`h-3 w-4/5 rounded-md ${shimmer}`} />
          </div>
          <div className={`h-24 w-24 shrink-0 rounded-xl ${shimmer}`} />
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

/** Swiggy-style menu row: details on the left, square photo with an overlapping [ ADD ] on the right. */
function DishCard({ product, quantity, onOpen, onAdd, onRemove }) {
  return (
    <article className="flex gap-3 border-b border-slate-200 bg-white px-4 pb-7 pt-4 last:border-b-0 [content-visibility:auto] [contain-intrinsic-size:auto_136px]">
      <button type="button" onClick={onOpen} aria-label={`${product.name}, details`} className="min-w-0 flex-1 text-left">
        {product.original_price && product.offer_label && (
          <span className="mb-1 inline-block rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#E8431A]">{product.offer_label}</span>
        )}
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-tight text-slate-900">{product.name}</h3>
        <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
          {inr(product.price)}
          {product.original_price && <span className="ml-1.5 text-xs font-normal text-slate-400 line-through">{inr(product.original_price)}</span>}
        </p>
        {product.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{product.description}</p>}
        <p className="mt-1 truncate text-xs text-slate-400">{product.shop_name}</p>
        {product.stock_left ? <p className="mt-0.5 text-[11px] font-semibold text-red-600">Only {product.stock_left} left</p> : null}
      </button>
      <div className="relative h-24 w-24 shrink-0">
        <button type="button" onClick={onOpen} aria-label={`${product.name}, photo`} className="block h-24 w-24 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
          <ProductImage product={product} shopCategory={product.shop_category} className="h-full w-full" />
        </button>
        <div className="absolute inset-x-0 -bottom-4 flex justify-center">
          <Stepper compact quantity={quantity} label={product.name} onAdd={onAdd} onRemove={onRemove} />
        </div>
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
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white pb-6 motion-safe:animate-sheet-up" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-slate-100">
          <ProductImage product={product} shopCategory={product.shop_category} className="h-full w-full" />
          <button type="button" onClick={onClose} aria-label="Close" className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white ">
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
            className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-left ring-1 ring-slate-200/80"
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
      <div className="rounded-xl bg-white p-6 text-center ring-1 ring-slate-200/70">
        <p className="font-bold">We couldn't load the dishes</p>
        <p className="mt-1 text-sm text-slate-500">{error}</p>
        <button type="button" onClick={reload} className="mt-4 h-12 rounded-lg bg-[#E8431A] px-6 text-sm font-bold text-white">Try again</button>
      </div>
    );
  }
  if (items.length === 0) return empty;
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
        <button type="button" onClick={loadMore} className="mx-auto mt-3 block h-11 rounded-lg bg-slate-100 px-5 text-sm font-bold text-slate-700">Could not load more · Tap to retry</button>
      )}
      {!hasMore && !loadingMore && items.length > 6 && <p className="py-4 text-center text-xs text-slate-400">That's everything for now</p>}
      {open && <DishSheet product={open} onClose={() => setOpen(null)} />}
    </>
  );
}
