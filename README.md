# Image Converter

A Chrome extension (Manifest V3) for **100% local** image conversion. No server uploads, no telemetry, no account. Images are decoded, resized and re-encoded inside a Web Worker using `OffscreenCanvas` and WebAssembly.

- **Formats**: reads PNG, JPEG, WebP, GIF, BMP, ICO, AVIF, SVG and TIFF; writes PNG, JPEG, WebP, AVIF, GIF, BMP, ICO and TIFF. SVG is input-only.
- Popup: drag and drop or file selection, multi-image batches, before/after preview.
- Context menu: right-click an image → **Convert this image**.
- Output: individual downloads, ZIP for batches, PNG copy to clipboard.
- French and English UI, automatic light/dark theme.
- GPL-3.0 license (copyleft): any redistributed modified version must remain open source.

## Installation

Requirements: Node.js 20+ and Chrome 127+ (or a compatible Chromium browser, tested on Brave 155).

```powershell
npm.cmd install
npm.cmd run build
```

On Windows, `npm.cmd` avoids the PowerShell execution-policy block on `npm.ps1`. On macOS/Linux, use `npm`.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dist/` folder.

The toolbar button opens the popup. For the context menu, right-click an image on a web page and choose **Convert this image** (Chrome 127+ opens the popup automatically).

### Development

```powershell
npm.cmd run dev        # continuous build (vite build --watch)
npm.cmd run typecheck  # tsc --noEmit
npm.cmd test           # 42 Vitest tests
npm.cmd run build      # typecheck + production build
```

After each build, reload the extension from `chrome://extensions` (reload icon). Icons can be regenerated with `npm.cmd run icons`.

## Usage

### Popup

1. Drag images into the drop zone, click **Choose images**, or use the context menu.
2. Set the output format, quality, resizing, transparent or solid background, metadata handling and filename template.
3. The **Before / After** preview updates automatically (400 ms after the last change).
4. **Convert all** processes the queue sequentially. Each image can also be downloaded or copied individually.
5. **Download all** downloads the single result directly, or a ZIP when several images are ready. **Copy** re-encodes to PNG because Chrome only accepts that type on the clipboard.

### Context menu

Right-clicking stores the image URL (and source tab), opens the popup, then the image is retrieved:

1. through a temporary injection into the page (`activeTab` permission, no permanent content script);
2. otherwise through a service-worker request;
3. otherwise an explicit error is displayed. Images protected by CORS or behind a session may therefore fail, but never silently.

### Files and names

Default template: `{name}_converted.{ext}`. Available variables:

| Variable | Value |
| --- | --- |
| `{name}` | original name without extension |
| `{ext}` | output extension (`jpg`, `png`, …) |
| `{index}` | position in the queue (1, 2, …) |
| `{width}`, `{height}` | output dimensions |
| `{date}` | local date `YYYY-MM-DD` |

The extension is appended automatically when the template does not contain `{ext}`. Forbidden characters are replaced, and duplicates are suffixed with ` (2)`, ` (3)`, etc.

## Formats

### Input

| Format | Decoding | Notes |
| --- | --- | --- |
| PNG | native | alpha preserved |
| JPEG | native | EXIF read, orientation applied by Chrome |
| WebP | native | animated: first frame |
| GIF | native | animated: first frame, except to GIF with “Keep animation” |
| BMP | native | |
| ICO | native | best image in the icon |
| AVIF | native | Chrome decodes AVIF |
| SVG | native | requires intrinsic dimensions or a usable `viewBox` |
| TIFF | WASM (UTIF) | experimental, uncompressed/basic TIFF |
| HEIC/HEIF | not supported (MVP) | explicit error, planned for v1.1 |

Detection first uses binary signatures (magic bytes), then MIME type and extension. An empty, unknown or HEIC file produces a localized error.

### Output

| Format | Encoder | Alpha | Quality | Notes |
| --- | --- | --- | --- | --- |
| PNG | native | yes | no | lossless, compression handled by Chrome |
| JPEG | native | no | yes (1–100) | background forced when the image has alpha, with a warning |
| WebP | native | yes | yes (1–100) | |
| AVIF | WASM (`@jsquash/avif`) | yes | yes + effort 1–10 | slower, local WASM (~3.5 MB) |
| GIF | `gifenc` | 1-bit (optional) | no | static or animated (GIF → GIF), 256 colors; background applied when the option is unchecked |
| BMP | custom | no | no | 24-bit BGR, uncompressed, background forced when the image has alpha |
| ICO | custom | yes | no | PNG payload, resized to 256 px maximum |
| TIFF | WASM (UTIF) | yes | no | uncompressed, experimental |

