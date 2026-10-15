"""Builds the two tray icons the desktop shell embeds as raw RGBA (no PNG decoder needed in Rust).

    python branding/build-tray.py

Reads branding/png/logo-32.png (the small colour logo, drawn at 32 px) and writes
apps/desktop/src-tauri/icons/tray.rgba and tray-attention.rgba: 32x32, 4 bytes per pixel,
row-major, straight alpha. The attention variant adds a gold dot with a dark ring top-right
(a deal needs the owner). Deterministic: the same input gives the same bytes.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "apps" / "desktop" / "src-tauri" / "icons"
SIZE = 32
SS = 8  # supersampling for the dot's edge

base = Image.open(ROOT / "png" / "logo-32.png").convert("RGBA")
assert base.size == (SIZE, SIZE), base.size


def dot_layer() -> Image.Image:
    big = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    cx, cy, r = 26 * SS, 6 * SS, 6 * SS
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(16, 19, 23, 255))  # ring in the ground colour
    r2 = 4 * SS
    d.ellipse((cx - r2, cy - r2, cx + r2, cy + r2), fill=(224, 182, 90, 255))  # --gold
    return big.resize((SIZE, SIZE), Image.LANCZOS)


def raw(img: Image.Image) -> bytes:
    return img.convert("RGBA").tobytes()


OUT.mkdir(parents=True, exist_ok=True)
(OUT / "tray.rgba").write_bytes(raw(base))
attention = base.copy()
attention.alpha_composite(dot_layer())
(OUT / "tray-attention.rgba").write_bytes(raw(attention))
print("wrote", OUT / "tray.rgba", OUT / "tray-attention.rgba", SIZE * SIZE * 4, "bytes each")
