// Images des pages scannées : extraction depuis le PDF, réduction et encodage
// PNG, pour la lecture OCR facultative. Aucune dépendance native : PDF.js
// décode les images, zlib compresse le PNG.

import { crc32, deflateSync } from 'node:zlib';
import type { getDocumentProxy } from 'unpdf';

type DocumentPdf = Awaited<ReturnType<typeof getDocumentProxy>>;
export type PagePdf = Awaited<ReturnType<DocumentPdf['getPage']>>;

/** Image en niveaux de gris (1 octet par pixel) ou en RVB (3 octets par pixel). */
export interface ImageBrute {
  largeur: number;
  hauteur: number;
  canaux: 1 | 3;
  pixels: Uint8Array;
}

/** Image décodée par PDF.js. `kind` : 1 = 1 bit par pixel, 2 = RVB, 3 = RVBA. */
interface ImagePdfJs {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/** Côté minimal, en pixels, d'une image de page scannée : en dessous, c'est un logo ou une icône. */
export const COTE_MIN_SCAN = 300;

/** Délai d'attente d'une image que PDF.js n'arrive pas à décoder. */
const DELAI_IMAGE_MS = 15_000;

/** Convertit une image de PDF.js ; `null` si son format n'est pas reconnu. */
export function depuisPdfJs(image: ImagePdfJs): ImageBrute | null {
  const { width: largeur = 0, height: hauteur = 0, data } = image;
  if (!data || largeur <= 0 || hauteur <= 0) return null;
  const pixels = largeur * hauteur;
  const octetsParLigne1Bit = (largeur + 7) >> 3;
  const kind =
    image.kind ??
    (data.length === pixels * 3 ? 2 : data.length === pixels * 4 ? 3 : data.length === octetsParLigne1Bit * hauteur ? 1 : 0);

  if (kind === 1 && data.length >= octetsParLigne1Bit * hauteur) {
    // Bits empaquetés, lignes complétées à l'octet ; PDF.js garde 1 pour le blanc.
    const gris = new Uint8Array(pixels);
    for (let y = 0; y < hauteur; y++) {
      const ligne = y * octetsParLigne1Bit;
      for (let x = 0; x < largeur; x++) {
        const bit = ((data[ligne + (x >> 3)] as number) >> (7 - (x & 7))) & 1;
        gris[y * largeur + x] = bit ? 255 : 0;
      }
    }
    return { largeur, hauteur, canaux: 1, pixels: gris };
  }
  if (kind === 2 && data.length >= pixels * 3) {
    return { largeur, hauteur, canaux: 3, pixels: Uint8Array.from(data.subarray(0, pixels * 3)) };
  }
  if (kind === 3 && data.length >= pixels * 4) {
    // Transparence posée sur fond blanc, comme sur une page imprimée.
    const rvb = new Uint8Array(pixels * 3);
    for (let i = 0; i < pixels; i++) {
      const alpha = (data[i * 4 + 3] as number) / 255;
      for (let c = 0; c < 3; c++) rvb[i * 3 + c] = Math.round((data[i * 4 + c] as number) * alpha + 255 * (1 - alpha));
    }
    return { largeur, hauteur, canaux: 3, pixels: rvb };
  }
  return null;
}

/** Plus grande image de la page, si elle est assez grande pour être une page scannée. */
export async function imagePrincipale(page: PagePdf, operationImage: number): Promise<ImageBrute | null> {
  const operations = await page.getOperatorList();
  const vues = new Set<string>();
  let meilleure: ImagePdfJs | null = null;
  for (let i = 0; i < operations.fnArray.length; i++) {
    if (operations.fnArray[i] !== operationImage) continue;
    const cle: unknown = operations.argsArray[i]?.[0];
    if (typeof cle !== 'string' || vues.has(cle)) continue;
    vues.add(cle);
    // Les images partagées entre pages (« g_… ») sont gardées à part par PDF.js.
    const objets = cle.startsWith('g_') ? page.commonObjs : page.objs;
    const image = await new Promise<ImagePdfJs | null>((resolve) => {
      const minuterie = setTimeout(() => resolve(null), DELAI_IMAGE_MS);
      objets.get(cle, (objet: ImagePdfJs | null) => {
        clearTimeout(minuterie);
        resolve(objet);
      });
    });
    if (!image?.data || !image.width || !image.height) continue;
    if (!meilleure || image.width * image.height > (meilleure.width ?? 0) * (meilleure.height ?? 0)) meilleure = image;
  }
  if (!meilleure || Math.max(meilleure.width ?? 0, meilleure.height ?? 0) < COTE_MIN_SCAN) return null;
  return depuisPdfJs(meilleure);
}

/** Réduit l'image pour que son plus grand côté ne dépasse pas `coteMax` (moyenne des pixels couverts). */
export function reduire(image: ImageBrute, coteMax: number): ImageBrute {
  const { largeur, hauteur, canaux, pixels } = image;
  const echelle = Math.min(1, coteMax / Math.max(largeur, hauteur));
  if (echelle === 1) return image;
  const nouvelleLargeur = Math.max(1, Math.round(largeur * echelle));
  const nouvelleHauteur = Math.max(1, Math.round(hauteur * echelle));
  const sortie = new Uint8Array(nouvelleLargeur * nouvelleHauteur * canaux);
  const sommes = new Float64Array(canaux);
  for (let y = 0; y < nouvelleHauteur; y++) {
    const y0 = Math.floor((y * hauteur) / nouvelleHauteur);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * hauteur) / nouvelleHauteur));
    for (let x = 0; x < nouvelleLargeur; x++) {
      const x0 = Math.floor((x * largeur) / nouvelleLargeur);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * largeur) / nouvelleLargeur));
      sommes.fill(0);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const source = (sy * largeur + sx) * canaux;
          for (let c = 0; c < canaux; c++) sommes[c] = (sommes[c] as number) + (pixels[source + c] as number);
        }
      }
      const nombre = (y1 - y0) * (x1 - x0);
      const cible = (y * nouvelleLargeur + x) * canaux;
      for (let c = 0; c < canaux; c++) sortie[cible + c] = Math.round((sommes[c] as number) / nombre);
    }
  }
  return { largeur: nouvelleLargeur, hauteur: nouvelleHauteur, canaux, pixels: sortie };
}

