---
description: Build high-converting, Blinkit/Dunzo-grade mobile-first PWA UI components for DropPutt
---

Act as a Principal Mobile Product Designer & Senior React/Tailwind Engineer. Build the requested frontend UI component(s) for **DropPutt** following these strict design rules:

### 1. Visual Design System (Hyperlocal Kerala PWA)
- **Layout:** Mobile-first container (`max-w-md mx-auto bg-slate-50 min-h-screen pb-24 shadow-xl` on desktop screens so it feels like a native app).
- **Color Palette:**
  - Primary Action & Brand: Vibrant Emerald (`emerald-600`, hover `emerald-700`) & Warm Amber (`amber-400` / `amber-500`) for 4 PM Snacks & Custom Buy highlights.
  - Surfaces: Pure White cards (`bg-white rounded-2xl border border-slate-200/80 shadow-sm`) over `bg-slate-50`.
  - High-Contrast Typography: `text-slate-900` for headings, `tabular-nums` for all ₹ prices and timers.
- **Bilingual Micro-Copy (English + Malayalam):** Include natural, friendly Malayalam subtitles on key buttons and banners (e.g., `"Buy Anything • എന്തും വാങ്ങാം"`, `"4 PM ചായക്കടി & കൂൾബാർ സമയം"`).
- **Touch Targets:** Minimum `48px` height (`h-12` or `py-3.5`) for all primary buttons and zone pills so riders and customers can tap easily with one hand.
- **Micro-Interactions:** Add `active:scale-[0.98] transition-transform` on clickable cards/buttons, skeleton loaders while fetching APIs, and toast notifications for errors.

### 2. Technical & API Rules
- Read `@SPEC.md` for exact API paths and `snake_case` payload fields.
- Use our centralized Axios instance (`src/utils/api.js`) which injects `x-franchise-slug`.
- Never use hardcoded `http://localhost:5000`; always use relative paths (`/api/v1/...`, `/uploads/...`).

### 3. Task to Execute Now
$ARGUMENTS
