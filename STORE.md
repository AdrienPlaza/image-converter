# Publication sur le Chrome Web Store

Guide pas à pas pour publier Image Converter. L'extension est déjà conforme MV3, sans code distant, sans collecte de données, avec une permission réseau limitée à la récupération de l'image choisie.

## 1. Prérequis

- Compte développeur Chrome Web Store (frais unique d'inscription).
- Build de production à jour :

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

- Vérifier que `dist/manifest.json` est bien à la racine du paquet, pas dans un sous-dossier.
- Tester le dossier `dist/` via `chrome://extensions` → **Charger l'extension non empaquetée** avant chaque envoi.

## 2. Créer l'archive

```powershell
if (Test-Path release) { Remove-Item release -Recurse -Force }
New-Item -ItemType Directory release | Out-Null
Compress-Archive -Path dist\* -DestinationPath release\image-converter-1.0.0.zip
```

Contrôles rapides :

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path release\image-converter-1.0.0.zip))
$zip.Entries | Select-Object -First 10 FullName
$zip.Dispose()
```

`manifest.json`, `popup.html`, `popup.js`, `background.js`, `worker.js`, `assets/` et `icons/` doivent apparaître. Ne pas inclure `node_modules`, `src`, `tests`, ni les fichiers de développement.

## 3. Fiche du magasin

### Nom

`Image Converter`

### Résumé (moins de 132 caractères)

```text
Convertissez PNG, JPG, WebP, AVIF, GIF, BMP, ICO, SVG et TIFF localement. Aucun envoi, aucun suivi.
```

Variante anglaise :

```text
Convert PNG, JPG, WebP, AVIF, GIF, BMP, ICO, SVG and TIFF locally. No upload, no tracking.
```

### Description détaillée (français)

```text
Image Converter convertit vos images directement dans le navigateur, sans envoi vers un serveur.

Fonctions principales :
- Glisser-déposer ou sélection de plusieurs images.
- Menu contextuel « Convertir cette image » sur n'importe quelle image d'une page.
- Entrées : PNG, JPEG, WebP, GIF, BMP, ICO, AVIF, SVG et TIFF.
- Sorties : PNG, JPEG, WebP, AVIF, GIF, BMP, ICO, SVG et TIFF.
- Qualité réglable pour JPEG, WebP et AVIF, effort d'encodage AVIF.
- Redimensionnement avec conservation des proportions.
- Couleur de fond pour les formats sans transparence.
- Suppression des métadonnées, conservation EXIF en JPEG vers JPEG.
- Aperçu avant/après avec dimensions et poids.
- File d'attente, progression image par image, annulation.
- Téléchargement individuel, ZIP pour les lots, copie PNG dans le presse-papiers.
- Interface française et anglaise, thème clair ou sombre.

Confidentialité :
Les images restent sur votre appareil. L'extension n'utilise aucun serveur, aucun analytics et aucun identifiant. Le menu contextuel récupère uniquement l'image choisie depuis son site d'origine, à votre demande.

Limites :
HEIC/HEIF n'est pas encore pris en charge. Les animations sont réduites à la première image. La sortie SVG embarque un PNG. TIFF est expérimental.

Licence MIT, code source ouvert.
```

### Description détaillée (anglais)

```text
Image Converter converts images directly in your browser, with no upload to any server.

Key features:
- Drag and drop or select multiple images.
- Right-click menu "Convert this image" on any image in a page.
- Inputs: PNG, JPEG, WebP, GIF, BMP, ICO, AVIF, SVG and TIFF.
- Outputs: PNG, JPEG, WebP, AVIF, GIF, BMP, ICO, SVG and TIFF.
- Adjustable quality for JPEG, WebP and AVIF, plus AVIF encoding effort.
- Resize with aspect-ratio preservation.
- Background color for formats without transparency.
- Metadata removal, EXIF retention for JPEG to JPEG.
- Before/after preview with dimensions and file size.
- Batch queue, per-image progress, cancellation.
- Individual downloads, ZIP for batches, PNG clipboard copy.
- French and English UI, automatic light/dark theme.

Privacy:
Images stay on your device. The extension uses no server, no analytics and no identifiers. The context menu only fetches the image you selected from its original website, at your request.

Limitations:
HEIC/HEIF is not supported yet. Animations are reduced to the first frame. SVG output embeds a PNG. TIFF is experimental.

