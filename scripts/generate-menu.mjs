#!/usr/bin/env node
/**
 * Rebuild src/data/menu.data.js from a Clover inventory export.
 *
 *   Clover Dashboard -> Items -> Export  (gives you an .xlsx)
 *   npm run menu -- ~/Downloads/inventory-export.xlsx
 *
 * Nothing about the menu should ever be edited by hand. Clover is the register;
 * whatever it says is what the customer gets charged. This script is the only
 * thing that writes menu.data.js.
 *
 * It also refuses to ship data that would charge a customer wrongly, and prints
 * a report of anything mispriced in Clover so it can be fixed at the source.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/data/menu.data.js");

const KEEP_CATEGORIES = new Set(["Lunch & Dinner", "Breakfast", "Seafood Fridays", "Drinks"]);
const SKIP_ITEMS = new Set(["Gift card", "Boil Food"]); // no price set in Clover

/* Items the kitchen has stopped making, keyed by Clover id. They often stay in
   the Clover inventory long after they come off the menu, so the export keeps
   handing them to us. Delisting here rather than by name because names repeat.
   Their DESC entries are left in place — harmless, and the copy comes back if
   the dish does. */
const DELISTED = new Set([
  "NH99VMKKGJ572",   // Baked Chicken — no longer offered
]);
const SIDE_GROUP = "Side With Meal";

// Uber Eats prices, verified by hand. Only used to show what ordering direct saves.
// Re-check these occasionally; Uber changes them without telling anyone.
const UE = {
  "60KCQ1V22Q98M": 24,     // Oxtail
  "7916EWVQFPGH8": 36,     // Lamb
  "NEAR47KAE44HC": 18,     // Curried Goat
  "C2RD25C1VXNN0": 18,     // Wings
  "SJGN0N254K8KE": 16.8,   // Jerk Chicken
  "QFNQ2XQB8SPN6": 15.6,   // Fried Chicken
  "H9520PFNBT2NY": 24,     // Salmon
  "VHHCS7EDV70HC": 24,     // Shrimp
};

const EMOJI = {
  "Oxtail": "🍖", "Lamb": "🥩", "Wings": "🔥", "Lobster": "🦞", "Salmon": "🐟",
  "Shrimp": "🍤", "Snapper Fish": "🐠", "Pork": "🥓", "Pork Ribs": "🍖",
  "Curried Goat": "🍛", "Stew Peas": "🫘", "Soup": "🥣", "Pasta": "🍝",
  "Side": "🍚", "Drink": "🥤", "Blue Crab": "🦀", "Crab Legs Platter": "🦀",
  "Ackee & Shrimp": "🍤", "Chicken & Waffles": "🧇", "Shrimp & Waffles": "🧇",
  "Lunch Specials": "☀️", "Beef Patty": "🥟", "Chicken Patty": "🥟",
  "Lex Special": "⭐", "Pina Colada": "🍹", "Brown Stew Chicken": "🍛",
  "Fried chicken": "🍗", "BBQ Chicken": "🍗", "Baked Chicken": "🍗",
  "Jerk Chicken": "🍗", "Curry Chicken": "🍛", "Lobster Tail (No Meal)": "🦞",
  "Salmon (1 Piece)": "🐟", "Cornmeal Porridge": "🥣", "Banana Porridge": "🍌",
  "Hominy Corn Porridge": "🥣", "Peanut Porridge": "🥜", "Oats Porridge": "🥣",
  "Mix Up Porridge": "🥣", "Callao": "🌿", "Ackee N Saltfish": "🍳",
  "Cook Up Saltfish": "🐟", "Butterbean and Saltfish": "🫘",
  "Cabbage N Cornbeef": "🥬", "Ackee n Chicken Back": "🍳", "Fritter": "🥞",
  "Festival": "🥖", "Fry Dumpling": "🥟", "Seafood Stew Peas": "🫘",
  "Crab Legs Platter (Shrimp & 2 Sides)": "🦀", "Crab Legs & Shrimp": "🦀",
  "Fish Platter (Shrimp & 2 Sides)": "🐠", "Lobster Platter (Shrimp & 2 Sides)": "🦞",
  "Pepper Shrimp & Mussels": "🦐", "Lobster Roll & Fries": "🦞",
};

