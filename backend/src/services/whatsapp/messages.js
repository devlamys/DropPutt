// Everything the bot says, Malayalam first and English underneath, so nobody
// has to pick a language. Builders return plain message objects; client.js
// keeps them inside WhatsApp's length limits.

export const rupees = (value) => `₹${String(value).replace(/\.00$/, "")}`;
const both = (ml, en) => `${ml}\n${en}`;
// For labels inside a line: "ഭക്ഷണം / Items".
const label = (ml, en) => `${ml} / ${en}`;

export const text = (body) => ({ type: "text", body });

export const M = {
  notSupported: () =>
    text(both("ക്ഷമിക്കണം, ഇന്ത്യൻ മൊബൈൽ നമ്പറിൽ നിന്ന് മാത്രമേ ഓർഡർ എടുക്കൂ.", "Sorry, we only take orders from Indian mobile numbers.")),
  tooMany: () => text(both("ഒരുപാട് ഓർഡറുകൾ. കുറച്ച് കഴിഞ്ഞ് ശ്രമിക്കൂ.", "Too many orders. Please try again in a few minutes.")),
  noShops: () => text(both("ഇപ്പോൾ ഹോട്ടലുകൾ തുറന്നിട്ടില്ല. പിന്നീട് ശ്രമിക്കൂ.", "No shops are open right now. Please try again later.")),
  pickShop: (rows) => ({
    type: "list",
    body: both("നമസ്കാരം! 👋 ഏത് ഹോട്ടലിൽ നിന്നാണ് ഓർഡർ?", "Hello! Which shop would you like to order from?"),
    button: "Shops / ഹോട്ടൽ",
    rows,
  }),
  pickItem: (shop, rows) => ({
    type: "list",
    body: both(`${shop}\nഏത് വേണം?`, "What would you like?"),
    button: "Items / വിഭവം",
    rows,
  }),
  noItems: () => text(both("ഇപ്പോൾ ഇവിടെ ഒന്നും ലഭ്യമല്ല. മറ്റൊരു ഹോട്ടൽ നോക്കൂ.", "Nothing is available here right now. Try another shop.")),
  askQty: (name, price) => ({
    type: "buttons",
    body: both(`${name} – ${rupees(price)}\nഎത്ര എണ്ണം?`, "How many?"),
    buttons: [
      { id: "qty:1", title: "1" },
      { id: "qty:2", title: "2" },
      { id: "qty:other", title: "Other / വേറെ" },
    ],
  }),
  typeQty: () => text(both("എണ്ണം ടൈപ്പ് ചെയ്യൂ (1 മുതൽ 20 വരെ).", "Type the number (1 to 20).")),
  onlyLeft: (name, left) => text(both(`${name}: ${left} എണ്ണം മാത്രം ബാക്കി.`, `Only ${left} of ${name} left.`)),
  cart: (shop, lines, itemsTotal) => ({
    type: "buttons",
    body: `🛒 ${label("നിങ്ങളുടെ കാർട്ട്", "Your cart")} – ${shop}\n${lines}\n${label("ഭക്ഷണത്തിന്റെ തുക", "Items")}: ${rupees(itemsTotal)}`,
    buttons: [
      { id: "cart:add", title: "+ More / കൂടുതൽ" },
      { id: "cart:checkout", title: "Order / ഓർഡർ" },
      { id: "cart:clear", title: "Clear / ഒഴിവാക്കൂ" },
    ],
  }),
  cartEmpty: () => text(both("കാർട്ട് ഒഴിഞ്ഞു.", "Your cart is empty.")),
  savedAddress: (address) => ({
    type: "buttons",
    body: both(`ഈ വിലാസത്തിലേക്കാണോ?\n${address}`, "Deliver to this address?"),
    buttons: [
      { id: "addr:saved", title: "Yes / അതെ" },
      { id: "addr:new", title: "Change / മാറ്റണം" },
    ],
  }),
  askAddress: () => text(both("വീടിന്റെ പേരും വിലാസവും ടൈപ്പ് ചെയ്യൂ.", "Please type your house name and address.")),
  askLocation: () => ({
    type: "location_request",
    body: both(
      "📍 ഡെലിവറി വിലാസത്തിന്റെ ലൊക്കേഷൻ അയക്കൂ. ദൂരം നോക്കി ഡെലിവറി ചാർജ് ഉടൻ അറിയിക്കാം. താഴെയുള്ള ബട്ടൺ അമർത്തിയാൽ മതി (വേറെ സ്ഥലത്തെ വീടാണെങ്കിൽ ആ സ്ഥലം മാപ്പിൽ തിരഞ്ഞെടുത്ത് അയക്കാം).",
      "Share the delivery location and we will show the delivery charge from the distance. Tap the button (for a home elsewhere, pick that place on the map and send it)."
    ),
  }),
  noLocation: () => ({
    type: "buttons",
    body: both("ലൊക്കേഷൻ അയക്കാൻ പറ്റുന്നില്ലേ?", "Can't share a location?"),
    buttons: [{ id: "loc:help", title: "Help / സഹായം" }],
  }),
  callShop: (shop, phone) =>
    text(
      both(
        `ലൊക്കേഷൻ ഇല്ലാതെ ഓർഡർ എടുക്കാൻ കഴിയില്ല. ${shop}-നെ ${phone ?? "ഫോണിൽ"} വിളിച്ചാൽ അവർ ഡെലിവറി ഏർപ്പാടാക്കും.`,
        `We need a location to price the delivery. Call ${shop}${phone ? ` on ${phone}` : ""} and they will arrange it.`
      )
    ),
  gotLocation: () => text(both("ലൊക്കേഷൻ കിട്ടി ✅", "Location received ✅")),
  gotLandmark: () => text(both("അടയാളം കിട്ടി ✅", "Landmark noted ✅")),
  gotVoice: () => text(both("വോയിസ് നോട്ട് കിട്ടി ✅", "Voice note received ✅")),
  confirm: ({ shop, lines, quote, address, km }) => ({
    type: "buttons",
    body:
      `${both("ഓർഡർ ഉറപ്പിക്കട്ടെ?", "Please confirm")}\n${shop}\n${lines}\n` +
      `${label("ഭക്ഷണം", "Items")}: ${rupees(quote.item_total)}\n${label("ഡെലിവറി", "Delivery")}: ${rupees(quote.delivery_fee)}${km != null ? ` (${km} km)` : ""}\n` +
      `${label("ആകെ", "Total")}: ${rupees(quote.estimated_total)} (${label("പണമായി", "cash on delivery")})\n📍 ${address}`,
    buttons: [
      { id: "confirm:yes", title: "Confirm / ഉറപ്പ്" },
      { id: "confirm:no", title: "Cancel / വേണ്ട" },
    ],
  }),
  placed: ({ order_number, estimated_total, url }) =>
    text(
      `✅ ${both("ഓർഡർ സ്വീകരിച്ചു!", "Order placed!")} #${order_number}\n` +
        `${label("ആകെ", "Total")} ${rupees(estimated_total)} (${label("പണമായി", "cash on delivery")})\n` +
        `${label("ഓർഡർ കാണാൻ", "Track")}: ${url}\n` +
        `${both("വിവരം അറിയാൻ STATUS അയക്കൂ, റദ്ദാക്കാൻ CANCEL (റൈഡർ എടുക്കുന്നതിന് മുമ്പ്).", "Send STATUS for an update, CANCEL to cancel before a rider accepts.")}`
    ),
  chooseOption: () => text(both("താഴെയുള്ള ഓപ്ഷനുകളിൽ നിന്ന് തിരഞ്ഞെടുക്കൂ 👇", "Please choose one of the options 👇")),
  help: () => text(both("ഓർഡർ ചെയ്യാൻ MENU അയക്കൂ. നില അറിയാൻ STATUS, റദ്ദാക്കാൻ CANCEL.", "Send MENU to order, STATUS for your order, CANCEL to cancel.")),
  failed: (reason) => text(`${both("ക്ഷമിക്കണം", "Sorry")}: ${reason}`),
  noOrder: () => text(both("നിങ്ങൾക്ക് സജീവമായ ഓർഡർ ഇല്ല.", "You have no recent order.")),
  askCancel: (order_number, id) => ({
    type: "buttons",
    body: both(`#${order_number} റദ്ദാക്കട്ടെ?`, `Cancel order #${order_number}?`),
    buttons: [
      { id: `order:cancel:${id}`, title: "Yes, cancel / അതെ" },
      { id: "order:keep", title: "Keep / വേണ്ട" },
    ],
  }),
  cancelled: (order_number) => text(`❌ ${both("ഓർഡർ റദ്ദാക്കി", "Order cancelled")} #${order_number}`),
  cannotCancel: (reason) => text(both("ഇനി റദ്ദാക്കാൻ കഴിയില്ല.", `Cannot cancel now: ${reason}`)),
  keep: () => text(both("ശരി, ഓർഡർ തുടരും.", "OK, your order stays.")),
};

const STATUS = {
  RIDER_REQUESTED: ["റൈഡറെ തിരയുന്നു…", "Finding a rider…"],
  RIDER_ASSIGNED: ["റൈഡർ ഓർഡർ എടുത്തു", "A rider has accepted your order"],
  PICKED_UP: ["ഭക്ഷണം എടുത്തു, വഴിയിലാണ് 🛵", "Your order is picked up and on the way 🛵"],
  LOCATION_SHARED: ["റൈഡർ വരുന്നു 🛵", "The rider is coming 🛵"],
  DELIVERED: ["ഡെലിവറി കഴിഞ്ഞു. നന്ദി! 🙏", "Delivered. Thank you! 🙏"],
  CANCELLED: ["ഓർഡർ റദ്ദാക്കി", "Order cancelled"],
};

export const statusLine = (status) => both(...(STATUS[status] ?? ["", status]));
export const statusMessage = (order, url) =>
  text(`#${order.order_number}\n${statusLine(order.order_status)}${url ? `\n${url}` : ""}`);
