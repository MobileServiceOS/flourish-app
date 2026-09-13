Dish photos go here, referenced from `ITEM_PHOTOS` in `scripts/generate-menu.mjs`
by Clover item id. See docs/DISH-PHOTOS.md.

Nothing in this directory is generated — the files are the source. The mapping
lives in the generator so a regeneration cannot lose it.

Do not `rm -rf` this directory to force a reconversion; that takes this file
with it, which is how it went missing once. `scripts/dish-photos.mjs` overwrites
each `.webp` in place, so re-running it is enough.