const CATEGORY_ORDER = ["Lunch & Dinner", "Seafood Fridays", "Breakfast", "Drinks"];
const CATEGORY_SUB = {
  "Lunch & Dinner": "Plates come with two sides",
  "Seafood Fridays": "Fridays only",
  "Breakfast": "Morning menu",
  "Drinks": "Refreshing beverages",
};

// Categories only sold on certain days. 0=Sun ... 6=Sat.
// The app greys the item out and says when it's back.
const CATEGORY_DAYS = { "Seafood Fridays": [5] };

// Individual items only cooked on certain days, keyed by Clover id. Takes
// precedence over CATEGORY_DAYS. Clover has no concept of a day-limited item,
// so this map is the only place that knowledge lives.
const ITEM_DAYS = {
  "32VDQ4G5J131P": [5, 6],   // Seafood Stew Peas — Fri & Sat only
};

/* Modifiers that are really a separate dish sitting in another item's size
   group. The script already catches the case where the option is named after
   its own item (see the Wings issue in CLOVER-FIXES.md); these are the ones
   that need a human to spot them.
   Hidden from customers, and excluded from the item's price range, so the row
   does not advertise a starting price for something it cannot sell.
   Keyed by "<modifier group id>::<modifier name>". */
const MISFILED_AS_SIZE = {
  // Seafood stew peas is its own $30 dish, one size, Friday and Saturday only.
  // Sold from this group it would ring up any day of the week and read as a
  // third "size" of ordinary stew peas.
  "KR1HHY64E4QPJ::Seafood": "sold as its own item, Fri & Sat only",
};

/* ============================================================================
   PRINTED MENU IS THE PRICE AUTHORITY

   The house charges what the printed menu says. Where Clover disagrees, these
   maps win and the app shows the menu price.

   !! THE REGISTER STILL RINGS THE CLOVER PRICE. !!
   Clover prices its own orders — this app deliberately sends no line prices —
   so until the Clover dashboard is updated to match, the counter and the app
   will disagree on these items. The script prints the exact list of changes to
   make in Clover every time it runs. See PRINTED-MENU-PRICES.md.
   ============================================================================ */

/* Modifier price from the printed menu. Keyed "<group id>::<modifier name>". */
const MENU_PRICE = {
  // Pork — Clover is $5-$8 under the menu on every plate
  "907Z8BF726CQ4::Medium Stew": 20,
  "907Z8BF726CQ4::Large Stew": 25,
  "907Z8BF726CQ4::Medium Jerk": 20,
  "907Z8BF726CQ4::Large Jerk": 25,
  // Pasta
  "D0F1SFXHWSQWT::Penne Alla Vodka": 18,
  "D0F1SFXHWSQWT::Oxtail": 24,
  // Sides
  "S032100JQ3P4T::Chicken Mac & Cheese": 7.0,
  // Goat head soup — Clover has both sizes at $0, the menu prices them
  "H2749PVKFN4EY::Medium Goat": 5.0,
  "H2749PVKFN4EY::Large Goat": 10.0,
  // Lunch specials — the chicken plates are $8 on the menu
  "F0Q8615QD5HMM::Curried Chicken": 8.0,
  "F0Q8615QD5HMM::Fried Chicken": 8.0,
  "F0Q8615QD5HMM::Jerk Chicken": 8.0,
  "F0Q8615QD5HMM::Stew Chicken": 8.0,
};

/* Flat-priced items whose base disagrees with the menu. Keyed by Clover id. */
const ITEM_MENU_PRICE = {
  "1PBGJ1BWC3Z52": 15.0,   // Chicken & Waffles — Clover has $15.99
};

/* On the register but not on the printed menu, so not sold in the app.
   Keyed "<group id>::<modifier name>". */
