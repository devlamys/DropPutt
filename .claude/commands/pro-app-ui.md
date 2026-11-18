---
description: Refactor DropPutt Customer UI from generic AI-rounded style into a crisp, native-feeling Swiggy/Blinkit-grade mobile e-commerce app
---

Act as a Principal Mobile App UI/UX Designer (specialized in Indian Quick-Commerce & Food Delivery apps like Swiggy, Blinkit, and Zepto). Refactor and build the requested DropPutt Customer UI eliminating generic "AI-generated" aesthetics.

### 1. Strict Anti-AI Visual Rules (Crisp & Native Mobile Feel)
- **Kill Over-Rounded Pills:** NEVER use `rounded-full` or `rounded-3xl` on primary buttons, cards, inputs, or quantity steppers. Use crisp, structured corners: `rounded-lg` (8px) for buttons/inputs/badges, and `rounded-xl` (12px) for product/vendor cards.
- **No Heavy Drop Shadows:** Replace blurry AI `shadow-lg`/`shadow-xl` with clean 1px hairlines (`border border-slate-200 bg-white`) and subtle section dividers (`h-2 bg-slate-100`).
- **Brand Color Discipline (`#E8431A`):** Keep 85% of the screen clean white (`#FFFFFF`) and cool off-white (`#F8FAFC`) with sharp dark slate text (`#0F172A`). Reserve `#E8431A` strictly for primary CTAs, active tabs, and `[ + ADD ]` buttons.

### 2. Native Mobile App Navigation & Layout Structure
- **Sub-Page App Header (`h-14` sticky top):** Every inner view (Vendor Menu, Custom Buy, Cart/Checkout, Order Tracking, My Orders) MUST have a native app header with a crisp left-aligned `←` (`ArrowLeft`) back button (`w-10 h-10 flex items-center justify-center`), bold page title (`text-base font-bold`), and optional right action.
- **Persistent Bottom Navigation Bar (on main views):** Fixed bottom bar (`h-16 bg-white border-t border-slate-200`) with 4 crisp tabs: `Home`, `Buy Anything`, `Orders`, and `Account` (with active `#E8431A` indicator).
- **Swiggy/Blinkit Menu Item Row:** Horizontal split row—left side: Veg/Non-Veg indicator square, item title (`font-semibold text-slate-900`), `tabular-nums` price (`₹140`), and 2-line description; right side: square thumbnail (`w-24 h-24 rounded-xl`) overlapping a crisp white/orange `[ ADD ]` button (`rounded-lg border border-[#E8431A] font-bold text-xs tracking-wide`).
- **Sticky Bottom Cart Strip:** When cart has items, float a crisp `rounded-xl bg-[#E8431A] text-white` bar right above the bottom nav showing `2 ITEMS | ₹280` on the left and `View Cart →` on the right.

### 3. Technical & Architecture Rules
- Read `@SPEC.md` and `@CLAUDE.md` first. Preserve all existing API endpoints, `x-franchise-slug` handling, `DropPuttLogo`, and state logic.
- Mobile-first container (`max-w-md mx-auto min-h-screen bg-white sm:border-x sm:border-slate-200`).

### 4. Task to Execute Now
$ARGUMENTS
