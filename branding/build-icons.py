"""Build every raster brand asset of The Table from the SVG masters in this folder.

Dev-only. Needs Python 3.10+, Playwright for Python with Chromium (renders the SVGs and the cards) and
Pillow (packs .ico and .icns). Nothing here is a runtime dependency of the app. Run from anywhere:

    python branding/build-icons.py            # everything
    python branding/build-icons.py --check    # rebuild, then verify the .ico/.icns and the sizes

Masters (hand-built SVG, no fonts, no raster input):
    logo.svg             colour app tile, from 64 px up
    logo-small.svg       colour app tile, 16-48 px (bezel dropped, strokes heavier)
    logo-mono.svg        one colour, transparent (currentColor), from 64 px up
    logo-mono-small.svg  one colour, transparent, 16-48 px
    logo-light.svg       colour, transparent, for light backgrounds, from 64 px up
    logo-light-small.svg colour, transparent, for light backgrounds, 16-48 px
Outputs: see README.md.
"""
from __future__ import annotations

import argparse
import io
import pathlib
import struct
import sys

from PIL import Image
from playwright.sync_api import Page, sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / 'apps' / 'desktop' / 'client'
TAURI_ICONS = ROOT / 'apps' / 'desktop' / 'src-tauri' / 'icons'
BRAND_SRC = CLIENT / 'src' / 'shared' / 'brand'
PNG_OUT = HERE / 'png'
TRAY_OUT = HERE / 'tray'

SMALL_MAX = 48  # sizes up to this use the *-small masters
PNG_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_SIZES = (16, 32, 64, 128, 256, 512, 1024)
# Tauri's conventional icon set (`tauri icon` output names) plus the Windows Store tiles.
TAURI_PNGS = {
    '32x32.png': 32, '128x128.png': 128, '128x128@2x.png': 256, 'icon.png': 512,
    'Square30x30Logo.png': 30, 'Square44x44Logo.png': 44, 'Square71x71Logo.png': 71,
    'Square89x89Logo.png': 89, 'Square107x107Logo.png': 107, 'Square142x142Logo.png': 142,
    'Square150x150Logo.png': 150, 'Square284x284Logo.png': 284, 'Square310x310Logo.png': 310,
    'StoreLogo.png': 50,
}
INK_DARK = '#101317'   # mono on light grounds
INK_LIGHT = '#e4ecf3'  # mono on dark grounds (the night --text)


def master(name: str, size: int) -> str:
    small = HERE / f'{name}-small.svg'
    return (small if size <= SMALL_MAX and small.exists() else HERE / f'{name}.svg').read_text(encoding='utf-8')