const NOT_ON_PRINTED_MENU = new Set([
  "AJY3FTT4BRPHP::Whiting Fish",     // $14 full meal, not a listed dish
  "AJY3FTT4BRPHP::Snapper Fish (Add On. No Sides)",   // menu lists fish at $30 only
  "ZR29AF0E4JPXA::Steamed",          // salmon flavours the menu does not list
  "ZR29AF0E4JPXA::Jerk",
  "4BY3GKC2SVJ90::Fried",            // shrimp flavour the menu does not list
  "F0Q8615QD5HMM::Curry Goat",       // lunch specials the menu does not list
  "F0Q8615QD5HMM::Oxtail",
  "F0Q8615QD5HMM::Wings",
]);

/* Salmon is $22 in Clover and $22 on the menu — left exactly as it is.
   Its flavour list differs between the two (Clover: Sweet Chili, Grilled,
   Steamed, Honey Garlic, Jerk / menu: Pepper, Garlic, Curry in place of Steamed
   and Jerk) but that is a flavour question, not a price one, and nobody has
   said which list is right. Untouched on purpose. */

// One line of menu copy per item, keyed by Clover id — ids rather than names
// because "Blue Crab" is two different items at two different prices.
// Clover has no description field in the export, so this map is the source of
// truth. Adding an item to Clover without adding it here just means no
// description on the row; nothing breaks.
const DESC = {
  "598S0BJH4J7DE": "Crab legs and shrimp with two sides",
  "VGZYVZCB2NCRY": "Whole lobster with two sides",
  "PZ1FB6X44MGYE": "The house plate. Ask what's on it today.",
  "21RNMJ880YCMC": "Crab legs and shrimp, no sides",
  "7916EWVQFPGH8": "Slow-braised lamb with two sides",
  "VQZ0T4XK707EC": "Brown stew, escovitch, or steamed",
  "ZTAQ37M4E9S4C": "Red peas simmered in coconut milk",
  "32VDQ4G5J131P": "Stew peas loaded with seafood. One size, large.",
  "60KCQ1V22Q98M": "Slow-cooked, fall-off-the-bone tender",
  "JAD3BJK9BSTW8": "Plain, chicken, shrimp, steak, or oxtail",
  "PEB98GZ1MBF6P": "Lobster tail on its own, no sides",
  "H9520PFNBT2NY": "Honey garlic, jerk, sweet chili, grilled, or steamed",
  "AYBW9QMTC6154": "Ackee and shrimp with two sides",
  "VHHCS7EDV70HC": "Sweet chili, garlic, curried, pepper, grilled, or fried",
  "8FW3GVMJKCGZG": "Stew or jerk, medium or large",
  "PSGB77QNZR2WM": "Blue crab with two sides",
  "QB9EKT4QGVWDA": "Shrimp over waffles, six flavors to pick from",
  "K7EX5APPAXPEJ": "Lobster roll with a side of fries",
  "C2RD25C1VXNN0": "Made to order. Pick your sauce.",
  "NH99VMKKGJ572": "Baked in island seasoning, with two sides",
  "NEAR47KAE44HC": "Tender island-style curry goat",
  "433FBT50JEVY8": "Pork ribs with two sides",
  "PH221AJ7W66EA": "Pepper shrimp and mussels, plenty of heat",
  "QFNQ2XQB8SPN6": "Fried to order, medium or large",
  "YQH6NFFB34SVM": "BBQ chicken with two sides",
  "SJGN0N254K8KE": "Jerk chicken with two sides",
  "1PBGJ1BWC3Z52": "Fried chicken over waffles, six flavors",
  "VTKZ1S1K3GPK8": "Chicken braised down in brown stew gravy",
  "9WV3BMMSC8G5E": "Chicken, goat, or seafood",
  "6NX7XK602V0ZM": "One side on its own",
  "S0GK9MD2NE414": "One piece of salmon, no sides",
  "DH0P3NGRN9RNE": "Blue crab on its own, no sides",
  "49BD3KVSBHXRR": "Curry chicken, medium or large",
  "KW21XBQ6XVTGA": "Smaller plates at lunch prices",
  "QDCGERYM91BP0": "Flaky crust, seasoned beef",
  "Y79KKCYGMHRB6": "Flaky crust, seasoned chicken",
  "BRMP82TR0Z45C": "Crab legs with shrimp and two sides",
  "A1YZ2ZD5CA1SW": "Lobster with shrimp and two sides",
  "06Z80836S0GZR": "Fish with shrimp and two sides",
  "CAFAH5FKPTRW8": "Shrimp with two sides",
  "0NQ5E11VABFDY": "Salmon with shrimp and two sides",
  "EWT1J5Q9K7KX0": "Mango, pina colada, or mixed",
  "D7MBX5PWRCGCE": "Sodas, juices, and coconut water",
};

