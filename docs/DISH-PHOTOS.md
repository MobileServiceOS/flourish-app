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
