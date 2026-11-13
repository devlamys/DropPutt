import { ExternalLink } from "lucide-react";

const TITLES = {
  CUSTOM_BUY: "🛒 Customer's shopping request",
  PICK_DROP: "📦 What to pick up",
  MINI_TRUCK: "🚚 What to move",
};

/**
 * What the customer asked for on a Buy Anything / Pick & Drop / Mini Truck
 * order: the written list, a photo of a handwritten list or prescription, and
 * a voice note. Renders nothing for ordinary shop orders.
 */
export default function RequestDetails({ order }) {
  const text = order.custom_items_text;
  const image = order.request_image_url;
  const voice = order.request_voice_url;
  if (!text && !image && !voice) return null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800">{TITLES[order.order_type] ?? "Customer's request"}</p>
      {text && <p className="whitespace-pre-line text-sm font-medium leading-relaxed text-slate-900">{text}</p>}
      {image && (
        <a href={image} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-amber-300" aria-label="Open the list photo full size">
          <img src={image} alt="Photo of the customer's list or prescription" loading="lazy" className="max-h-56 w-full bg-white object-contain" />
          <span className="flex items-center justify-center gap-1.5 bg-white py-2 text-xs font-semibold text-amber-800">
            <ExternalLink className="h-3.5 w-3.5" /> Open full size
          </span>
        </a>
      )}
      {voice && (
        <div>
          <p className="mb-1 text-xs font-semibold text-amber-900">🎙️ Voice note from the customer</p>
          <audio controls preload="none" src={voice} className="w-full" />
        </div>
      )}
    </div>
  );
}