// The six on the website's "What We're Known For", in that order.
const POPULAR_IDS = [
  "60KCQ1V22Q98M", // Oxtail
  "SJGN0N254K8KE", // Jerk Chicken
  "C2RD25C1VXNN0", // Wings
  "H9520PFNBT2NY", // Salmon — honey garlic
  "QFNQ2XQB8SPN6", // Fried Chicken
  "VHHCS7EDV70HC", // Shrimp — sweet chilli
];

const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run menu -- <path-to-clover-export.xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(resolve(src));
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });

/* ---------- modifier groups ---------- */
const groups = new Map();
let missingModifierIds = 0;
{
  let gid = null, gname = null;
  for (const r of sheet("Modifier Groups")) {
    gid = r["Modifier Group ID"] ?? gid;
    gname = r["Modifier Group Name"] ?? gname;
    if (!r["Modifier"]) continue;
    if (!groups.has(gname)) groups.set(gname, { gid, mods: [] });

    // Clover's export has changed this column's name between versions, so try
    // the ones seen in the wild. Without a modifier id the app cannot build a
    // Clover order line — see the note printed at the end of this script.
    const mid = r["Modifier ID"] ?? r["Modifier Id"] ?? r["Clover Modifier ID"] ?? null;
    if (!mid) missingModifierIds++;

    groups.get(gname).mods.push({
      n: String(r["Modifier"]).trim(),
      p: Number(r["Price"]) || 0,
      ...(mid ? { mid: String(mid).trim() } : {}),
    });
  }
}
const kindOf = (name) => {
  if (name === SIDE_GROUP) return "side";
  const mods = groups.get(name)?.mods ?? [];
  return mods.length && mods.every((m) => m.p === 0) ? "flavor" : "variant";
};

/* ---------- items (a Clover item spans several rows, one per group) ---------- */
const items = new Map();
{
  let id = null, name = null, price = null, cat = null;
  for (const r of sheet("Items")) {
    id = r["Clover ID"] ?? id;
    name = r["Name"] ?? name;
    price = r["Price"] ?? price;
    cat = r["Categories"] ?? cat;
    if (!id) continue;
    if (!items.has(id)) {
      items.set(id, { id, name: String(name).trim(), base: Number(price) || 0, cats: new Set(), groups: [] });
    }
    const it = items.get(id);
    if (cat) it.cats.add(String(cat).trim());
    const g = r["Modifier Groups"];
    if (g && !it.groups.includes(String(g).trim())) it.groups.push(String(g).trim());
  }
}

/* ---------- build, correcting anything that would mischarge ---------- */
const issues = [];
const priceEdits = [];   // where the printed menu overrode Clover
const offMenu = [];      // sold on the register, not on the printed menu
const out = [];

