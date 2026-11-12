// Illustrations for products without a photo: an emoji picked from the name
// on a soft tint. Deterministic, so a product always looks the same.

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
  HOTEL: { label: "Food", emoji: "🍛", cover: "from-orange-200 via-amber-100 to-rose-100" },
  BAKERY_COOLBAR: { label: "Snacks & Coolbar", emoji: "🧁", cover: "from-pink-200 via-rose-100 to-amber-100" },
  GROCERY: { label: "Grocery", emoji: "🛒", cover: "from-lime-200 via-emerald-100 to-teal-100" },
  FISH_MEAT: { label: "Fish & Meat", emoji: "🐟", cover: "from-sky-200 via-cyan-100 to-blue-100" },
  MEDICAL_PHARMACY: { label: "Medical", emoji: "💊", cover: "from-violet-200 via-indigo-100 to-sky-100" },
};
export const categoryOf = (key) => CATEGORY[key] ?? { label: "Shop", emoji: "🏪", cover: "from-slate-200 to-slate-100" };

const TINTS = [
  "bg-amber-100",
  "bg-orange-100",
  "bg-rose-100",
  "bg-lime-100",
  "bg-sky-100",
  "bg-violet-100",
  "bg-emerald-100",
  "bg-yellow-100",
];

export function productEmoji(name, shopCategory) {
  for (const [pattern, emoji] of RULES) if (pattern.test(name)) return emoji;
  return categoryOf(shopCategory).emoji;
}

export function productTint(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}