/** Passe en niveaux de gris une image RVB dont les trois canaux sont égaux : un PNG trois fois plus léger. */
export function simplifier(image: ImageBrute): ImageBrute {
  if (image.canaux === 1) return image;
  const { pixels } = image;
  for (let i = 0; i < pixels.length; i += 3) {
    if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) return image;
  }
  const gris = new Uint8Array(pixels.length / 3);
  for (let i = 0; i < gris.length; i++) gris[i] = pixels[i * 3] as number;
  return { ...image, canaux: 1, pixels: gris };
}

function bloc(type: string, donnees: Uint8Array): Buffer {
  const entete = Buffer.alloc(8);
  entete.writeUInt32BE(donnees.length, 0);
  entete.write(type, 4, 'latin1');
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(donnees, crc32(entete.subarray(4))), 0);
  return Buffer.concat([entete, donnees, controle]);
}

/** Encode l'image en PNG 8 bits, sans filtre de ligne. */
export function encoderPng(image: ImageBrute): Buffer {
  const { largeur, hauteur, canaux, pixels } = image;
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete[8] = 8; // bits par canal
  entete[9] = canaux === 1 ? 0 : 2; // niveaux de gris ou RVB
  // Compression, filtrage et entrelacement : valeurs standard (0).
  const octetsParLigne = largeur * canaux;
  const lignes = Buffer.alloc((octetsParLigne + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    // Chaque ligne commence par l'octet de filtre, ici 0 (aucun).
    lignes.set(pixels.subarray(y * octetsParLigne, (y + 1) * octetsParLigne), y * (octetsParLigne + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(lignes)),
    bloc('IEND', new Uint8Array(0))
  ]);
}
