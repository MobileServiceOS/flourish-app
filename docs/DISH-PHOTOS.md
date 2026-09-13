# Dish photos

**Current state: no dish photo has ever existed in this repo.** All 35 items
show the emoji tile.

That is a finding, not a regression. Checked against the whole of git history:

- every image ever committed is branding or icons — `brand/logo.png`,
  `public/icons/*`, `public/logo-*`, `public/og-image.jpg`
- **`public/items/` has never existed** in any commit
- **no item has ever carried an `img` field**

## What existed instead, and why it never worked

A helper in `src/lib/restaurant.js` built a DoorDash CDN URL out of the **Clover
item id**:

```js
export const IMG = (id) =>
  `https://img.cdn4dd.com/.../photosV2/${id}-retina-large.jpg`;
```

Those are different id namespaces. It **403'd on every item** — confirmed at the
time against all three Popular ids — so every menu render fired 43 failed
cross-origin requests and produced no photo. It was removed deliberately in
`c0fc457` (2026-07-27) and replaced by an `img` field plus an emoji fallback.

**The emoji tile is all anyone has ever seen.** Nothing was dropped by the
Clover rebuild, and nothing is being wiped by regeneration — there has never
been a mapping to wipe. If photos appeared once, it was not from this codebase.

## Getting them in: `scripts/dish-photos.mjs`

**The photos cannot be pulled from Uber Eats by tooling here.** There is no
browser tool in this setup that can hold an authenticated merchant session —
`WebFetch` fails on private URLs by design, and the available sandbox is a
remote machine nobody can log into. Download them by hand; everything after
that is scripted.

```bash
node scripts/dish-photos.mjs --list    # what is needed, and what to call each file
node scripts/dish-photos.mjs           # convert ~/Desktop/flourish-photos
node scripts/dish-photos.mjs --map     # the ITEM_PHOTOS block to paste
```

Name each file after the dish, in any case, with any punctuation and any
extension — `Oxtail.jpg`, `oxtail-plate.JPEG` and `Ox Tail.png` all find the
Oxtail. Conversion uses `sips` and `cwebp`, both already on macOS, so nothing
needs installing.

**Four dishes share a name with an everyday twin** — both Shrimps, both Salmons,
both Blue Crabs, both Crab Legs Platters — so the Seafood Fridays one takes a
`-friday` suffix: `shrimp.jpg` is the everyday $20 dish, `shrimp-friday.jpg` is
the $21.99 Friday platter. Getting that wrong puts a photo on the wrong price,
so the script refuses an ambiguous filename rather than guessing, and fails
outright if two dishes ever resolve to one filename.

It also reports, every run: which files matched nothing, and which dishes still
have no photo. Anything still over 80KB at the lowest quality is called out —
that needs a smaller source, not a smaller quality setting.

One thing worth checking before using Uber Eats photos: if any were shot under a
free-photography programme rather than by the shop, the licence may restrict
reuse. The shop's own photos are the shop's to use anywhere.

## What was actually wired up (12 dishes)

Nineteen files came from the merchant's Uber Eats listing. **Twelve are live**,
one was deliberately declined, and six have no home.

| Dish | From | Note |
|---|---|---|
| Oxtail | `oxtail.jpeg` | popular |
| Jerk Chicken | `jerk-chicken.jpeg` | popular |
| Wings | `chicken-wings.jpeg` | popular · alias |
| Salmon | `honey-garlic-salmon.jpeg` | popular · alias |
| Fried chicken | `fried-chicken.jpeg` | popular |
| Shrimp | `sweet-chili-shrimp.jpeg` | popular · alias |
| Lamb | `lamb-large.jpeg` | |
| Curried Goat | `curry-goat.jpeg` | alias — the register spells it "Curried" |
| Snapper Fish | `escovitch-fish.jpeg` | alias |
| Pasta | `chicken-pasta.jpeg` | alias |
| Ackee & Shrimp | `ackee-shrimp.jpeg` | |
| Pepper Shrimp & Mussels | `pepper-shrimp.jpeg` | Seafood Fridays |

**All six "What we're known for" dishes are covered.** 12 of 35 items have a
photo; the other 23 fall back to their emoji, which is a supported state.

### Why most of them needed an alias

The photos are named after the **flavour**, not the dish. Uber photographs what
people order — "sweet chili shrimp", "escovitch fish" — while Clover files them
as one item with a flavour group inside it. Name matching found six of nineteen
and refused the other thirteen, which is correct behaviour and not a bug.

`ALIASES` in `scripts/dish-photos.mjs` declares the link, one line per photo
with its reason, and each is checkable against the data rather than a matter of
taste: **the target item's own flavour group contains that flavour.**

### That is also how the four collisions were resolved

Only the **everyday** items carry a flavour group. The Friday SKUs have none —
the same fact that hides three of them from the app. So a flavour-named photo
has exactly one item it can belong to, and the Friday twin keeps its emoji.

`POPULAR_IDS` corroborates it independently: the generator's own comments read
`Salmon — honey garlic` and `Shrimp — sweet chilli`, which is the shop saying
which flavour represents each dish. Those are the two that were used.

Two tests hold it: at most one photo across dishes sharing a name, and a
`-friday` photo only ever on a Seafood Fridays item. Both were confirmed by
reverting — putting the everyday Shrimp photo on the Friday Shrimp fails both.

### Nothing was upscaled, and nothing arrived pre-converted

All nineteen were raw Uber downloads. Short sides ran **440-552px**, every one
of them **below the 600px spec**, and none were already 600x600 WebP.

`EDGE` is a **ceiling now, not a target**: a source is cropped at whatever short
side it has and left there. The card renders at 82 CSS px, so a 3x screen asks
for 246 — the smallest source clears that by nearly double. Upscaling to 600
would have invented pixels, grown the files and softened the tiles for no gain.
`MIN_EDGE` (246) is the floor where a source really is too small to use.

Every run now prints the source size and the edge produced, so this is visible
rather than assumed:

```
  ~ Salmon        550x552 -> 550²   42KB q82  (under the 600 spec, not upscaled)
