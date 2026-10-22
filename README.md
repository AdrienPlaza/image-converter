# Image Converter

Extension Chrome (Manifest V3) de conversion d'images, **100 % locale**. Aucun envoi vers un serveur, aucune télémétrie, aucun compte. Les images sont décodées, redimensionnées et réencodées dans un Web Worker via `OffscreenCanvas` et WebAssembly.

- Popup : glisser-déposer ou sélection de fichiers, lot multi-images, aperçu avant/après.
- Menu contextuel : clic droit sur une image → **Convertir cette image**.
- Sortie : téléchargement individuel, ZIP pour un lot, copie PNG dans le presse-papiers.
- Interface française et anglaise, thème clair/sombre automatique.
- Licence GPL-3.0 (copyleft) : toute version modifiée redistribuée doit rester open source.

## Installation

Prérequis : Node.js 20+ et Chrome 127+ (ou un navigateur Chromium compatible, testé sur Brave 155).

```powershell
npm.cmd install
npm.cmd run build
```

Sous Windows, `npm.cmd` évite le blocage PowerShell de `npm.ps1`. Sous macOS/Linux, utilisez `npm`.

1. Ouvrez `chrome://extensions`.
2. Activez **Mode développeur**.
3. Cliquez **Charger l'extension non empaquetée**.
4. Sélectionnez le dossier `dist/`.

Le bouton de l'extension ouvre le popup. Pour le menu contextuel, faites un clic droit sur une image d'une page web puis **Convertir cette image** (Chrome 127+ ouvre le popup automatiquement).

### Développement

```powershell
npm.cmd run dev        # build en continu (vite build --watch)
npm.cmd run typecheck  # tsc --noEmit
npm.cmd test           # 38 tests Vitest
npm.cmd run build      # typecheck + build de production
```

Après chaque build, rechargez l'extension depuis `chrome://extensions` (icône de rechargement). Les icônes peuvent être régénérées avec `npm.cmd run icons`.

## Utilisation

### Popup

1. Glissez des images dans la zone prévue, cliquez **Choisir des images**, ou utilisez le menu contextuel.
2. Réglez le format de sortie, la qualité, le redimensionnement, le fond transparent ou coloré, les métadonnées et le modèle de nom.
3. L'aperçu **Avant / Après** se met à jour automatiquement (400 ms après la dernière modification).
4. **Tout convertir** traite la file séquentiellement. Chaque image peut aussi être téléchargée ou copiée individuellement.
5. **Tout télécharger** télécharge directement l'unique résultat, ou un ZIP si plusieurs images sont prêtes. **Copier** réencode en PNG car Chrome ne met que ce type dans le presse-papiers.

### Menu contextuel

