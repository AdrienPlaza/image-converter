# Chrome Web Store publishing guide

Step-by-step guide to publish Image Converter. The extension is already MV3-compliant, shipped without remote code, collects no data, and limits its network permission to retrieving the image chosen by the user.

## 1. Prerequisites

- Chrome Web Store developer account (one-time registration fee).
- Up-to-date production build:

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

- Make sure `dist/manifest.json` is at the root of the package, not inside a subfolder.
- Test the `dist/` folder through `chrome://extensions` → **Load unpacked** before every submission.

## 2. Create the archive

```powershell
if (Test-Path release) { Remove-Item release -Recurse -Force }
New-Item -ItemType Directory release | Out-Null
Compress-Archive -Path dist\* -DestinationPath release\image-converter-1.0.0.zip
```

Quick checks:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path release\image-converter-1.0.0.zip))
$zip.Entries | Select-Object -First 10 FullName
$zip.Dispose()
```

`manifest.json`, `popup.html`, `popup.js`, `background.js`, `worker.js`, `assets/` and `icons/` must be present. Do not include `node_modules`, `src`, `tests` or development files.

## 3. Store listing

### Name

`Image Converter`

### Summary (under 132 characters)

```text
Convert PNG, JPG, WebP, AVIF, GIF, BMP, ICO and TIFF locally. No upload, no tracking.
```

### Detailed description

```text
Image Converter converts images directly in your browser, with no upload to any server.

Key features:
- Drag and drop or select multiple images.
- Right-click menu "Convert this image" on any image in a page.
- Inputs: PNG, JPEG, WebP, GIF, BMP, ICO, AVIF, SVG and TIFF.
- Outputs: PNG, JPEG, WebP, AVIF, GIF, BMP, ICO and TIFF. SVG is input-only.
- Adjustable quality for JPEG, WebP and AVIF, plus AVIF encoding effort.
- Resize with aspect-ratio preservation.
- Transparent background option, or background color for formats without transparency.
- GIF animation preserved from GIF to GIF, including 1-bit transparency.
- Metadata removal, EXIF retention for JPEG to JPEG.
- Before/after preview with dimensions and file size.
- Batch queue, per-image progress, cancellation.
- Individual downloads, ZIP for batches, PNG clipboard copy.
- French and English UI, automatic light/dark theme.

Privacy:
Images stay on your device. The extension uses no server, no analytics and no identifiers. The context menu only fetches the image you selected from its original website, at your request.

Limitations:
HEIC/HEIF is not supported yet. Only GIF to GIF keeps its animation; animated WebP/AVIF are reduced to the first frame. GIF transparency is limited to 1 bit. SVG is input-only. TIFF is experimental.

GPL-3.0 licensed, open source (copyleft).
```

### Category and language

- Category: **Photos** (or Productivity tools, depending on the store listing).
- Primary language: English.

### URLs

- Homepage / support: GitHub repository URL or a project page.
- Privacy policy: see section 5.

## 4. Graphic assets

| Asset | Format | Requirement |
| --- | --- | --- |
| Store icon | PNG 128 × 128 | required |
| Screenshots | PNG/JPEG 1280 × 800 or 640 × 400, 1 to 5 | required |
| Small promotional tile | 440 × 280 | optional |
| Marquee promotional tile | 1400 × 560 | optional |

Suggested screenshots:

1. Popup with an image and the before/after preview.
2. Batch of several images with progress.
3. Context menu on a web page.
4. Resize and background color settings.
5. Warnings and an explicit HEIC error message.

For screenshots, open the popup in a tab, zoom if needed, then capture a 1280 × 800 area. Avoid personal data, private tabs and third-party brands.

## 5. Privacy

### Dashboard declaration

- Data collection: **none**.
- Data sale: **no**.
- Use for purposes unrelated to the single purpose: **no**.
- Credit granted for limited use: **yes**.
- Remote code: **no**. All scripts and WebAssembly modules are bundled in the archive.

### Permission justifications

```text
contextMenus: Adds one right-click menu item to send an image to the converter.
downloads: Saves converted images and ZIP archives requested by the user.
activeTab: Temporary access to the active tab only after the user clicks the context-menu item, to read the selected image.
scripting: Injects a temporary function in the active tab so the selected image can be read with the page's session cookies. No persistent content script is installed.
clipboardWrite: Copies the converted PNG when the user clicks Copy.
storage: Stores UI settings and the pending image URL. No personal data.
Host permissions (http/https): Required to download the exact image URL selected by the user in the context menu, including images hosted on a different CDN domain. The extension never reads page content, never modifies pages, and requests only that image URL.
```

### Privacy policy text

```text
Image Converter does not collect, store, transmit or sell personal data.