for (const it of items.values()) {
  const cats = [...it.cats].filter((c) => KEEP_CATEGORIES.has(c));
  if (!cats.length || SKIP_ITEMS.has(it.name) || DELISTED.has(it.id) || it.name.includes("(Catering")) continue;

  const gs = it.groups
    .filter((g) => groups.has(g))
    .map((g) => ({ gid: groups.get(g).gid, name: g, kind: kindOf(g), mods: groups.get(g).mods.map((m) => ({ ...m })) }));

  let base = it.base;
  const variants = gs.filter((g) => g.kind === "variant");

  // A base price AND a priced size group means Clover adds them together.
  if (base > 0 && variants.length) {
    issues.push(`${it.name}: base $${base} plus a priced size group — rings up double at the register`);
    base = 0;
  }

  // Printed-menu price wins over Clover, and anything not on the menu is hidden.
  for (const g of gs) {
    for (const m of g.mods) {
      const key = `${g.gid}::${m.n}`;
      if (NOT_ON_PRINTED_MENU.has(key)) {
        m.oos = true;
        offMenu.push(`${it.name}: "${m.n}" (${m.p}) is on the register but not the printed menu`);
        continue;
      }
      if (MENU_PRICE[key] !== undefined && MENU_PRICE[key] !== m.p) {
        priceEdits.push({ item: it.name, group: g.name, option: m.n, clover: m.p, menu: MENU_PRICE[key] });
        m.p = MENU_PRICE[key];
      }
    }
  }
  if (ITEM_MENU_PRICE[it.id] !== undefined && ITEM_MENU_PRICE[it.id] !== base) {
    priceEdits.push({ item: it.name, group: "(item price)", option: it.name, clover: base, menu: ITEM_MENU_PRICE[it.id] });
    base = ITEM_MENU_PRICE[it.id];
  }

  for (const g of variants) {
    for (const m of g.mods) {
      const misfiled = MISFILED_AS_SIZE[`${g.gid}::${m.n}`];
      if (misfiled) {
        m.oos = true;
        issues.push(`${it.name}: "${m.n}" ($${m.p}) sits in size group "${g.name}" but is ${misfiled}`);
        continue;
      }
      if (m.p === 0) {
        m.oos = true;
        issues.push(`${it.name}: "${m.n}" in group "${g.name}" is priced $0 — would ring up free`);
      } else if (m.n.trim().toLowerCase() === it.name.trim().toLowerCase()) {
        // an option named after its own item, sitting in that item's size group,
        // is an add-on filed in the wrong place — it reads to customers as a size
        m.oos = true;
        issues.push(`${it.name}: "${m.n}" ($${m.p}) sits inside size group "${g.name}" and reads as a size`);
      }
    }
  }

  let lo, hi;
  if (variants.length) {
    const ps = variants[0].mods.filter((m) => m.p > 0 && !m.oos).map((m) => m.p);
    if (!ps.length) continue;
    lo = Math.min(...ps); hi = Math.max(...ps);
  } else {
    lo = hi = base;
  }
  if (lo <= 0) continue;

  out.push({ id: it.id, name: it.name, cat: cats[0], base, lo, hi, groups: gs });
}

/* ---------- emit ---------- */
const byCat = new Map(CATEGORY_ORDER.map((c) => [c, []]));
for (const i of out) byCat.get(i.cat)?.push(i);
for (const list of byCat.values()) list.sort((a, b) => b.hi - a.hi);

const q = (s) => JSON.stringify(String(s));
const modStr = (m) =>
  `{ n: ${q(m.n)}, p: ${m.p}${m.mid ? `, mid: ${q(m.mid)}` : ""}${m.oos ? ", oos: true" : ""} }`;