Le clic droit enregistre l'URL de l'image (et l'onglet source), ouvre le popup, puis l'image est récupérée :

1. par injection éphémère dans la page (permission `activeTab`, aucun content script permanent) ;
2. sinon par requête du service worker ;
3. sinon une erreur explicite est affichée. Les images protégées par CORS ou derrière une session peuvent donc échouer, mais jamais en silence.

### Fichiers et noms

Modèle par défaut : `{name}_converted.{ext}`. Variables disponibles :

| Variable | Valeur |
| --- | --- |
| `{name}` | nom d'origine sans extension |
| `{ext}` | extension de sortie (`jpg`, `png`, …) |
| `{index}` | position dans la file (1, 2, …) |
| `{width}`, `{height}` | dimensions de sortie |
| `{date}` | date locale `AAAA-MM-JJ` |

L'extension est ajoutée automatiquement si le modèle ne contient pas `{ext}`. Les caractères interdits sont remplacés et les doublons sont suffixés ` (2)`, ` (3)`, etc.

## Formats

### Entrée

| Format | Décodage | Remarques |
| --- | --- | --- |
| PNG | natif | alpha conservé |
| JPEG | natif | EXIF lu, orientation appliquée par Chrome |
| WebP | natif | animé : première image |
| GIF | natif | animé : première image, sauf vers GIF avec « Conserver l'animation » |
| BMP | natif | |
| ICO | natif | meilleure image de l'icône |
| AVIF | natif | Chrome décode l'AVIF |
| SVG | natif | nécessite des dimensions intrinsèques ou un `viewBox` exploitable |
| TIFF | WASM (UTIF) | expérimental, TIFF non compressés/basiques |
| HEIC/HEIF | non supporté (MVP) | erreur explicite, prévu en v1.1 |

La détection se fait d'abord par signature binaire (magic bytes), puis par type MIME et extension. Un fichier vide, inconnu ou HEIC produit une erreur localisée.

### Sortie

| Format | Encodeur | Alpha | Qualité | Remarques |
| --- | --- | --- | --- | --- |
| PNG | natif | oui | non | sans perte, compression gérée par Chrome |
| JPEG | natif | non | oui (1–100) | fond forcé si l'image a de l'alpha, avec avertissement |
| WebP | natif | oui | oui (1–100) | |
| AVIF | WASM (`@jsquash/avif`) | oui | oui + effort 1–10 | plus lent, WASM local (~3,5 Mo) |
| GIF | `gifenc` | 1 bit (option) | non | statique ou animé (GIF → GIF), 256 couleurs ; fond appliqué si l'option est décochée |
| BMP | maison | non | non | 24 bits BGR, non compressé, fond forcé si l'image a de l'alpha |
| ICO | maison | oui | non | entrée PNG, redimensionné à 256 px maximum |
| SVG | maison | oui | non | PNG encodé en base64 dans un SVG (pas de vectorisation) |
| TIFF | WASM (UTIF) | oui | non | non compressé, expérimental |

Le redimensionnement conserve les proportions par défaut (mode « contain » quand largeur et hauteur sont fournies). Limites de sécurité : 32 767 px par côté et 268 435 456 px de surface ; au-delà, une erreur `image-too-large` est affichée.

## Options

- **Format de sortie** : les neuf formats ci-dessus.
- **Qualité** : visible pour JPEG, WebP et AVIF. Sans effet sur les formats sans perte ; PNG, BMP, ICO, GIF et TIFF utilisent leur réglage natif.
- **Effort AVIF** : 1 (rapide) à 10 (fichier plus petit, plus lent).
- **Redimensionnement** : largeur et/ou hauteur, proportions conservées, ou aucune modification.
- **Conserver l'animation** : visible pour la sortie GIF. Si l'entrée est un GIF animé, toutes les images et leurs délais sont ré-encodés ; décoché, seule la première image est conservée. Cohérent avec le redimensionnement et la couleur de fond.
- **Fond transparent** : coché par défaut. Conserve l'alpha des formats compatibles et ajoute une transparence 1 bit aux GIF (statiques et animés). Décoché, l'image est aplatie sur la couleur de fond.
- **Couleur de fond** : utilisée quand l'alpha est aplati, et toujours imposée pour JPEG et BMP qui ne stockent pas de transparence ; blanc par défaut.
- **Supprimer les métadonnées** : coché par défaut. Voir la section EXIF.
- **Modèle de nom** : voir ci-dessus.

Les réglages sont conservés dans `chrome.storage.sync`. La langue (`auto`, `fr`, `en`) suit par défaut la langue de l'interface du navigateur.

## Pipeline de conversion

1. **Détection** (`src/core/formats.ts`) : lecture des magic bytes (PNG, JPEG, GIF, WebP, BMP, ICO, TIFF little/big endian, AVIF/HEIC, SVG textuel), repli MIME/extension. Un format HEIC est intercepté avant décodage.
2. **Planification** (`planConversion` dans `src/core/converter.ts`) : calcul des dimensions cibles, réduction ICO à 256 px, détection de l'agrandissement et de l'aplatissement alpha (uniquement si la transparence est désactivée ou si le format cible ne gère pas l'alpha). Fonction pure, testée.
3. **Décodage** : `createImageBitmap` sur un Blob pour les formats natifs ; SVG normalisé (injection de `width`/`height` depuis le `viewBox` si nécessaire) ; TIFF via UTIF ; GIF animé → GIF via `ImageDecoder` (WebCodecs), image par image. Aucune donnée ne sort du worker.
4. **Rendu** : `OffscreenCanvas` avec lissage high ; remplissage de la couleur de fond uniquement si l'alpha doit être aplati ; `drawImage` aux dimensions cibles. C'est ici que l'orientation EXIF déjà appliquée par Chrome est figée dans les pixels.
5. **Encodage** : `convertToBlob` pour PNG/JPEG/WebP ; encodeurs maison pour BMP/ICO/SVG ; `gifenc` pour GIF (une passe par image, délais conservés, transparence 1 bit optionnelle) ; `@jsquash/avif` pour AVIF ; UTIF pour TIFF. Le buffer est transféré au popup (`postMessage` avec transfert).
6. **EXIF** : voir ci-dessous.
7. **Nommage** : modèle, variables, assainissement, unicité.
8. **Avertissements** : fusionnés et dédupliqués, puis affichés dans l'aperçu.

Une seule conversion tourne à la fois dans le worker ; les requêtes sont sérialisées. Annuler un lot termine le worker et le recrée, ce qui interrompt réellement le décodage/encodage en cours.

### EXIF

- **JPEG → JPEG** : le segment APP1 EXIF est recopié. L'orientation est remise à `1` car Chrome a déjà appliqué la rotation au décodage ; un avertissement `exif-orientation-baked` signale ce cas.
- **JPEG → autre format** : les métadonnées ne peuvent pas être conservées ; avertissement `exif-stripped` si l'option est décochée.
- **JPEG sans EXIF → JPEG** : avertissement `exif-absent`.
- **Option « Supprimer les métadonnées » cochée** : aucun segment EXIF n'est réinséré.
- Les autres métadonnées (XMP, ICC, commentaires) ne sont pas préservées par le passage canvas.

### Avertissements

L'interface affiche un avertissement explicite pour chaque cas fragile :

| Code | Signification |
| --- | --- |
| `svg-rasterized` | le SVG source est rasterisé |
| `svg-embedded` | le SVG de sortie contient un PNG, pas des vecteurs |
| `gif-static` | la sortie GIF est statique (option d'animation décochée ou entrée fixe) |
| `gif-256` | la sortie GIF est limitée à 256 couleurs |
| `gif-alpha` | transparence GIF limitée à 1 bit (les pixels semi-transparents deviennent opaques ou transparents) |
| `ico-resized` | l'icône a été réduite à 256 px maximum |
| `tiff-decode-experimental` | décodage TIFF expérimental |
| `tiff-encode-experimental` | encodage TIFF expérimental, non compressé |
| `animation-first-frame` | animation réduite à la première image (GIF vers un autre format, ou option décochée) |
| `exif-stripped` | EXIF source non conservable dans le format cible |
| `exif-absent` | aucun EXIF à conserver |
| `exif-orientation-baked` | orientation EXIF intégrée aux pixels puis remise à 1 |
| `alpha-flattened` | transparence aplatie sur la couleur de fond |
| `upscaled` | image agrandie |

## Architecture

```text
popup.html                    page du popup (780 × 580)
src/
  background/background.ts    menu contextuel, récupération d'image, badge
  core/
    converter.ts              orchestration décodage → rendu → encodage → EXIF
    formats.ts                capacités, détection, avertissements
    worker.ts                 worker dédié, requêtes sérialisées
    workerClient.ts           client worker, annulation, transferts
    codecs/                   BMP, ICO, GIF, SVG, AVIF, TIFF
    metadata.ts               extraction/insertion EXIF JPEG
    resize.ts                 calcul des dimensions et limites canvas
    naming.ts                 modèle de nom et unicité
    output.ts                 téléchargement, ZIP, presse-papiers
    settings.ts               réglages persistants
  popup/                      contrôleur et styles
  i18n/                       dictionnaires fr.json / en.json
public/manifest.json          manifeste MV3
tests/                        formats, core, codecs, converter
tools/make-icons.ps1          génération des icônes
```

## Confidentialité et permissions

Aucune image n'est envoyée à un serveur. Aucune télémétrie, aucun analytics, aucun identifiant. Le service worker ne contacte que l'URL de l'image choisie via le menu contextuel, comme le ferait le navigateur.

| Permission | Justification |
| --- | --- |
| `contextMenus` | entrée « Convertir cette image » |
| `downloads` | enregistrement des fichiers convertis et des ZIP |
| `activeTab` | accès temporaire à l'onglet courant, uniquement après le clic sur le menu |
| `scripting` | récupération de l'image dans la page (cookies de session), sans content script permanent |
| `clipboardWrite` | copie du PNG converti |
| `storage` | réglages synchronisés et URL d'image en attente |
| `host_permissions` (`http`/`https`) | lire l'image exacte choisie par l'utilisateur, même si elle est hébergée sur un autre domaine (CDN, Pinterest, etc.) |

La permission d'hôte sert uniquement à télécharger l'URL de l'image sélectionnée via le menu contextuel : aucun contenu de page n'est lu, aucune navigation n'est modifiée et aucun autre domaine n'est contacté. La CSP n'autorise que les scripts locaux et `wasm-unsafe-eval` pour les modules WebAssembly embarqués : pas de code distant, pas d'`eval`.

## Limites connues

- **HEIC/HEIF** : non pris en charge dans le MVP (erreur explicite). Prévoir un décodeur WASM en v1.1.
- **PNG** : le niveau de compression n'est pas réglable via `OffscreenCanvas` ; Chrome choisit la compression. Le curseur de qualité est donc masqué pour PNG.
- **Animations** : seul GIF → GIF animé est conservé (option cochée par défaut, 1000 images maximum). Les GIF vers un autre format et les WebP/AVIF animés sont réduits à la première image, avec avertissement.
- **SVG** : la sortie est un SVG contenant un PNG en base64, pas une vectorisation. Un SVG sans dimensions intrinsèques ni `viewBox` exploitable est refusé.
- **GIF** : 256 couleurs. La transparence est optionnelle et limitée à 1 bit : les pixels semi-transparents deviennent opaques ou transparents. En animation, chaque image est ré-encodée indépendamment (pas de palette globale).
- **TIFF** : expérimental, sortie non compressée.
- **EXIF** : conservé uniquement en JPEG → JPEG, et l'orientation est figée dans les pixels.
- **Images protégées** : une image derrière authentification, paywall ou protection anti-hotlink peut rester inaccessible ; l'erreur est affichée explicitement.
- **Presse-papiers** : Chrome n'accepte que `image/png` ; les autres formats sont réencodés en PNG pour la copie.
- **Chrome uniquement** : MV3, `chrome.action.openPopup`, `OffscreenCanvas`.

## Feuille de route

### MVP — v1.0.0 (actuel)

Popup, lot, menu contextuel, neuf formats de sortie, glisser-déposer, aperçu avant/après, redimensionnement, gestion alpha, EXIF JPEG → JPEG, avertissements, ZIP, presse-papiers, i18n FR/EN, thème automatique, tests unitaires, build Vite.

### v1 — consolidation et publication

- Décodeur HEIC/HEIF WASM chargé à la demande.
- Contrôle réel de la compression PNG (encodeur dédié) si nécessaire.
- Conservation des animations WebP/AVIF (GIF → GIF déjà pris en charge).
- Tests de bout en bout dans un navigateur et publication sur le Chrome Web Store.
- Icônes ICO multi-résolutions et TIFF compressés.

### v2 — au-delà

- Profils et préréglages de conversion, traitement par dossier.
- Recadrage, rotation, strip EXIF sélectif et aperçu des métadonnées.
- Vectorisation SVG expérimentale.
- Version Firefox/Edge et page de démonstration.

## Contribuer

Les contributions sont bienvenues. Merci de lancer `npm.cmd run typecheck`, `npm.cmd test` et `npm.cmd run build` avant toute proposition. Le code est commenté en français, l'interface est bilingue via `src/i18n/*.json`.

## Licence

GNU General Public License v3.0 (GPL-3.0-only) © 2026 Adrien. Voir [LICENSE](LICENSE).

Cette licence est un **copyleft fort** : vous pouvez utiliser, copier, modifier et redistribuer le projet, y compris commercialement, mais toute version modifiée redistribuée doit rester sous GPL-3.0 et fournir son code source. Aucune version propriétaire ou fermée n'est autorisée.

Les dépendances conservent leurs licences respectives (`@jsquash/avif`, `fflate`, `gifenc`, `utif`).