def render_svg(page: Page, svg: str, size: int, color: str | None = None) -> Image.Image:
    if color is not None:
        svg = svg.replace('color="#101317"', f'color="{color}"', 1)
    svg = svg.replace('<svg ', f'<svg width="{size}" height="{size}" ', 1)
    page.set_viewport_size({'width': size, 'height': size})
    page.set_content(f'<!doctype html><html><body style="margin:0;background:transparent">{svg}</body></html>')
    png = page.screenshot(omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
    return Image.open(io.BytesIO(png)).convert('RGBA')


def render_page(page: Page, html: pathlib.Path, w: int, h: int, out: pathlib.Path) -> None:
    page.set_viewport_size({'width': w, 'height': h})
    page.goto(html.as_uri())
    page.evaluate('document.fonts.ready')
    page.screenshot(path=str(out), clip={'x': 0, 'y': 0, 'width': w, 'height': h})


def card_html(kind: str, w: int, h: int) -> str:
    """The social card and the desktop thumbnail: the logo over the Calibre ground (the app's own tokens.css
    and brand.css ground), the line set in the bundled Archivo. Stylised artwork, not a screenshot."""
    tokens = (CLIENT / 'src' / 'design' / 'tokens.css').as_uri()
    brand = (BRAND_SRC / 'brand.css').as_uri()
    archivo = (CLIENT / 'src' / 'assets' / 'fonts' / 'archivo' / 'archivo-latin-standard-normal.woff2').as_uri()
    logo = (HERE / 'logo.svg').read_text(encoding='utf-8')
    if kind == 'social':
        body = f'''<div class="lock">{logo}<div class="words"><h1>The Table</h1>
<p>agents work, you decide</p></div></div>'''
        gx, gy, mark = '22%', '50%', 360
    else:
        body = f'<div class="solo">{logo}</div>'
        gx, gy, mark = '50%', '50%', 440
    return f'''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="{tokens}"><link rel="stylesheet" href="{brand}">
<style>
@font-face {{ font-family: "Archivo"; src: url("{archivo}") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }}
html, body {{ margin: 0; width: {w}px; height: {h}px; overflow: hidden; background: var(--bg); }}
.stage {{ position: relative; width: {w}px; height: {h}px; --gx: {gx}; --gy: {gy}; }}
.lock, .solo {{ position: absolute; inset: 0; display: flex; align-items: center; z-index: 1; }}
.solo {{ justify-content: center; }}
.lock {{ padding-left: 96px; gap: 64px; }}
svg {{ width: {mark}px; height: {mark}px; flex: none; filter: drop-shadow(0 24px 48px rgb(0 0 0 / .45)); }}
h1 {{ margin: 0; font-family: "Archivo", sans-serif; font-weight: 300; font-size: 104px; letter-spacing: -.01em; color: var(--text); line-height: 1; }}
p {{ margin: 22px 0 0; font-family: "Archivo", sans-serif; font-weight: 500; font-stretch: 87.5%; font-size: 40px; letter-spacing: .04em; color: var(--muted); }}
</style></head><body><div class="stage"><div class="br-ground" data-variant="polar"></div>{body}</div></body></html>'''


def write_icns(path: pathlib.Path, images: dict[int, Image.Image]) -> None:
    """ICNS with PNG payloads (the OSTypes macOS reads for PNG data)."""
    types = {16: b'icp4', 32: b'icp5', 64: b'icp6', 128: b'ic07', 256: b'ic08', 512: b'ic09', 1024: b'ic10'}
    chunks = b''
    for size in ICNS_SIZES:
        buf = io.BytesIO()
        images[size].save(buf, format='PNG')
        data = buf.getvalue()
        chunks += types[size] + struct.pack('>I', len(data) + 8) + data
    path.write_bytes(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)


def build() -> None:
    PNG_OUT.mkdir(exist_ok=True)
    TRAY_OUT.mkdir(exist_ok=True)
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    need = sorted(set(PNG_SIZES) | set(ICO_SIZES) | set(ICNS_SIZES) | set(TAURI_PNGS.values()))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        tile = {s: render_svg(page, master('logo', s), s) for s in need}
        for s in PNG_SIZES:
            tile[s].save(PNG_OUT / f'logo-{s}.png')
            render_svg(page, master('logo-mono', s), s, INK_DARK).save(PNG_OUT / f'logo-mono-dark-{s}.png')
            render_svg(page, master('logo-mono', s), s, INK_LIGHT).save(PNG_OUT / f'logo-mono-light-{s}.png')
            render_svg(page, master('logo-light', s), s).save(PNG_OUT / f'logo-light-{s}.png')
        # Tray: one colour, transparent, for a dark and a light taskbar. The shell draws its tray icon in
        # code today (native.rs tray_icon); these are ready for when it loads an asset instead.
        for s in (16, 24, 32):
            render_svg(page, master('logo-mono', s), s, INK_LIGHT).save(TRAY_OUT / f'tray-light-{s}.png')
            render_svg(page, master('logo-mono', s), s, INK_DARK).save(TRAY_OUT / f'tray-dark-{s}.png')
        for name, s in TAURI_PNGS.items():
            tile[s].save(TAURI_ICONS / name)
        largest = tile[max(ICO_SIZES)]
        largest.save(TAURI_ICONS / 'icon.ico', format='ICO', sizes=[(s, s) for s in ICO_SIZES],
                     append_images=[tile[s] for s in ICO_SIZES if s != max(ICO_SIZES)])
        write_icns(TAURI_ICONS / 'icon.icns', tile)
        # Web: the favicon is the small tile (it reads on light and dark browser chrome alike).
        (BRAND_SRC / 'favicon.svg').write_text((HERE / 'logo-small.svg').read_text(encoding='utf-8'), encoding='utf-8')
        tile[48].save(BRAND_SRC / 'favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)],
                      append_images=[tile[16], tile[32]])
        for kind, w, h, out in (('social', 1280, 640, 'social-1280x640.png'), ('thumb', 1920, 1080, 'thumbnail-1920x1080.png')):
            html = HERE / f'.{kind}.html'
            html.write_text(card_html(kind, w, h), encoding='utf-8')
            try:
                render_page(page, html, w, h, HERE / out)
            finally:
                html.unlink()
        browser.close()


def check() -> None:
    ico = Image.open(TAURI_ICONS / 'icon.ico')
    sizes = sorted(s[0] for s in ico.info['sizes'])
    assert sizes == sorted(ICO_SIZES), sizes
    fav = sorted(s[0] for s in Image.open(BRAND_SRC / 'favicon.ico').info['sizes'])
    assert fav == [16, 32, 48], fav
    data = (TAURI_ICONS / 'icon.icns').read_bytes()
    assert data[:4] == b'icns' and struct.unpack('>I', data[4:8])[0] == len(data)
    icns = Image.open(TAURI_ICONS / 'icon.icns')
    icns_sizes = sorted(s[0] * s[2] for s in icns.info['sizes'])
    assert set(ICNS_SIZES) <= set(icns_sizes), icns_sizes
    for name, s in TAURI_PNGS.items():
        assert Image.open(TAURI_ICONS / name).size == (s, s), name
    for out, wh in (('social-1280x640.png', (1280, 640)), ('thumbnail-1920x1080.png', (1920, 1080))):
        assert Image.open(HERE / out).size == wh, out
    print(f'icon.ico sizes {sizes}; favicon.ico {fav}; icon.icns sizes {icns_sizes}; {len(TAURI_PNGS)} Tauri PNGs ok')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='verify the outputs after building')
    ap.add_argument('--check-only', action='store_true', help='verify without rebuilding')
    a = ap.parse_args()
    if not a.check_only:
        build()
    if a.check or a.check_only:
        check()
    sys.exit(0)