MIT licensed, open source.
```

### Catégorie et langue

- Catégorie : **Photos** (ou Outils de productivité selon la fiche du magasin).
- Langue principale : français. Ajouter l'anglais si la fiche multilingue est disponible.

### URL

- Page d'accueil / support : URL du dépôt GitHub ou d'une page de projet.
- Politique de confidentialité : voir section 5.

## 4. Ressources graphiques

| Ressource | Format | Obligation |
| --- | --- | --- |
| Icône du magasin | PNG 128 × 128 | obligatoire |
| Captures d'écran | PNG/JPEG 1280 × 800 ou 640 × 400, 1 à 5 | obligatoire |
| Petite bannière promotionnelle | 440 × 280 | facultative |
| Bannière marquee | 1400 × 560 | facultative |

Captures suggérées :

1. Popup avec une image et l'aperçu avant/après.
2. Lot de plusieurs images avec progression.
3. Menu contextuel sur une page web.
4. Réglages de redimensionnement et de couleur de fond.
5. Avertissements et message d'erreur HEIC explicite.

Pour les captures, ouvrir le popup dans un onglet, zoomer si nécessaire, puis capturer une zone 1280 × 800. Éviter les données personnelles, les onglets privés et les marques tierces.

## 5. Confidentialité

### Déclaration dans le tableau de bord

- Collecte de données : **aucune**.
- Vente de données : **non**.
- Utilisation à des fins sans rapport avec la fonction unique : **non**.
- Crédit accordé pour l'utilisation limitée : **oui**.
- Code distant : **non**. Tous les scripts et modules WebAssembly sont embarqués dans l'archive.

### Justification des permissions

```text
contextMenus: Adds one right-click menu item to send an image to the converter.
downloads: Saves converted images and ZIP archives requested by the user.
activeTab: Temporary access to the active tab only after the user clicks the context-menu item, to read the selected image.
scripting: Injects a temporary function in the active tab so the selected image can be read with the page's session cookies. No persistent content script is installed.
clipboardWrite: Copies the converted PNG when the user clicks Copy.
storage: Stores UI settings and the pending image URL. No personal data.
Host permissions (http/https): Required to download the exact image URL selected by the user in the context menu, including images hosted on a different CDN domain. The extension never reads page content, never modifies pages, and requests only that image URL.
```

### Texte de politique de confidentialité

```text
Image Converter does not collect, store, transmit or sell personal data.

All image processing happens locally in the browser. Images are never uploaded to a server operated by the developer. The extension contains no analytics, telemetry, advertising or tracking code.

When the user chooses "Convert this image" from the context menu, the extension reads the selected image from the current tab or requests that image from its original website. This request is made only at the user's explicit request and only to the website hosting the image.

Settings are stored in chrome.storage.sync and the pending image URL in chrome.storage.session. These values remain in the browser and are not sent to the developer.

Contact: [adresse e-mail de contact]
```

Héberger ce texte sur une page stable (dépôt GitHub, page de projet) et renseigner l'URL dans la fiche. Une politique est recommandée même sans collecte.

## 6. Notes pour l'équipe de review

Fournir des instructions reproductibles :

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

Mentionner aussi :

- La permission d'hôte `http`/`https` sert uniquement à lire l'URL de l'image choisie par l'utilisateur (nécessaire pour les images hébergées sur un CDN tiers).
- Aucun `content_scripts` permanent.
- Le service worker ne fait qu'enregistrer le menu et servir l'image en attente.
- Les réglages sont locaux/synchronisés via Chrome, sans serveur développeur.

## 7. Envoi et publication

1. Chrome Web Store Developer Dashboard → **New item**.
2. Téléverser `release/image-converter-1.0.0.zip`.
3. Remplir la fiche, les ressources graphiques et l'onglet Confidentialité.
4. Vérifier la répartition des permissions et les notes de review.
5. Soumettre. La revue peut prendre de quelques heures à plusieurs jours.
6. En cas de rejet, corriger, incrémenter la version, reconstruire et soumettre à nouveau.

## 8. Après publication

- Incrémenter `version` dans `public/manifest.json` et `package.json` à chaque envoi.
- Tenir un changelog dans les notes de version.
- Rejouer `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` et le test manuel.
- Surveiller les retours sur les formats fragiles (TIFF, SVG, CORS, HEIC).
- Prévoir la politique de confidentialité tant que la collecte reste nulle.

## 9. Motifs de rejet fréquents

- Permissions trop larges ou mal justifiées (`tabs`, content scripts permanents, permissions d'hôte sans usage lié à la fonction).
- Code distant ou WASM non embarqué.
- Fiche imprécise sur la collecte de données.
- Fonction unique ambiguë (convertisseur + éditeur + gestionnaire de téléchargements).
- Captures d'écran trompeuses ou contenant des données personnelles.
- Erreurs silencieuses sur les formats non supportés.

Le manifeste actuel évite ces écueils : permissions minimales, permission d'hôte limitée à la lecture de l'image demandée, aucune lecture de page, WASM local, erreurs explicites et fonction unique clairement définie.

## 10. Checklist finale

- [ ] `npm.cmd run typecheck` vert
- [ ] `npm.cmd test` vert (38 tests)
- [ ] `npm.cmd run build` vert
- [ ] `dist/manifest.json` à la racine de l'archive
- [ ] Test manuel popup, lot, ZIP, menu contextuel, AVIF, erreur HEIC
- [ ] Version à jour dans le manifeste et `package.json`
- [ ] Icône 128 × 128 et captures 1280 × 800
- [ ] Description FR/EN et catégorie
- [ ] Confidentialité : aucune collecte, code distant : non
- [ ] Justification des permissions (dont la permission d'hôte)
- [ ] Notes de review avec étapes de test
- [ ] URL de politique de confidentialité et contact
