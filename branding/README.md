# The Table: logo and icons

The logo is a round table seen from above: your seat (teal, left), the other side's seat (coral,
right) and the agreed deal between them (a gold diamond), inside a graduated bezel, the guard. It is
the Calibre seal's sibling: the same inks (`apps/desktop/client/src/design/tokens.css`), the same
tick-graduated bezel, simplified so it reads at 16 px. Pure SVG: hand-built paths, no fonts, no
raster input, no vendor marks.

## Masters (edit these)

| File | Use |
|---|---|
| `logo.svg` | Colour app tile (dark rounded square), 64 px and up |
| `logo-small.svg` | Colour app tile, 16-48 px: bezel dropped, seats heavier. Also the favicon |
| `logo-mono.svg` / `logo-mono-small.svg` | One colour, transparent, `currentColor` (default `#101317`; set `color` on the `<svg>` to recolour) |
| `logo-light.svg` / `logo-light-small.svg` | Colour, transparent, for light backgrounds (day-theme inks, each at least 3:1 on white) |

The in-app mark (`apps/desktop/client/src/shared/brand/Mark.tsx`) draws the `logo-small.svg`
glyph without its tile, from `LOGO` in `shared/brand/geometry.ts`; `brand.test.tsx` fails if the
two drift apart.

`concepts/` keeps the three concepts considered (A dial, B table, C tee) and `compare.png`, each at
256/64/32/16 px on dark and light tiles. B was chosen.

## Build

Dev-only; needs Python 3.10+, Playwright for Python with Chromium, and Pillow. Not an app
dependency.

```
python branding/build-icons.py            # rebuild everything
python branding/build-icons.py --check    # rebuild, then verify .ico/.icns sizes and PNG sizes
python branding/build-icons.py --check-only
```

The output is byte-identical between runs on one machine. It writes:

| Output | What |
|---|---|
| `png/logo-{16..1024}.png`, `png/logo-light-*.png`, `png/logo-mono-{dark,light}-*.png` | 16, 24, 32, 48, 64, 128, 256, 512, 1024 px; sizes up to 48 use the `*-small` masters |
| `tray/tray-{light,dark}-{16,24,32}.png` | One-colour tray glyphs for a dark (light ink) and a light (dark ink) taskbar |
| `apps/desktop/src-tauri/icons/icon.ico` | 16, 24, 32, 48, 64, 128, 256 (each size rendered, not scaled down from one) |
| `apps/desktop/src-tauri/icons/icon.icns` | 16-1024 as PNG entries |
| `apps/desktop/src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png`, `Square*Logo.png`, `StoreLogo.png` | Tauri's conventional set and the Windows Store tiles |
| `apps/desktop/client/src/shared/brand/favicon.{svg,ico}` | Favicon for the four pages (ico: 16, 32, 48) |
| `social-1280x640.png` | Social / submission card: logo and "The Table / agents work, you decide" in the bundled Archivo over the Calibre ground |
| `thumbnail-1920x1080.png` | Desktop thumbnail: the logo over the Calibre ground |

The cards load the app's own `tokens.css` and `brand.css` (the `.br-ground` graticule) and the
bundled Archivo font from `apps/desktop/client/src/assets/fonts`; they are stylised artwork, not
screenshots of the app.
