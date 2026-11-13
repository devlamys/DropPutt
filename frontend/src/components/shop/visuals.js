// Illustrations for products without a photo: an emoji picked from the name,
// served on a plate over a moody table background. Deterministic, so a
// product always looks the same.

const RULES = [
  [/biry|biriy|mandi/i, "🍛"],
  [/porotta|parotta|chapat|roti|naan|appam|dosa|puttu/i, "🫓"],
  [/shake|juice|lime|soda|cooler|coolbar|falooda|lassi/i, "🥤"],
  [/tea|chaya|coffee|kaapi/i, "☕"],
  [/puff|samosa|cutlet|roll|pazham|vada|bonda|bajji|chayakadi/i, "🥟"],
  [/cake|pastry|donut|sweet|halwa|jalebi|laddu/i, "🍰"],
  [/ice ?cream|kulfi/i, "🍨"],
  [/burger/i, "🍔"],
  [/pizza/i, "🍕"],
  [/noodle|fried rice|chow|mein/i, "🍜"],
  [/chicken|kozhi|alfaham|shawarma|broast/i, "🍗"],
  [/fish|meen|prawn|chemmeen|crab/i, "🐟"],
  [/beef|mutton|meat/i, "🥩"],
  [/meal|sadya|thali|rice|curry/i, "🍱"],
  [/egg/i, "🥚"],
  [/milk|curd|ghee|butter/i, "🥛"],
  [/veg|vegetable|onion|tomato/i, "🥬"],
  [/fruit|banana|apple|orange|mango/i, "🍎"],
  [/tablet|medicine|syrup|capsule/i, "💊"],
  [/combo/i, "🍽️"],
];

export const CATEGORY = {
  HOTEL: { label: "Food", emoji: "🍛", blurb: "Meals, biryani and curries from local hotels." },
  BAKERY_COOLBAR: { label: "Snacks & Coolbar", emoji: "🧁", blurb: "Tea-time snacks, shakes and bakes." },
  GROCERY: { label: "Grocery", emoji: "🛒", blurb: "Daily essentials from nearby stores." },
  FISH_MEAT: { label: "Fish & Meat", emoji: "🐟", blurb: "Fresh catch and cuts for today's cooking." },
  MEDICAL_PHARMACY: { label: "Medical", emoji: "💊", blurb: "Medicines from your local pharmacy." },
};
export const categoryOf = (key) => CATEGORY[key] ?? { label: "Shop", emoji: "🏪", blurb: "" };

// Table surfaces behind the plate: slate, wood, deep green, linen, walnut, blue slate.
const TABLES = ["bg-[#2B2F33]", "bg-[#3A2A1F]", "bg-[#1F2E27]", "bg-[#E9E3D6]", "bg-[#43352B]", "bg-[#22303A]"];

const hash = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
};

export function productEmoji(name, shopCategory) {
  for (const [pattern, emoji] of RULES) if (pattern.test(name)) return emoji;
  return categoryOf(shopCategory).emoji;
}

export const tableFor = (name) => TABLES[hash(name) % TABLES.length];