All image processing happens locally in the browser. Images are never uploaded to a server operated by the developer. The extension contains no analytics, telemetry, advertising or tracking code.

When the user chooses "Convert this image" from the context menu, the extension reads the selected image from the current tab or requests that image from its original website. This request is made only at the user's explicit request and only to the website hosting the image.

Settings are stored in chrome.storage.sync and the pending image URL in chrome.storage.session. These values remain in the browser and are not sent to the developer.

Contact: [contact email address]
```

Host this text on a stable page (GitHub repository, project page) and enter the URL in the listing. A privacy policy is recommended even when no data is collected.

## 6. Review team notes

Provide reproducible instructions:

```text
1. Load the unpacked extension from dist/.
2. Click the toolbar icon. The popup opens at 780x580.
3. Drag a PNG or JPEG into the drop zone. A before/after preview appears.
4. Choose AVIF as output. The preview uses a bundled WebAssembly encoder (no network).
5. Click "Convert all", then "Download all". A single file downloads directly; multiple files download as a ZIP.
6. Right-click any image on a web page, choose "Convert this image". The popup opens and loads that image using activeTab/scripting plus the host permission for the image URL; no persistent content script is installed.
7. Optional: test HEIC input. A localized "HEIC not supported" error is shown; no silent failure.

No remote code is loaded. The only network request is fetching the image selected by the user from its source website. wasm-unsafe-eval in the CSP is required for the bundled AVIF encoder/decoder WebAssembly.
```

Also mention:

- The `http`/`https` host permission is only used to read the URL of the image chosen by the user (required for images hosted on a third-party CDN).
- No permanent `content_scripts`.
- The service worker only registers the menu and serves the pending image.
- Settings are local/synced through Chrome, with no developer server.

## 7. Submission and publication

1. Chrome Web Store Developer Dashboard → **New item**.
2. Upload `release/image-converter-1.0.0.zip`.
3. Fill in the listing, graphic assets and Privacy tab.
4. Check the permission breakdown and review notes.
5. Submit. Review can take from a few hours to several days.
6. If rejected, fix the issue, bump the version, rebuild and submit again.

## 8. After publication

- Bump `version` in `public/manifest.json` and `package.json` on every submission.
- Keep a changelog in the release notes.
- Re-run `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` and the manual test.
- Monitor feedback on fragile formats (TIFF, CORS, HEIC).
- Keep the privacy policy available as long as no data is collected.

## 9. Common rejection reasons

- Permissions that are too broad or poorly justified (`tabs`, persistent content scripts, host permissions unrelated to the feature).
- Remote code or non-bundled WASM.
- Inaccurate data collection disclosure.
- Ambiguous single purpose (converter + editor + download manager).
- Misleading screenshots or screenshots containing personal data.
- Silent failures on unsupported formats.

The current manifest avoids these pitfalls: minimal permissions, host permission limited to reading the requested image, no page reading, local WASM, explicit errors and a clearly defined single purpose.

## 10. Final checklist

- [ ] `npm.cmd run typecheck` passes
- [ ] `npm.cmd test` passes (42 tests)
- [ ] `npm.cmd run build` passes
- [ ] `dist/manifest.json` at the archive root
- [ ] Manual test: popup, batch, ZIP, context menu, AVIF, HEIC error
- [ ] Version up to date in the manifest and `package.json`
- [ ] 128 × 128 icon and 1280 × 800 screenshots
- [ ] English description and category
- [ ] Privacy: no collection, remote code: no
- [ ] Permission justifications (including host permission)
- [ ] Review notes with test steps
- [ ] Privacy policy URL and contact
