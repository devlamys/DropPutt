// Demo data: 12 hotels with 20 dishes each, for the Kizhissery franchise.
//
//   node scripts/demo-menu.mjs                     add hotels + dishes (safe to repeat)
//   node scripts/demo-menu.mjs --images <dir>      also attach photos from <dir>/<hotel-slug>/<dish-slug>.jpg|png|webp
//   node scripts/demo-menu.mjs --prompts           print the image prompt for every dish (JSON) and exit
//   node scripts/demo-menu.mjs --remove            delete everything this script added
//
// Development placeholders only: vendor phones are 91100000xx with the seed PIN.
// Replace with real shops before going live (the production DB starts empty).

import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { saveUpload } from "../src/utils/storage.js";

const prisma = new PrismaClient();
const FRANCHISE_SLUG = "kizhissery";
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

// name | price | food category | short description | (optional) offer percent
// Categories: MEALS BIRYANI FAST_FOOD SNACKS JUICE_SHAKES BAKERY_SWEETS OTHER
const HOTELS = [
  {
    name: "Malabar Dum Biryani House", category: "HOTEL", lat: "11.1801", lng: "75.9975", min: 150, plate: "a brass handi and a banana-leaf lined steel plate",
    dishes: [
      "Chicken Dum Biryani|180|BIRYANI|Malabar-style dum biryani with tender chicken|10",
      "Mutton Dum Biryani|260|BIRYANI|Slow-cooked mutton on fragrant jeerakasala rice",
      "Beef Biryani|200|BIRYANI|Spicy Kerala beef biryani with fried onions",
      "Egg Biryani|130|BIRYANI|Boiled eggs layered with masala rice",
      "Veg Biryani|120|BIRYANI|Garden vegetables and rice cooked on dum",
      "Fish Biryani|220|BIRYANI|Seer fish pieces in spiced rice",
      "Prawns Biryani|250|BIRYANI|Juicy prawns in masala rice",
      "Chicken 65 Biryani Combo|230|BIRYANI|Biryani with crispy chicken 65 and raita",
      "Biryani Family Pack (4 pax)|640|BIRYANI|Chicken dum biryani for four with salad and raita|12",
      "Chicken Fry|110|FAST_FOOD|Kerala style crispy chicken fry",
      "Chicken 65|140|FAST_FOOD|Hot and spicy deep fried chicken bites",
      "Beef Fry|160|MEALS|Coconut slices and pepper roasted beef",
      "Chicken Curry|130|MEALS|Home style Kerala chicken curry",
      "Malabar Parotta (2 pcs)|30|MEALS|Flaky layered parotta",
      "Pathiri (3 pcs)|40|MEALS|Soft Malabar rice pathiri",
      "Raita|25|OTHER|Chilled curd with onion and cucumber",
      "Pappadam & Pickle|20|OTHER|Crisp pappadam with lime pickle",
      "Fresh Lime Soda|40|JUICE_SHAKES|Sweet or salted lime soda",
      "Caramel Pudding|60|BAKERY_SWEETS|Silky egg caramel pudding",
      "Gulab Jamun (2 pcs)|50|BAKERY_SWEETS|Warm syrupy gulab jamun",
    ],
  },
  {
    name: "Amma's Kitchen", category: "HOTEL", lat: "11.1772", lng: "75.9990", min: 120, plate: "a banana leaf",
    dishes: [
      "Kerala Meals (Veg)|90|MEALS|Rice, sambar, thoran, pachadi, pickle and pappadam|10",
      "Kerala Meals with Fish Curry|140|MEALS|Full meals with spicy meen curry",
      "Kerala Meals with Chicken|160|MEALS|Full meals with chicken curry",
      "Kerala Sadya Plate|180|MEALS|Festive plate with payasam",
      "Fish Curry Meals|130|MEALS|Red Kerala fish curry with rice",
      "Sambar Rice|70|MEALS|Comforting sambar rice with ghee",
      "Curd Rice|60|MEALS|Cooling curd rice with pomegranate",
      "Beef Roast & Parotta|150|MEALS|Dry roasted beef with 2 parottas",
      "Chicken Curry & Appam|130|MEALS|Soft appam with chicken curry",
      "Egg Roast & Appam|100|MEALS|Egg roast with 2 lacy appams",
      "Vegetable Stew & Appam|100|MEALS|Coconut milk veg stew with appam",
      "Puttu & Kadala Curry|70|MEALS|Steamed puttu with black chickpea curry",
      "Idiyappam & Egg Curry|80|MEALS|String hoppers with egg curry",
      "Karimeen Pollichathu|280|MEALS|Pearl spot fish wrapped in banana leaf",
      "Avial|60|MEALS|Mixed vegetables in coconut and curd",
      "Thoran Combo|50|MEALS|Cabbage and beans coconut thoran",
      "Payasam|50|BAKERY_SWEETS|Palada payasam in a cup",
      "Unniyappam (5 pcs)|50|SNACKS|Sweet rice and jaggery fritters",
      "Buttermilk|20|JUICE_SHAKES|Spiced Kerala sambaram",
      "Banana Fritters (3 pcs)|40|SNACKS|Crisp pazham pori",
    ],
  },
  {
    name: "Shawarma Station", category: "HOTEL", lat: "11.1815", lng: "75.9998", min: 100, plate: "a paper wrap on a wooden board",
    dishes: [
      "Chicken Shawarma Roll|90|FAST_FOOD|Garlic mayo, pickles and juicy chicken|15",
      "Chicken Shawarma Plate|150|FAST_FOOD|Shawarma with khubz, salad and garlic sauce",
      "Beef Shawarma Roll|110|FAST_FOOD|Shaved beef with tahini",
      "Mutton Shawarma|140|FAST_FOOD|Mutton shawarma in a toasted wrap",
      "Falafel Wrap|80|FAST_FOOD|Crunchy falafel with hummus",
      "Paneer Shawarma|90|FAST_FOOD|Grilled paneer with mint mayo",
      "Chicken Alfaham (Quarter)|130|FAST_FOOD|Charcoal grilled chicken with mayo and khubz",
      "Chicken Alfaham (Half)|240|FAST_FOOD|Half grilled chicken with khubz and salad",
      "Grilled Chicken Tikka|170|FAST_FOOD|Smoky tikka with mint chutney",
      "Chicken Kebab Roll|100|FAST_FOOD|Seekh kebab in a soft roll",
      "Shawarma Burger|110|FAST_FOOD|Shawarma stuffed in a toasted bun",
      "Loaded Fries|99|FAST_FOOD|Fries with cheese, chicken and sauces",
      "Peri Peri Fries|70|FAST_FOOD|Crispy fries with peri peri dust",
      "Chicken Nuggets (8 pcs)|120|FAST_FOOD|Golden crumb fried nuggets",
      "Hummus & Pita|90|OTHER|Creamy hummus with warm pita",
      "Garlic Mayo Dip|20|OTHER|Extra garlic mayonnaise",
      "Mojito (Mint)|70|JUICE_SHAKES|Fresh mint lime cooler",
      "Blue Curacao Cooler|80|JUICE_SHAKES|Sparkling blue lemonade",
      "Pepsi 500 ml|40|JUICE_SHAKES|Chilled bottle",
      "Brownie with Ice Cream|110|BAKERY_SWEETS|Warm brownie, vanilla scoop",
    ],
  },
  {
    name: "Chai Kadai", category: "BAKERY_COOLBAR", lat: "11.1790", lng: "75.9968", min: 80, plate: "a glass and a steel plate",
    dishes: [
      "Kerala Chaya|12|SNACKS|Strong milky tea|0|EVENING",
      "Masala Chai|20|SNACKS|Ginger and cardamom tea|0|EVENING",
      "Kattan Chaya|10|SNACKS|Black tea, no milk|0|EVENING",
      "Filter Coffee|20|SNACKS|South Indian filter coffee|0|EVENING",
      "Pazham Pori (2 pcs)|30|SNACKS|Banana fritters in batter|0|EVENING",
      "Uzhunnu Vada (2 pcs)|30|SNACKS|Crispy lentil doughnuts|0|EVENING",
      "Parippu Vada (2 pcs)|30|SNACKS|Crunchy dal vada|0|EVENING",
      "Egg Bonda (2 pcs)|40|SNACKS|Boiled egg in spiced gram batter|0|EVENING",
      "Onion Bhaji|30|SNACKS|Crisp onion fritters|0|EVENING",
      "Chicken Cutlet (2 pcs)|50|SNACKS|Crumb fried chicken cutlets|0|EVENING",
      "Veg Samosa (2 pcs)|30|SNACKS|Potato peas samosa|0|EVENING",
      "Egg Puff|25|SNACKS|Flaky puff with egg masala|0|EVENING",
      "Chicken Puff|30|SNACKS|Flaky puff with chicken filling|0|EVENING",
      "Chayakadi Combo (Tea + 2 Snacks)|60|SNACKS|Chaya with pazham pori and vada|10|EVENING",
      "Banana Chips|40|SNACKS|Fresh nendran banana chips",
      "Sharkara Upperi|50|SNACKS|Jaggery coated banana chips",
      "Neyyappam (3 pcs)|40|SNACKS|Ghee fried sweet rice appam",
      "Kozhukatta (3 pcs)|40|SNACKS|Steamed rice dumplings with coconut jaggery",
      "Bun Maska|25|BAKERY_SWEETS|Soft bun with butter",
      "Lime Juice|25|JUICE_SHAKES|Fresh sweet lime juice",
    ],
  },
  {
    name: "Pizza & Pasta Corner", category: "HOTEL", lat: "11.1825", lng: "75.9985", min: 200, plate: "a rustic wooden board",
    dishes: [
      "Margherita Pizza (8\")|180|FAST_FOOD|Mozzarella, basil and tomato sauce|10",
      "Farmhouse Pizza (8\")|230|FAST_FOOD|Capsicum, mushroom, onion and corn",
      "Chicken Tikka Pizza (8\")|260|FAST_FOOD|Tikka chicken with onions",
      "Pepperoni Pizza (8\")|290|FAST_FOOD|Classic spicy pepperoni",
      "BBQ Chicken Pizza (8\")|280|FAST_FOOD|Smoky barbecue chicken",
      "Paneer Tikka Pizza (8\")|240|FAST_FOOD|Tandoori paneer with peppers",
      "Cheese Burst Pizza (10\")|380|FAST_FOOD|Molten cheese-filled crust",
      "Pasta Alfredo|200|FAST_FOOD|Creamy white sauce penne",
      "Pasta Arrabbiata|190|FAST_FOOD|Spicy red sauce penne",
      "Chicken Mac & Cheese|220|FAST_FOOD|Baked macaroni with chicken",
      "Garlic Bread with Cheese|110|FAST_FOOD|Toasted garlic bread with melted cheese",
      "Stuffed Garlic Bread|140|FAST_FOOD|Garlic bread with corn and cheese",
      "Chicken Wings (6 pcs)|190|FAST_FOOD|Crispy wings with hot sauce",
      "Cheesy Fries|110|FAST_FOOD|Fries drizzled with cheese sauce",
      "Veg Sandwich Grilled|90|FAST_FOOD|Grilled sandwich with veggies and cheese",
      "Chicken Club Sandwich|140|FAST_FOOD|Triple-layer club sandwich",
      "Caesar Salad|130|OTHER|Romaine, croutons and Caesar dressing",
      "Oreo Milkshake|110|JUICE_SHAKES|Thick Oreo cookie shake",
      "Cold Coffee|90|JUICE_SHAKES|Frothy chilled coffee",
      "Choco Lava Cake|90|BAKERY_SWEETS|Warm cake with molten chocolate centre",
    ],
  },
  {
    name: "Arabian Mandi Palace", category: "HOTEL", lat: "11.1763", lng: "76.0004", min: 250, plate: "a large silver tray",
    dishes: [
      "Chicken Mandi (Single)|220|BIRYANI|Smoky mandi rice with tender chicken|10",
      "Chicken Mandi (Double)|420|BIRYANI|Mandi for two with salsa and dips",
      "Mutton Mandi (Single)|340|BIRYANI|Slow cooked mutton mandi",
      "Beef Mandi (Single)|280|BIRYANI|Spiced beef on smoky rice",
      "Fish Mandi (Single)|300|BIRYANI|Grilled fish on mandi rice",
      "Mandi Family Platter (4 pax)|1100|BIRYANI|Chicken mandi platter for four",
      "Chicken Kabsa|230|BIRYANI|Arabian spiced kabsa rice",
      "Chicken Majboos|240|BIRYANI|Gulf style rice and chicken",
      "Mutton Kabsa|350|BIRYANI|Rich mutton kabsa",
      "Grilled Chicken Full|480|FAST_FOOD|Whole charcoal grilled chicken",
      "Grilled Chicken Half|250|FAST_FOOD|Half charcoal grilled chicken",
      "Chicken Tikka Platter|300|FAST_FOOD|Mixed tikkas with salad and dips",
      "Mixed Grill Platter|580|FAST_FOOD|Chicken, kebab and tikka grill",
      "Lamb Chops (4 pcs)|520|FAST_FOOD|Marinated lamb chops grilled to order",
      "Hummus|90|OTHER|Creamy chickpea hummus",
      "Mutabbal|110|OTHER|Smoky eggplant dip",
      "Fattoush Salad|120|OTHER|Crunchy Lebanese salad",
      "Khubz (2 pcs)|20|OTHER|Fresh baked Arabic bread",
      "Lemon Mint|60|JUICE_SHAKES|Fresh mint and lemon crush",
      "Kunafa|140|BAKERY_SWEETS|Warm cheese kunafa with syrup",
    ],
  },
  {
    name: "Juice Junction", category: "BAKERY_COOLBAR", lat: "11.1796", lng: "76.0012", min: 80, plate: "a tall glass on a table",
    dishes: [
      "Mango Juice|60|JUICE_SHAKES|Fresh alphonso mango juice|10",
      "Watermelon Juice|40|JUICE_SHAKES|Chilled fresh watermelon",
      "Pineapple Juice|50|JUICE_SHAKES|Sweet fresh pineapple juice",
      "Orange Juice|60|JUICE_SHAKES|Freshly squeezed oranges",
      "Pomegranate Juice|80|JUICE_SHAKES|Fresh pomegranate juice",
      "Grape Juice|60|JUICE_SHAKES|Black grape juice",
      "Mosambi Juice|50|JUICE_SHAKES|Sweet lime juice",
      "Carrot Juice|50|JUICE_SHAKES|Fresh carrot juice",
      "Chikoo Shake|80|JUICE_SHAKES|Thick sapota milkshake",
      "Banana Shake|60|JUICE_SHAKES|Banana milkshake with nuts",
      "Chocolate Shake|90|JUICE_SHAKES|Thick chocolate milkshake",
      "Avocado Shake|110|JUICE_SHAKES|Creamy avocado shake",
      "Dates Shake|100|JUICE_SHAKES|Dates, milk and nuts",
      "Fruit Salad with Ice Cream|110|BAKERY_SWEETS|Mixed fruits with vanilla ice cream",
      "Falooda|110|BAKERY_SWEETS|Rose syrup, vermicelli and ice cream",
      "Sharjah Shake|90|JUICE_SHAKES|Banana, milk and chocolate Sharjah style",
      "Kulukki Sarbath|40|JUICE_SHAKES|Shaken lime with basil seeds",
      "Fresh Lime Soda|35|JUICE_SHAKES|Sweet or salt lime soda",
      "Virgin Mojito|70|JUICE_SHAKES|Mint, lime and soda",
      "Ice Cream Scoop (Vanilla)|40|BAKERY_SWEETS|Classic vanilla scoop",
    ],
  },
  {
    name: "Dosa Mane", category: "HOTEL", lat: "11.1780", lng: "75.9960", min: 100, plate: "a steel plate with small bowls of chutney and sambar",
    dishes: [
      "Masala Dosa|70|MEALS|Crispy dosa with potato masala|10",
      "Plain Dosa|50|MEALS|Thin crisp dosa",
      "Ghee Roast Dosa|80|MEALS|Golden ghee roast dosa",
      "Paper Roast Dosa|90|MEALS|Giant paper thin dosa",
      "Mysore Masala Dosa|90|MEALS|Red chutney smeared masala dosa",
      "Onion Uthappam|70|MEALS|Thick pancake with onion",
      "Idli (3 pcs) with Sambar|50|MEALS|Soft steamed idlis",
      "Medu Vada (2 pcs)|50|MEALS|Crisp lentil vada with sambar",
      "Idli Vada Combo|70|MEALS|2 idlis and a vada",
      "Rava Dosa|80|MEALS|Crisp semolina dosa",
      "Set Dosa (3 pcs)|60|MEALS|Soft sponge dosas with sagu",
      "Pongal|70|MEALS|Pepper cashew ven pongal",
      "Poori Masala (2 pcs)|60|MEALS|Puffed poori with potato masala",
      "Upma|50|MEALS|Soft semolina upma",
      "Chole Bhature|90|MEALS|Spicy chickpeas with fried bhature",
      "Veg Cutlet|40|SNACKS|Crisp vegetable cutlet",
      "Mini Tiffin Combo|110|MEALS|Idli, vada, dosa and pongal mini",
      "Filter Coffee|25|SNACKS|Strong decoction coffee",
      "Badam Milk|50|JUICE_SHAKES|Chilled almond milk",
      "Rava Kesari|40|BAKERY_SWEETS|Saffron sweet semolina",
    ],
  },
  {
    name: "Sweet Bake Studio", category: "BAKERY_COOLBAR", lat: "11.1808", lng: "75.9955", min: 120, plate: "a white ceramic stand",
    dishes: [
      "Chocolate Truffle Cake (500 g)|450|BAKERY_SWEETS|Rich chocolate ganache cake|10",
      "Black Forest Cake (500 g)|400|BAKERY_SWEETS|Cherries and fresh cream",
      "Red Velvet Cake (500 g)|480|BAKERY_SWEETS|Cream cheese frosted red velvet",
      "Pineapple Cake (500 g)|380|BAKERY_SWEETS|Pineapple chunks and cream",
      "Butterscotch Cake (500 g)|420|BAKERY_SWEETS|Praline crunch and caramel",
      "Chocolate Pastry|70|BAKERY_SWEETS|Single slice chocolate pastry",
      "Black Forest Pastry|60|BAKERY_SWEETS|Single slice black forest",
      "Cupcake (Chocolate)|40|BAKERY_SWEETS|Frosted chocolate cupcake",
      "Brownie|60|BAKERY_SWEETS|Fudgy chocolate brownie",
      "Doughnut (Choco Glaze)|50|BAKERY_SWEETS|Soft glazed doughnut",
      "Cream Bun|30|BAKERY_SWEETS|Sweet cream filled bun",
      "Butter Cookies (200 g)|120|BAKERY_SWEETS|Crumbly butter cookies",
      "Chocolate Chip Cookies (6)|110|BAKERY_SWEETS|Soft baked cookies",
      "Fruit Cake Slice|40|BAKERY_SWEETS|Plum fruit cake slice",
      "Mango Mousse Cup|90|BAKERY_SWEETS|Chilled mango mousse",
      "Tiramisu Cup|120|BAKERY_SWEETS|Coffee soaked tiramisu",
      "Cheese Garlic Bun|40|SNACKS|Savoury garlic cheese bun",
      "Veg Puff|25|SNACKS|Flaky puff with veg filling",
      "Chicken Roll|40|SNACKS|Baked roll with chicken filling",
      "Cold Coffee|80|JUICE_SHAKES|Creamy iced coffee",
    ],
  },
  {
    name: "Burger Barn", category: "HOTEL", lat: "11.1833", lng: "76.0008", min: 150, plate: "a paper basket on a table",
    dishes: [
      "Classic Chicken Burger|110|FAST_FOOD|Crispy chicken, lettuce and mayo|10",
      "Zinger Burger|140|FAST_FOOD|Spicy crunchy zinger fillet",
      "Double Patty Beef Burger|190|FAST_FOOD|Two beef patties with cheese",
      "Cheese Burst Burger|160|FAST_FOOD|Cheese oozing chicken burger",
      "Veg Burger|80|FAST_FOOD|Crispy veg patty burger",
      "Paneer Burger|100|FAST_FOOD|Spiced paneer patty burger",
      "BBQ Chicken Burger|150|FAST_FOOD|Smoky barbecue sauce burger",
      "Zinger Wrap|110|FAST_FOOD|Zinger chicken in a tortilla wrap",
      "Wrap Combo|114|FAST_FOOD|Zinger wrap plus lime cooler|45",
      "Chicken Strips (5 pcs)|130|FAST_FOOD|Crumb fried chicken strips",
      "Popcorn Chicken|110|FAST_FOOD|Bite sized crispy chicken",
      "French Fries|70|FAST_FOOD|Salted crispy fries",
      "Onion Rings|80|FAST_FOOD|Golden battered rings",
      "Chicken Hot Dog|100|FAST_FOOD|Sausage in a soft bun",
      "Burger Combo (Burger + Fries + Drink)|190|FAST_FOOD|Zinger burger, fries and a cola",
      "Family Bucket (8 pcs)|480|FAST_FOOD|8 pieces fried chicken with fries",
      "Coleslaw|40|OTHER|Creamy cabbage slaw",
      "Chocolate Shake|90|JUICE_SHAKES|Thick chocolate shake",
      "Lime Cooler|50|JUICE_SHAKES|Fresh lime cooler with mint",
      "Sundae|70|BAKERY_SWEETS|Soft serve with chocolate sauce",
    ],
  },
  {
    name: "Seafood Shore", category: "HOTEL", lat: "11.1758", lng: "75.9972", min: 180, plate: "a banana leaf on a steel plate",
    dishes: [
      "Fish Fry Meals|150|MEALS|Meals with crisp fish fry and curry|10",
      "Karimeen Fry|260|MEALS|Pearl spot fried with spices",
      "Prawns Roast|240|MEALS|Dry roasted prawns with curry leaves",
      "Squid Fry|220|MEALS|Crisp calamari rings Kerala style",
      "Crab Roast|320|MEALS|Spicy crab roast",
      "Fish Curry (Kudampuli)|140|MEALS|Red fish curry with kudampuli",
      "Mathi Fry (2 pcs)|110|MEALS|Crisp fried sardines",
      "Ayala Fry|160|MEALS|Mackerel marinated and fried",
      "Kingfish Fry (Neymeen)|230|MEALS|Seer fish fry",
      "Fish Moilee|180|MEALS|Coconut milk fish stew",
      "Prawns Curry|200|MEALS|Coconut prawns curry",
      "Fish Biryani|220|BIRYANI|Seer fish biryani",
      "Fish Cutlet (2 pcs)|60|SNACKS|Crisp fish cutlets",
      "Tapioca & Fish Curry|120|MEALS|Kappa with spicy meen curry",
      "Fish Thali|200|MEALS|Fish fry, curry, meals and thoran",
      "Chemmeen Fried Rice|190|MEALS|Prawns fried rice",
      "Fish Finger Platter|160|FAST_FOOD|Crumb fried fish fingers with tartare",
      "Lime Soda|30|JUICE_SHAKES|Sweet or salt lime soda",
      "Tender Coconut|50|JUICE_SHAKES|Fresh coconut water",
      "Elaneer Payasam|60|BAKERY_SWEETS|Tender coconut payasam",
    ],
  },
  {
    name: "Chinese Wok", category: "HOTEL", lat: "11.1819", lng: "75.9948", min: 150, plate: "a black plate with chopsticks",
    dishes: [
      "Chicken Fried Rice|130|FAST_FOOD|Wok tossed rice with chicken|10",
      "Veg Fried Rice|100|FAST_FOOD|Veg and egg fried rice",
      "Egg Fried Rice|110|FAST_FOOD|Fried rice with scrambled egg",
      "Schezwan Fried Rice|140|FAST_FOOD|Spicy schezwan rice",
      "Hakka Noodles (Chicken)|130|FAST_FOOD|Stir fried noodles with chicken",
      "Hakka Noodles (Veg)|100|FAST_FOOD|Stir fried veg noodles",
      "Schezwan Noodles|140|FAST_FOOD|Fiery schezwan noodles",
      "Chilli Chicken|160|FAST_FOOD|Indo-Chinese chilli chicken",
      "Chicken Manchurian|150|FAST_FOOD|Crispy chicken in manchurian gravy",
      "Gobi Manchurian|120|FAST_FOOD|Crisp cauliflower in manchurian sauce",
      "Dragon Chicken|170|FAST_FOOD|Crispy chicken tossed with cashew",
      "Honey Chilli Potato|100|FAST_FOOD|Sweet and spicy crispy potatoes",
      "Spring Rolls (4 pcs)|90|FAST_FOOD|Crispy veg spring rolls",
      "Chicken Momos (6 pcs)|100|FAST_FOOD|Steamed chicken dumplings with chutney",
      "Veg Momos (6 pcs)|80|FAST_FOOD|Steamed vegetable dumplings",
      "Chicken Lollipop (5 pcs)|160|FAST_FOOD|Crispy lollipops with schezwan dip",
      "Hot & Sour Soup|70|OTHER|Peppery hot and sour soup",
      "Sweet Corn Soup|60|OTHER|Creamy corn soup",
      "Combo Meal (Rice + Chilli Chicken)|190|FAST_FOOD|Fried rice with chilli chicken",
      "Honey Noodles with Ice Cream|90|BAKERY_SWEETS|Crispy noodles, honey and ice cream",
    ],
  },
];

