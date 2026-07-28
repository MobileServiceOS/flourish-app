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

const KEEP_CATEGORIES = new Set(["Lunch & Dinner", "Breakfast", "Seafood Fridays"]);
const SKIP_ITEMS = new Set(["Gift card", "Boil Food"]); // no price set in Clover
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

const CATEGORY_ORDER = ["Lunch & Dinner", "Seafood Fridays", "Breakfast"];
const CATEGORY_SUB = {
  "Lunch & Dinner": "Plates come with two sides",
  "Seafood Fridays": "Fridays only",
  "Breakfast": "Morning menu",
};

const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run menu -- <path-to-clover-export.xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(resolve(src));
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });

/* ---------- modifier groups ---------- */
const groups = new Map();
{
  let gid = null, gname = null;
  for (const r of sheet("Modifier Groups")) {
    gid = r["Modifier Group ID"] ?? gid;
    gname = r["Modifier Group Name"] ?? gname;
    if (!r["Modifier"]) continue;
    if (!groups.has(gname)) groups.set(gname, { gid, mods: [] });
    groups.get(gname).mods.push({ n: String(r["Modifier"]).trim(), p: Number(r["Price"]) || 0 });
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
const out = [];

for (const it of items.values()) {
  const cats = [...it.cats].filter((c) => KEEP_CATEGORIES.has(c));
  if (!cats.length || SKIP_ITEMS.has(it.name) || it.name.includes("(Catering")) continue;

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

  for (const g of variants) {
    for (const m of g.mods) {
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
const modStr = (m) => `{ n: ${q(m.n)}, p: ${m.p}${m.oos ? ", oos: true" : ""} }`;

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
  js += `  { cat: ${q(cat)}, sub: ${q(CATEGORY_SUB[cat])}, items: [\n`;
  for (const i of byCat.get(cat)) {
    const gs = i.groups
      .map((g) => `\n        { gid: ${q(g.gid)}, name: ${q(g.name)}, kind: ${q(g.kind)}, mods: [${g.mods.map(modStr).join(", ")}] }`)
      .join(",");
    js += `    { id: ${q(i.id)}, name: ${q(i.name)}, emoji: ${q(EMOJI[i.name] ?? "🍽️")}, base: ${i.base}, lo: ${i.lo}, hi: ${i.hi}, groups: [${gs}\n      ] },\n`;
  }
  js += `  ]},\n`;
}
js += `];

export const UE = ${JSON.stringify(UE, null, 2)};

// Used for reward eligibility
export const DRINK_ID = "D7MBX5PWRCGCE";
export const SIDE_ID  = "6NX7XK602V0ZM";

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

if (issues.length) {
  console.log(`\n${issues.length} pricing issue(s) in Clover — worked around here, still need fixing at the source:`);
  for (const i of issues) console.log(`  - ${i}`);
  console.log("\nSee CLOVER-FIXES.md.");
}