Resizing keeps the aspect ratio by default (“contain” mode when both width and height are provided). Safety limits: 32,767 px per side and 268,435,456 px of area; beyond that, an `image-too-large` error is shown.

## Options

- **Output format**: the eight formats above. SVG is input-only.
- **Quality**: visible for JPEG, WebP and AVIF. No effect on lossless formats; PNG, BMP, ICO, GIF and TIFF use their native setting.
- **AVIF effort**: 1 (fast) to 10 (smaller file, slower).
- **Resize**: width and/or height, aspect ratio preserved, or no change.
- **Keep animation**: visible for GIF output. If the input is an animated GIF, all frames and delays are re-encoded; unchecked, only the first frame is kept. Works with resizing and background color.
- **Transparent background**: checked by default. Preserves alpha for compatible formats and adds 1-bit transparency to GIFs (static and animated). Unchecked, the image is flattened onto the background color.
- **Background color**: used when alpha is flattened, and always forced for JPEG and BMP, which cannot store transparency. White by default.
- **Remove metadata**: checked by default. See the EXIF section.
- **Filename template**: see above.

Settings are stored in `chrome.storage.sync`. The language (`auto`, `fr`, `en`) follows the browser UI language by default.

## Conversion pipeline

1. **Detection** (`src/core/formats.ts`): reads magic bytes (PNG, JPEG, GIF, WebP, BMP, ICO, TIFF little/big endian, AVIF/HEIC, textual SVG), with MIME/extension fallback. HEIC is intercepted before decoding.
2. **Planning** (`planConversion` in `src/core/converter.ts`): computes target dimensions, reduces ICO to 256 px, detects upscaling and alpha flattening (only when transparency is disabled or the target format cannot store alpha). Pure function, tested.
3. **Decoding**: `createImageBitmap` on a Blob for native formats; normalized SVG (injects `width`/`height` from the `viewBox` when needed); TIFF via UTIF; animated GIF → GIF via `ImageDecoder` (WebCodecs), frame by frame. No data leaves the worker.
4. **Rendering**: `OffscreenCanvas` with high smoothing; fills the background color only when alpha must be flattened; `drawImage` at the target dimensions. This is where the EXIF orientation already applied by Chrome is baked into the pixels.
5. **Encoding**: `convertToBlob` for PNG/JPEG/WebP; custom encoders for BMP/ICO; `gifenc` for GIF (one pass per frame, delays preserved, optional 1-bit transparency); `@jsquash/avif` for AVIF; UTIF for TIFF. The buffer is transferred to the popup (`postMessage` with transfer).
6. **EXIF**: see below.
7. **Naming**: template, variables, sanitization, uniqueness.
8. **Warnings**: merged and deduplicated, then displayed in the preview.

Only one conversion runs in the worker at a time; requests are serialized. Cancelling a batch terminates the worker and recreates it, which actually interrupts the current decode/encode.

### EXIF

- **JPEG → JPEG**: the APP1 EXIF segment is copied. Orientation is reset to `1` because Chrome has already applied the rotation during decoding; an `exif-orientation-baked` warning reports this case.
- **JPEG → other format**: metadata cannot be preserved; an `exif-stripped` warning is shown when the option is unchecked.
- **JPEG without EXIF → JPEG**: `exif-absent` warning.
- **“Remove metadata” checked**: no EXIF segment is reinserted.
- Other metadata (XMP, ICC, comments) is not preserved by the canvas pass.

### Warnings

The UI displays an explicit warning for every fragile case:

| Code | Meaning |
| --- | --- |
| `svg-rasterized` | the source SVG is rasterized |
| `gif-static` | the GIF output is static (animation option unchecked or static input) |
| `gif-256` | the GIF output is limited to 256 colors |
| `gif-alpha` | GIF transparency is limited to 1 bit (semi-transparent pixels become opaque or transparent) |
| `ico-resized` | the icon was reduced to 256 px maximum |
| `tiff-decode-experimental` | experimental TIFF decoding |
| `tiff-encode-experimental` | experimental, uncompressed TIFF encoding |
| `animation-first-frame` | animation reduced to the first frame (GIF to another format, or option unchecked) |
| `exif-stripped` | source EXIF cannot be preserved in the target format |
| `exif-absent` | no EXIF to preserve |
| `exif-orientation-baked` | EXIF orientation baked into pixels, then reset to 1 |
| `alpha-flattened` | transparency flattened onto the background color |
| `upscaled` | image upscaled |

## Architecture

