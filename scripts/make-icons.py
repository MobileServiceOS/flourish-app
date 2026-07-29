#!/usr/bin/env python3
"""Build every app icon from brand/logo.png.

    npm run icons

Apple rejects icons with an alpha channel, so every iOS size is composited onto
the Flourish paper colour first. Pillow rather than sips: sips can pad with a
colour but leaves the alpha channel in place, which is exactly the thing the
App Store checks for.

The master lives in brand/ rather than public/ so the 7MB original is not
copied into every build; only the derived sizes ship.

Writes:
    ios/App/App/Assets.xcassets/AppIcon.appiconset/   (once `npx cap add ios` has run)
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
SRC = ROOT / "brand" / "logo.png"
IOS_SET = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
WEB_DIR = ROOT / "public" / "icons"
PAPER = (0xFB, 0xF7, 0xFC)

if not SRC.exists():
    sys.exit(f"\n  Missing {SRC.relative_to(ROOT)}\n"
             "  Put the full-resolution logo at brand/logo.png and run this again.\n")

raw = Image.open(SRC).convert("RGBA")
# The master is a square canvas with the artwork in the upper ~58% and dead
# space below. Cropping to the real content first is what stops the icon
# looking top-heavy and the header cropping the wordmark off.
box = raw.getbbox()
src = raw.crop(box) if box else raw
w, h = src.size
print(f"\n  source  {raw.size[0]}x{raw.size[1]} -> content {w}x{h}")
if w < 1024 or h < 1024:
    sys.exit(f"  Too small — the App Store marketing icon is 1024x1024, and "
             f"upscaling {w}x{h} will look soft.\n")
if w != h:
    print(f"  note    content is {w}x{h}; icons letterbox it onto a square")

# One flattened master, resized down per size. Compositing once keeps the
# edges identical across the whole set. A little breathing room round the
# artwork so it is not flush to the icon's edge.
side = int(max(w, h) * 1.12)
master = Image.new("RGB", (side, side), PAPER)
master.paste(src, ((side - w) // 2, (side - h) // 2), src)

# The wordmark on its own, transparent, for the splash and the menu header.
# Landscape, cropped to content — no object-position fudging at the CSS end.
mark = src.copy()
mark.thumbnail((1200, 1200), Image.LANCZOS)
mark.save(ROOT / "public" / "logo-mark.png", "PNG", optimize=True)
print(f"  mark    {mark.size[0]}x{mark.size[1]} -> public/logo-mark.png (transparent)")

# The classic iOS set. Recent Xcode only needs the 1024, but a full catalog
# costs nothing and covers older project templates.
IOS = [("20", 1, 20), ("20", 2, 40), ("20", 3, 60),
       ("29", 1, 29), ("29", 2, 58), ("29", 3, 87),
       ("40", 1, 40), ("40", 2, 80), ("40", 3, 120),
       ("60", 2, 120), ("60", 3, 180),
       ("76", 1, 76), ("76", 2, 152),
       ("83.5", 2, 167),
       ("1024", 1, 1024)]
WEB = [32, 48, 180, 192, 512]


def write(px: int, path: Path) -> None:
    master.resize((px, px), Image.LANCZOS).save(path, "PNG", optimize=True)


WEB_DIR.mkdir(parents=True, exist_ok=True)
for px in WEB:
    write(px, WEB_DIR / f"icon-{px}.png")
print(f"  web     {len(WEB)} sizes -> public/icons/")

if (ROOT / "ios").exists():
    if IOS_SET.exists():
        shutil.rmtree(IOS_SET)
    IOS_SET.mkdir(parents=True)
    images, done = [], set()
    for pt, scale, px in IOS:
        name = f"AppIcon-{px}.png"
        if px not in done:
            write(px, IOS_SET / name)
            done.add(px)
        images.append(
            {"size": "1024x1024", "idiom": "ios-marketing", "filename": name, "scale": "1x"}
            if pt == "1024" else
            {"size": f"{pt}x{pt}", "idiom": "ipad" if float(pt) >= 76 else "iphone",
             "filename": name, "scale": f"{scale}x"}
        )
    (IOS_SET / "Contents.json").write_text(
        json.dumps({"images": images, "info": {"version": 1, "author": "xcode"}}, indent=2) + "\n"
    )
    print(f"  ios     {len(done)} sizes -> {IOS_SET.relative_to(ROOT)}/")
else:
    print("  ios     skipped — run `npx cap add ios`, then this again")

# The whole point: prove no alpha survived anywhere Apple will look.
checked = list(WEB_DIR.glob("*.png")) + list(IOS_SET.glob("*.png"))
bad = [p for p in checked if Image.open(p).mode in ("RGBA", "LA", "P")]
if bad:
    sys.exit(f"\n  {len(bad)} icon(s) still carry alpha — the App Store will reject them.\n")
print(f"  alpha   none across {len(checked)} files, as the App Store requires\n")