```

All twelve came in between 28KB and 55KB at quality 82, well under the 80KB cap.

### The six with no home

| File | What it is |
|---|---|
| `flourish-storefront-hero.jpeg` / `.webp` | the storefront, not a dish — two formats of one image |
| `grilled-shrimp.jpeg` | a second Shrimp flavour; the item already has sweet chilli |
| `sweet-chili-salmon.jpeg` | a second Salmon flavour; the item already has honey garlic |
| `seafood-mac-cheese.jpeg` | Seafood Mac is a side **modifier**, not an item — nowhere to hang it |
| `white-rice.jpeg` | likewise a side modifier |
| `mac-cheese.jpeg` | declined, see below |

**The generic `Side` row was deliberately left on its emoji.** It is a picker
over 21 sides from $1 Festival to $15 Pepper Shrimp, so a mac & cheese photo
claims the row *is* mac and cheese — the same class of error as a savings pill
with nothing to anchor it. An existing test asserts that row renders its emoji,
and it was right. The storefront hero is worth keeping for a future header; it
is not a menu tile.

### The regeneration could not be run from source

`menu.data.js` says it was generated from **`inventory-export-v2-3.xlsx`**, and
that file is no longer on this machine. Only `inventory-export-v2.xlsx` remains,
and it is **the older export** — regenerating from it was tested and would have
reverted Crab Legs & Shrimp from $39.99 with the correct meal-side group to
base $0 / "from $1" with the misattached standalone group, undoing register
corrections since recorded as done.

So the `img` fields were applied to the existing generated file by the same rule
the generator uses — inserted immediately after `emoji`, exactly where
`generate-menu.mjs` emits them — and the result was verified to be **identical
to the committed data once `img` is stripped**, with every `base`/`lo`/`hi`
unchanged. The mapping itself lives in `ITEM_PHOTOS`, so the next real
regeneration reproduces this with no further work.

**To regenerate properly, put `inventory-export-v2-3.xlsx` (or a fresh export)
back and run `npm run menu -- <file>`.** Do not run it against `v2`.

## The mechanism, now that it exists

`ITEM_PHOTOS` in `scripts/generate-menu.mjs`, keyed by **Clover item id** like
`PREP_MINUTES`, so it survives every regeneration:

```js
const ITEM_PHOTOS = {
  "60KCQ1V22Q98M": "/items/oxtail.webp",   // Oxtail
};
```

To add one:

1. put the file in `public/items/`
2. add the id → path line
3. `npm run menu -- <export>`

A missing entry is supported: the card shows the emoji tile. What is not
supported is an item **losing** a photo it had — `src/test/dishPhotos.test.js`
fails on that, and the generator warns about a path pointing at a file that is
not there.

## What is needed

Photos for these 35 items. Ordered by how often they are seen: Popular first,
then the rest of Lunch & Dinner, then Seafood Fridays.

Format: **WebP, square, 600×600 or larger**, under ~80KB each. The card renders
them at 82×82 with `loading="lazy"`, and there is already a test pinning the
logo's file size because a 614KB image once broke the launch screen — so keep
them small.

| Section | Items |
|---|---|
| Lunch & Dinner (27) | Oxtail · Lamb · Curried Goat · Wings · Jerk Chicken · Fried Chicken · Brown Stew Chicken · Curry Chicken · Salmon · Shrimp · Snapper Fish · Pork · Stew Peas · Ackee & Shrimp · Shrimp & Waffles · Soup · Side · Drink · Pina Colada · Pasta · Lunch Specials · Crab Legs Platter · Lobster · Blue Crab ($20) · Crab Legs & Shrimp · Festival · Beef/Chicken patties if restored |
| Seafood Fridays (8) | Crab Legs Platter (Shrimp & 2 Sides) · Lobster Platter (Shrimp & 2 Sides) · Fish Platter (Shrimp & 2 Sides) · Shrimp · Salmon (Shrimp & 2 Sides) · Seafood Stew Peas · Blue Crab ($15) · Pepper Shrimp & Mussels |

A photo of the actual plate beats a stock image — customers compare what arrives
with what they were shown, and a stock oxtail that looks nothing like the shop's
is worse than the emoji.