const slug = (text) => text.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const parseDish = (line) => {
  const [name, price, category, description, offer, slot] = line.split("|");
  return { name, price: Number(price), category, description, offer: Number(offer || 0), snack: slot === "EVENING" };
};

function prompt(hotel, dish) {
  return (
    `Professional food photography of ${dish.name}: ${dish.description}. Served on ${hotel.plate}, ` +
    `authentic Kerala restaurant presentation, vibrant appetising colours, steam rising where it is hot, ` +
    `soft natural window light, 45 degree angle, shallow depth of field, rich textures, clean blurred background, ` +
    `ultra sharp, high resolution, no text, no logo, no watermark`
  );
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

async function main() {
  if (flag("--prompts")) {
    const list = HOTELS.flatMap((hotel) =>
      hotel.dishes.map(parseDish).map((dish) => ({
        hotel: hotel.name,
        file: `${slug(hotel.name)}/${slug(dish.name)}.jpg`,
        prompt: prompt(hotel, dish),
      }))
    );
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  const franchise = await prisma.franchise.findUnique({ where: { slug: FRANCHISE_SLUG } });
  if (!franchise) throw new Error(`Franchise ${FRANCHISE_SLUG} not found. Run the seed first.`);

  if (flag("--remove")) {
    const where = { franchise_id: franchise.id, user: { phone: { startsWith: "91100000" } } };
    const vendors = await prisma.vendor.findMany({ where, select: { id: true, user_id: true } });
    const ids = vendors.map((v) => v.id);
    const used = await prisma.orderItem.count({ where: { product: { vendor_id: { in: ids } } } });
    if (used > 0) throw new Error(`${used} order items use these dishes; they cannot be removed. Archive them instead.`);
    await prisma.product.deleteMany({ where: { vendor_id: { in: ids } } });
    await prisma.vendor.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: vendors.map((v) => v.user_id) } } });
    console.log(`Removed ${ids.length} demo hotels.`);
    return;
  }

  const imagesDir = option("--images");
  const pin = process.env.SEED_DEFAULT_PIN || "1234";
  const pin_hash = await argon2.hash(pin);
  let createdDishes = 0;
  let photos = 0;

  // Dishes are created round-robin (one from each hotel in turn), so the home list, which
  // shows the newest first, mixes hotels instead of showing one hotel's menu in a block.
  const shops = [];
  for (const [index, hotel] of HOTELS.entries()) {
    const phone = `91100000${String(index + 1).padStart(2, "0")}`;
    const user = await prisma.user.upsert({
      where: { franchise_id_phone: { franchise_id: franchise.id, phone } },
      update: {},
      create: { franchise_id: franchise.id, name: hotel.name, phone, role: "VENDOR", pin_hash },
    });
    const vendor = await prisma.vendor.upsert({
      where: { user_id: user.id },
      update: {},
      create: {
        franchise_id: franchise.id,
        user_id: user.id,
        shop_name: hotel.name,
        shop_category: hotel.category,
        address: `${hotel.name.split(" ")[0]} Road, Kizhissery, Malappuram, Kerala`,
        lat: hotel.lat,
        lng: hotel.lng,
        commission_rate: "10.00",
        min_order_value: String(hotel.min),
        commission_free_until: new Date(Date.now() + 183 * 86_400_000),
      },
    });
    shops.push({ hotel, vendor });
  }

  const rounds = Math.max(...HOTELS.map((h) => h.dishes.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const { hotel, vendor } of shops) {
      if (!hotel.dishes[round]) continue;
      const dish = parseDish(hotel.dishes[round]);
      let product = await prisma.product.findFirst({ where: { vendor_id: vendor.id, name: dish.name } });
      if (!product) {
        product = await prisma.product.create({
          data: {
            vendor_id: vendor.id,
            name: dish.name,
            price: dish.price,
            description: dish.description,
            food_category: dish.category,
            slot_type: dish.snack ? "EVENING_SNACKS_3_TO_6" : "ALL_DAY",
            ...(dish.offer ? { offer_price: Math.round(dish.price * (100 - dish.offer)) / 100, offer_label: `${dish.offer}% off` } : {}),
          },
        });
        createdDishes += 1;
      }
      if (imagesDir && !product.image_url) {
        const base = path.join(imagesDir, slug(hotel.name), slug(dish.name));
        for (const ext of Object.keys(MIME)) {
          const buffer = await fs.readFile(`${base}${ext}`).catch(() => null);
          if (!buffer) continue;
          const image_url = await saveUpload({ buffer, mimetype: MIME[ext] }, `products/${franchise.id}/${vendor.id}`);
          await prisma.product.update({ where: { id: product.id }, data: { image_url } });
          photos += 1;
          break;
        }
      }
    }
  }
  console.log(`${HOTELS.length} hotels ready, ${createdDishes} new dishes${imagesDir ? `, ${photos} photos attached` : ""}.`);
  console.log(`Vendor logins: 9110000001 to 91100000${String(HOTELS.length).padStart(2, "0")}, PIN ${pin} (development only).`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