```text
popup.html                    popup page (780 × 580)
src/
  background/background.ts    context menu, image retrieval, badge
  core/
    converter.ts              decode → render → encode → EXIF orchestration
    formats.ts                capabilities, detection, warnings
    worker.ts                 dedicated worker, serialized requests
    workerClient.ts           worker client, cancellation, transfers
    codecs/                   BMP, ICO, GIF, AVIF, TIFF, SVG input
    metadata.ts               JPEG EXIF extraction/insertion
    resize.ts                 dimension calculation and canvas limits
    naming.ts                 filename template and uniqueness
    output.ts                 download, ZIP, clipboard
    settings.ts               persistent settings
  popup/                      controller and styles
  i18n/                       fr.json / en.json dictionaries
public/manifest.json          MV3 manifest
tests/                        formats, core, codecs, converter
tools/make-icons.ps1          icon generation
```

## Privacy and permissions

No image is sent to a server. No telemetry, analytics or identifiers. The service worker contacts only the URL of the image selected through the context menu, just as the browser would.

| Permission | Justification |
| --- | --- |
| `contextMenus` | “Convert this image” menu item |
| `downloads` | saves converted files and ZIP archives |
| `activeTab` | temporary access to the current tab, only after the menu is clicked |
| `scripting` | retrieves the image within the page (session cookies), without a permanent content script |
| `clipboardWrite` | copies the converted PNG |
| `storage` | synced settings and pending image URL |
| `host_permissions` (`http`/`https`) | reads the exact image chosen by the user, even when it is hosted on another domain (CDN, Pinterest, etc.) |

Host permission is used only to download the image URL selected through the context menu: no page content is read, no navigation is modified, and no other domain is contacted. The CSP allows only local scripts and `wasm-unsafe-eval` for bundled WebAssembly modules: no remote code, no `eval`.

## Known limitations

- **HEIC/HEIF**: not supported in the MVP (explicit error). A WASM decoder is planned for v1.1.
- **PNG**: the compression level cannot be adjusted through `OffscreenCanvas`; Chrome chooses the compression. The quality slider is therefore hidden for PNG.
- **Animations**: only animated GIF → GIF is preserved (option checked by default, 1000 frames maximum). GIF to another format and animated WebP/AVIF are reduced to the first frame, with a warning.
- **SVG**: input-only. SVG files are rasterized to pixels; wrapping a PNG back into an SVG would add no value. An SVG without intrinsic dimensions or a usable `viewBox` is rejected.
- **GIF**: 256 colors. Transparency is optional and limited to 1 bit: semi-transparent pixels become opaque or transparent. In animations, each frame is re-encoded independently (no global palette).
- **TIFF**: experimental, uncompressed output.
- **EXIF**: preserved only for JPEG → JPEG, and orientation is baked into the pixels.
- **Protected images**: an image behind authentication, a paywall or anti-hotlink protection may remain inaccessible; the error is displayed explicitly.
- **Clipboard**: Chrome only accepts `image/png`; other formats are re-encoded to PNG for copying.
- **Chrome only**: MV3, `chrome.action.openPopup`, `OffscreenCanvas`.

## Roadmap

### MVP — v1.0.0 (current)

Popup, batches, context menu, eight output formats, drag and drop, before/after preview, resizing, alpha handling, JPEG → JPEG EXIF, warnings, ZIP, clipboard, FR/EN i18n, automatic theme, unit tests, Vite build.

### v1 — consolidation and publishing

- HEIC/HEIF WASM decoder loaded on demand.
- Real PNG compression control (dedicated encoder) if needed.
- WebP/AVIF animation preservation (GIF → GIF already supported).
- End-to-end browser tests and Chrome Web Store publication.
- Multi-resolution ICO icons and compressed TIFF.

### v2 — beyond

- Conversion profiles and presets, folder processing.
- Cropping, rotation, selective EXIF stripping and metadata preview.
- Firefox/Edge version and demo page.

## Contributing

Contributions are welcome. Please run `npm.cmd run typecheck`, `npm.cmd test` and `npm.cmd run build` before submitting a change. The code is commented in English, and the UI is bilingual through `src/i18n/*.json`.

## License

GNU General Public License v3.0 (GPL-3.0-only) © 2026 Adrien. See [LICENSE](LICENSE).

This is a **strong copyleft** license: you may use, copy, modify and redistribute the project, including commercially, but any redistributed modified version must remain under GPL-3.0 and provide its source code. Proprietary or closed-source versions are not allowed.

Dependencies keep their respective licenses (`@jsquash/avif`, `fflate`, `gifenc`, `utif`).
