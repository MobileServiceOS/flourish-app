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
