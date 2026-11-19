# Mini Truck plan (DropPutt)

Status: **planning only**. Customers see "Mini Truck: coming soon". Food & Grocery launches first.
All numbers below are **examples**, not real rates.

## 1. Current code (checked 2026-11-19)

| Item | Today |
|---|---|
| Customer entry | Home tile "Pick & Drop", sheet `CustomOrderSheet.jsx` with a Pick & Drop / Mini Truck switch (Mini Truck now disabled) |
| Request | Free-text "what to move", text pickup address (no pin), drop pin |
| Backend | `POST /marketplace/orders` (`marketplaceRoutes.js`), `order_type = MINI_TRUCK`, category `PICK_DROP`; now refused unless `MINI_TRUCK_ENABLED=true` |
| Admin/vendor | `POST /orders/quick-call` (`orderRoutes.js`) can still create MINI_TRUCK |
| Dispatch | `dispatchService.js` and `orderRoutes.js`: MINI_TRUCK orders go only to online, approved riders with `vehicle_type = MINI_TRUCK`; others never get them. First accept wins |
| Vehicle type | enum `BIKE, SCOOTER, AUTO, MINI_TRUCK` |
| Fee | normal delivery bands, measured from town centre to the drop (not pickup to drop) |
| Not present | vehicle charge, loading/unloading info, weight, schedule, vehicle photos, self-registration, rider min charge, booking fee, per-class royalty |
| Franchise money | flat Rs 3 royalty from the franchise wallet, no income, so a truck trip is a loss |
| Riders | admin creates riders; fields: vehicle no., licence no., KYC link, insurance date, emergency contact, is_approved |

## 2. Decisions made

1. **Launch order:** Food & Grocery first, Mini Truck "coming soon". Truck built after launch in small, tested steps.
2. **Price model C:** franchise rate card price, plus each driver's own minimum charge. A trip below a driver's minimum is not shown to that driver. If nobody accepts, the customer can raise the offer (phase 2).
3. **Driver minimum limit:** 70% to 100% of the rate card (above 100% the driver would never see a trip). Tipper may get a +/- band because it is priced per load.
4. **Booking fee:** a separate line on the customer's bill, so the driver keeps the full travel charge. Fee = max(minimum fee, % of travel charge), capped. The % applies to travel charge only, never to loading/unloading.
5. **Royalty (super admin):** flat per vehicle class from the franchise wallet, example small pickup Rs 10, large pickup Rs 15, tipper Rs 20. Not by weight (cannot be verified). Franchise profit = booking fee - royalty. Debit on trip completion; refund/skip on cancel.
6. **Cash:** customer pays the driver everything; the driver keeps the travel charge and owes the booking fee, which adds to cash-in-hand (limit Rs 1,500, easily fits) and is handed over later. At the limit the driver cannot take new trips.
7. **Phone numbers:** shown to both sides only after the driver accepts (SPEC section 28 stays for food).
8. **Goods money:** not handled in the app. Customer pays the seller directly. DropPutt carries transport only.
9. **Loading/unloading:** each driver records "loading Rs / unloading Rs" in the profile; the customer sees it after accept. Not in app accounting, no fee taken. A "Self unloading" checkbox removes unloading. Do not assume union rates; ask locally.
10. **Cancellation:** needed in phase 1. A flat charge per vehicle class after the driver has set out or arrived (Rs 100 is only an example; tipper needs more).
11. **Distance:** phase 1 = pickup pin to drop pin (road distance) with a minimum base charge for the first N km. The driver's empty run is covered by their minimum charge; a separate pickup charge can come in phase 2. A pickup radius filter (driver to pickup) is applied at dispatch.
12. **Tipper:** per-load / zone price instead of per-km (phase 2 or a late phase 1 step).
13. **Schedule ("tomorrow 7 AM"):** phase 2. Phase 1 is "now" only. Open to move earlier if demand is strong.
14. **Same driver, one job type:** a driver must not take food and truck work at once; keep the vehicle filter.

## 3. Pricing example (illustration only)

12 km small pickup: Rs 400 for the first 5 km + 7 x Rs 25 = Rs 575 travel charge.
Booking fee 8% = Rs 46 (min Rs 20, max Rs 100). Customer sees Rs 621.
Driver keeps Rs 575, owes Rs 46. Royalty Rs 15, franchise profit Rs 31.

## 4. Data design

- `VehicleClass` table (name, icon, kind goods/passenger, rate card defaults, royalty, capacity fields). Adding Auto later = adding a row. Replaces the single `MINI_TRUCK` enum value.
- Rate card per franchise (every query filtered by `franchise_id`).
- `Vehicle` (1:1 with rider first, 1:N later) + documents with expiry.
- Money only through the helpers in `backend/src/utils/orderMath.js`.

## 5. Driver registration

Self-register -> "under review" -> franchise admin checks documents -> approve or reject with a reason -> online.
Fields: name, phone, PIN, vehicle class, model, number, photos (front, side, back, load body), RC photo, licence number and photo, insurance (date + photo), fitness/permit date, capacity (kg/ton), body size, minimum charge, loading/unloading rates, service radius, emergency contact, selfie.
Insurance/fitness expiry takes the driver offline and warns the admin.
Risk: no phone OTP yet (no SMS provider), so someone could use another person's number. Admin approval and document checks reduce it; add OTP later. Rate-limit the registration endpoint; no alerts before approval.

## 6. Phases

| Phase | Work | When |
|---|---|---|
| 0 | Food & Grocery launch; Mini Truck "coming soon"; optional driver interest form (name, phone, vehicle) | now |
| 1a | VehicleClass table, rate card, price calculation, tests (no UI) | after launch |
| 1b | Driver self-registration, uploads, admin approval | |
| 1c | Customer booking form (class, pickup pin, drop pin, load text, self unloading) with fixed price; dispatch filter (class, min charge, capacity, pickup radius); phone after accept | |
| 1d | Trip lifecycle (reuse statuses), booking fee and royalty ledger, cancellation | |
| 2 | Schedule, tipper zone price, raise offer, pickup charge, rating, nearest-first dispatch (first 3 drivers for 20 s), extra stop/wait with customer consent | after demand is seen |
| 3 | Auto passenger rides: capacity as seats, meter fare, ride PIN, share trip, SOS, permit/aggregator legal check | later |

## 7. Risks and open items

- Check upload infrastructure for photos/documents (customer requests already use `saveUpload`; confirm it suits documents).
- Native push for a backgrounded rider app needs Firebase set up (Android rider app work, still pending).
- Overloading, illegal goods, document expiry, rating and suspension (`is_active` works today).
- Legal: headload/union wage rules, goods and passenger aggregator permits, insurance. Not legal advice; ask a local advisor before launch.
- Test cash-in-hand with the booking fee before enabling.

## 8. Still to decide

1. Schedule in phase 1 or 2 (current: phase 2).
2. Tipper in phase 1 or 2 (current: phase 2).
3. Real rates: rate card, booking fee % / min / max, royalty per class, cancellation charge, service radius (example 20 km).
4. Driver pickup radius for dispatch.
5. Whether to reopen Mini Truck for customers: set `MINI_TRUCK_ENABLED=true`.
