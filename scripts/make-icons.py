#!/usr/bin/env python3
"""Build every app icon from the logo master.

    npm run icons

RUN THIS AFTER `npx cap sync ios`. Sync restores Capacitor's template
AppIcon.appiconset — a plain placeholder — over whatever is already there, which
is how the home screen ends up showing a generic icon. `npm run ios` chains them
in the right order.

Apple rejects icons with an alpha channel, so every size is composited onto the
Flourish paper colour first. Pillow rather than sips: sips can pad with a colour
but leaves the alpha channel in place, which is exactly what the App Store
checks for.

Writes:
    ios/App/App/Assets.xcassets/AppIcon.appiconset/   (once the platform exists)
    public/logo-mark.png                              (cropped, transparent)
    public/logo-1024.png, public/logo-192.png         (flattened)
    public/icons/                                     (web, PWA, favicon)
"""
import json
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is missing.  pip3 install Pillow")

ROOT = Path(__file__).resolve().parent.parent
IOS_SET = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
WEB_DIR = ROOT / "public" / "icons"
PAPER = (0xFB, 0xF7, 0xFC)

# brand/ is where the master belongs — public/ is copied verbatim into every
# build and a 7MB PNG would dominate it. public/ is still accepted so a logo
# dropped in the obvious place still works.
CANDIDATES = [ROOT / "brand" / "logo.png", ROOT / "public" / "logo.png"]
SRC = next((p for p in CANDIDATES if p.exists()), None)
if SRC is None:
    sys.exit("\n  No logo found. Put it at brand/logo.png and run this again.\n")

raw = Image.open(SRC).convert("RGBA")
# The master is a square canvas with the artwork in the upper ~58% and dead
# space below. Cropping to the real content first is what stops the icon
# looking top-heavy and the header clipping the wordmark.
box = raw.getbbox()
src = raw.crop(box) if box else raw
w, h = src.size
print(f"\n  source  {SRC.relative_to(ROOT)}  {raw.size[0]}x{raw.size[1]} -> content {w}x{h}")
if max(w, h) < 1024:
    sys.exit(f"  Too small — the marketing icon is 1024x1024 and upscaling "
             f"{w}x{h} will look soft.\n")

# One flattened square master, resized per size. Compositing once keeps every
# icon's edges identical. A little breathing room so the art is not flush to
# the icon's edge.
side = int(max(w, h) * 1.12)
master = Image.new("RGB", (side, side), PAPER)
master.paste(src, ((side - w) // 2, (side - h) // 2), src)

# The wordmark alone, transparent, for the splash and the menu header.
mark = src.copy()
mark.thumbnail((1200, 1200), Image.LANCZOS)
mark.save(ROOT / "public" / "logo-mark.png", "PNG", optimize=True)
print(f"  mark    {mark.size[0]}x{mark.size[1]} -> public/logo-mark.png (transparent)")


def write(px: int, path: Path) -> None:
    master.resize((px, px), Image.LANCZOS).save(path, "PNG", optimize=True)


# ---- web ----
WEB_DIR.mkdir(parents=True, exist_ok=True)
for px in (32, 48, 180, 192, 512):
    write(px, WEB_DIR / f"icon-{px}.png")
write(1024, ROOT / "public" / "logo-1024.png")
write(192, ROOT / "public" / "logo-192.png")
print("  web     5 sizes -> public/icons/  + logo-1024, logo-192")

# ---- iOS ----
# The classic catalog, with the idioms Apple actually defines. iPhone has no 1x
# icons — 20/29/40pt at 1x are iPad-only — and tagging those "iphone" makes
# Xcode ignore the entry, which is one way to end up with a blank icon.
IOS = [
    ("iphone", "20x20", "2x", 40), ("iphone", "20x20", "3x", 60),
    ("iphone", "29x29", "2x", 58), ("iphone", "29x29", "3x", 87),
    ("iphone", "40x40", "2x", 80), ("iphone", "40x40", "3x", 120),
    ("iphone", "60x60", "2x", 120), ("iphone", "60x60", "3x", 180),
    ("ipad", "20x20", "1x", 20), ("ipad", "20x20", "2x", 40),
    ("ipad", "29x29", "1x", 29), ("ipad", "29x29", "2x", 58),
    ("ipad", "40x40", "1x", 40), ("ipad", "40x40", "2x", 80),
    # 76x76@1x is iOS 9 and earlier; Xcode warns if it is present
    ("ipad", "76x76", "2x", 152),
    ("ipad", "83.5x83.5", "2x", 167),
    ("ios-marketing", "1024x1024", "1x", 1024),
]

images = []
if (ROOT / "ios").exists():
    if IOS_SET.exists():
        shutil.rmtree(IOS_SET)
    IOS_SET.mkdir(parents=True)

    done = set()
    for idiom, size, scale, px in IOS:
        name = f"AppIcon-{px}.png"
        if px not in done:
            write(px, IOS_SET / name)
            done.add(px)
        images.append({"filename": name, "idiom": idiom, "scale": scale, "size": size})

    (IOS_SET / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n"
    )
    print(f"  ios     {len(done)} files, {len(images)} catalog entries")
else:
    print("  ios     skipped — run `npx cap add ios`, then this again")

# ---- verify ----
checked = sorted(WEB_DIR.glob("*.png"))
if IOS_SET.exists():
    checked += sorted(IOS_SET.glob("*.png"))
bad = [p.name for p in checked if Image.open(p).mode in ("RGBA", "LA", "P")]
if bad:
    sys.exit(f"\n  {len(bad)} icon(s) still carry alpha — the App Store rejects those: "
             f"{', '.join(bad)}\n")

if images:
    listed = {i["filename"] for i in images}
    on_disk = {p.name for p in IOS_SET.glob("*.png")}
    missing = listed - on_disk
    if missing:
        sys.exit(f"\n  Contents.json references files that are not there: {missing}\n")
    print(f"  check   {len(listed)} catalog files all present, no alpha across {len(checked)}\n")
else:
    print(f"  check   no alpha across {len(checked)} files\n")