let js = `// GENERATED FROM THE CLOVER INVENTORY EXPORT — do not hand-edit prices.
// Regenerate with:  npm run menu -- <clover-export.xlsx>
// Every id / gid is a live Clover object id, so an order maps 1:1 onto the register.
// Line price = base + selected variant modifier + side upcharges.
// Defaults to the first available option in each group (Clover's own ordering).
// oos:true marks a modifier Clover has mispriced; hidden rather than sold wrong.
// Generated ${new Date().toISOString().slice(0, 10)} from ${q(src.split("/").pop())}.
export const MENU = [
`;
for (const cat of CATEGORY_ORDER) {
  // A category with nothing in it would render as a dead chip in the app.
  if (!byCat.get(cat).length) continue;
  js += `  { cat: ${q(cat)}, sub: ${q(CATEGORY_SUB[cat])}, items: [\n`;
  for (const i of byCat.get(cat)) {
    const gs = i.groups
      .map((g) => `\n        { gid: ${q(g.gid)}, name: ${q(g.name)}, kind: ${q(g.kind)}, mods: [${g.mods.map(modStr).join(", ")}] }`)
      .join(",");
    const desc = DESC[i.id] ? `, desc: ${q(DESC[i.id])}` : "";
    const itemDays = ITEM_DAYS[i.id] ?? CATEGORY_DAYS[cat];
    const days = itemDays ? `, days: ${JSON.stringify(itemDays)}` : "";
    js += `    { id: ${q(i.id)}, name: ${q(i.name)}, emoji: ${q(EMOJI[i.name] ?? "🍽️")}${desc}${days}, base: ${i.base}, lo: ${i.lo}, hi: ${i.hi}, groups: [${gs}\n      ] },\n`;
  }
  js += `  ]},\n`;
}
js += `];

export const UE = ${JSON.stringify(UE, null, 2)};

// Used for reward eligibility
export const DRINK_ID = "D7MBX5PWRCGCE";
export const SIDE_ID  = "6NX7XK602V0ZM";

// The six on the website's "What We're Known For". The Popular section in the
// app renders these same item objects — it does not copy them.
export const POPULAR_IDS = ${JSON.stringify(POPULAR_IDS, null, 2)};

export const CAT_OF = {};
export const PLATE_IDS = new Set();   // anything served with two sides
MENU.forEach((c) => c.items.forEach((i) => {
  CAT_OF[i.id] = c.cat;
  if (i.groups.some((g) => g.kind === "side")) PLATE_IDS.add(i.id);
}));
export const hasChoices = (i) => i.groups.length > 0;
`;

writeFileSync(OUT, js);

console.log(`Wrote ${out.length} items to src/data/menu.data.js`);
for (const cat of CATEGORY_ORDER) console.log(`  ${cat}: ${byCat.get(cat).length}`);

// Warn about UE entries pointing at items that no longer exist
const ids = new Set(out.map((i) => i.id));
for (const id of Object.keys(UE)) {
  if (!ids.has(id)) console.warn(`  ! UE price set for ${id}, which is not on the menu anymore`);
}
for (const id of POPULAR_IDS) {
  if (!ids.has(id)) console.warn(`  ! Popular item ${id} is not on the menu anymore`);
}
const undescribed = out.filter((i) => !DESC[i.id]);
if (undescribed.length) {
  console.warn(`\n  ${undescribed.length} item(s) have no description — add them to DESC in this script:`);
  for (const i of undescribed) console.warn(`    ${i.id}  ${i.name}`);
}

if (missingModifierIds) {
  console.warn(
    `\n  ${missingModifierIds} modifier row(s) in this export carry no modifier id.\n` +
    "  Clover order lines need one per selected modifier. The server resolves them\n" +
    "  by name against GET /v3/merchants/{mId}/modifier_groups?expand=modifiers at\n" +
    "  order time, so ordering still works — but a modifier renamed in Clover will\n" +
    "  stop resolving and the order will be refused rather than ring up wrong.\n" +
    "  If your export has a modifier id column under another name, add it to the\n" +
    "  lookup in this script."
  );
}

if (priceEdits.length || offMenu.length) {
  console.log("\n  PRINTED MENU APPLIED — the register does NOT know about these yet.");
  console.log("  Clover prices its own orders, so until you make these changes in the");
  console.log("  Clover dashboard the counter and the app will disagree.\n");
  for (const e of priceEdits) {
    const dir = e.menu > e.clover ? "raise" : "lower";
    console.log(`    ${dir.padEnd(5)} ${e.item} / ${e.group} / ${e.option}:  ${e.clover} -> ${e.menu}`);
  }
  for (const o of offMenu) console.log(`    hide  ${o}`);
  console.log("");
}

if (issues.length) {
  console.log(`\n${issues.length} pricing issue(s) in Clover — worked around here, still need fixing at the source:`);
  for (const i of issues) console.log(`  - ${i}`);
  console.log("\nSee CLOVER-FIXES.md.");
}
