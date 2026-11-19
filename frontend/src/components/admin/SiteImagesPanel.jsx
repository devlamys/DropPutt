import { ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage, MULTIPART } from "../../utils/api.js";
import { compressImage } from "../../utils/image.js";
import { defaultTileImage, forgetSiteImages } from "../../hooks/useSiteImages.js";

const SLOTS = [
  { slot: "restaurants", label: "Open Restaurants", hint: "Big tile, left of the home screen" },
  { slot: "buy_anything", label: "Buy Anything (Custom Book)", hint: "Small tile, top right" },
  { slot: "pick_drop", label: "Pick & Drop", hint: "Small tile, right" },
  { slot: "chayakadi", label: "4 PM Chayakadi & Coolbar", hint: "Wide banner at the top" },
  { slot: "mart", label: "DropPutt Mart", hint: "Wide tile under the buttons" },
];

/** Super Admin: the background photo of each home-screen tile (the same for every franchise). */
export default function SiteImagesPanel({ toast }) {
  const [images, setImages] = useState({});
  const [busy, setBusy] = useState(null);
  const [missing, setMissing] = useState({});

  const load = useCallback(async () => {
    const { data } = await api.get("/public/site-images", { skipAuth: true, params: { t: Date.now() } });
    setImages(data.data.images ?? {});
  }, []);
  useEffect(() => {
    load().catch((error) => toast(getErrorMessage(error), "error"));
  }, [load, toast]);

  async function upload(slot, file) {
    if (!file) return;
    setBusy(slot);
    try {
      const form = new FormData();
      form.set("image", await compressImage(file, { maxSide: 1200, quality: 0.82 }));
      await api.put(`/super/site-images/${slot}`, form, MULTIPART);
      forgetSiteImages();
      await load();
      toast("Photo updated", "success");
    } catch (error) {
      toast(getErrorMessage(error, "Could not upload the photo."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function reset(slot) {
    setBusy(slot);
    try {
      await api.delete(`/super/site-images/${slot}`);
      forgetSiteImages();
      await load();
      toast("Back to the default photo", "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="site-images-heading" className="space-y-3">
      <div>
        <h2 id="site-images-heading" className="text-base font-bold">Home screen photos</h2>
        <p className="text-sm text-slate-500">Background photo behind each tile on the customer home screen. It applies to every franchise. Use a bright, sharp landscape photo; it is shrunk automatically.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SLOTS.map(({ slot, label, hint }) => {
          const custom = images[slot];
          const src = custom || defaultTileImage(slot);
          return (
            <li key={slot} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              <div className="relative flex aspect-[16/9] items-center justify-center bg-slate-100 text-sm text-slate-400">
                {!missing[src] ? (
                  <img src={src} alt={`${label} photo`} className="h-full w-full object-cover" onError={() => setMissing((m) => ({ ...m, [src]: true }))} />
                ) : (
                  "No photo yet"
                )}
                {busy === slot && (
                  <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="h-6 w-6 animate-spin" /></span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{label}</p>
                  <p className="truncate text-xs text-slate-500">{custom ? "Your photo" : "Default"} · {hint}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {custom && (
                    <button type="button" onClick={() => reset(slot)} disabled={busy !== null} aria-label={`Reset ${label} to default`} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-50">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                  <label className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-full bg-orange-600 px-3.5 text-sm font-bold text-white ${busy !== null ? "pointer-events-none opacity-50" : ""}`}>
                    <ImagePlus className="h-4 w-4" /> Change
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { upload(slot, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
