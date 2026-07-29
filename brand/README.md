# Brand assets

`logo.png` is the full-resolution master (5000x5000, transparent). The artwork
sits in the upper ~58% of that square with dead space below, so the generator
crops to the real content bounds first — otherwise the app icon comes out
top-heavy and the header clips the wordmark. It lives here
rather than in `public/` because anything in `public/` is copied verbatim into
every build, and shipping a 7MB PNG that nothing references would dominate the
bundle.

Everything the app actually loads is derived from it:

| File | Size | Alpha | Used by |
|---|---|---|---|
| `public/logo-mark.png` | 1200x797 | yes | splash centrepiece, menu header |
| `public/logo-1024.png` | 1024x1024 | **no** | App Store marketing icon |
| `public/logo-192.png` | 192x192 | **no** | web manifest / PWA |
| `public/icons/icon-*.png` | 32-512 | **no** | favicon, apple-touch-icon, PWA |

Regenerate them all after replacing the master:

```bash
npm run icons
```

The iOS asset catalog is only written once `npx cap add ios` has run.

**Alpha matters.** Apple rejects an app icon with an alpha channel, so every
derived icon is composited onto the paper colour `#FBF7FC` first. The generator
fails loudly if any output still has one. `sips` cannot do this — it pads with a
colour but leaves the channel in place — which is why the script uses Pillow.
