// Images des pages scannées, pour la lecture OCR facultative : la page est
// recomposée à partir de ses images (bandes, masques noir et blanc, rotation),
// puis réduite et encodée en PNG. Aucune dépendance native : PDF.js décode les
// images, zlib compresse le PNG.

import { crc32, deflateSync } from 'node:zlib';
import type { getDocumentProxy, getResolvedPDFJS } from 'unpdf';

type DocumentPdf = Awaited<ReturnType<typeof getDocumentProxy>>;
export type PagePdf = Awaited<ReturnType<DocumentPdf['getPage']>>;
type Operations = Awaited<ReturnType<typeof getResolvedPDFJS>>['OPS'];

/** Image en niveaux de gris (1 octet par pixel) ou en RVB (3 octets par pixel). */
export interface ImageBrute {
  largeur: number;
  hauteur: number;
  canaux: 1 | 3;
  pixels: Uint8Array;
}

/** Image prête à poser sur la page : gris, et opacité si elle n'est pas entièrement opaque. */
export interface Calque {
  largeur: number;
  hauteur: number;
  gris: Uint8Array;
  /** Opacité de 0 à 255 ; `null` si l'image est opaque. */
  alpha: Uint8Array | null;
}

/** Image décodée par PDF.js. `kind` : 1 = 1 bit par pixel, 2 = RVB, 3 = RVBA. */
interface ImagePdfJs {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | string;
}

/** Matrice affine de PDF.js [a, b, c, d, e, f] : x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrice = [number, number, number, number, number, number];

/** Côté minimal, en pixels, de la plus grande image d'une page scannée : en dessous, c'est un logo ou une icône. */
export const COTE_MIN_SCAN = 300;

/** Part de la page que les images doivent couvrir pour qu'elle soit tenue pour scannée. */
export const COUVERTURE_MIN_SCAN = 0.25;

/** Plus grand côté de la page recomposée : assez pour lire un scan à 300 points par pouce. */
const COTE_MAX_RECOMPOSITION = 3000;

/** Délai d'attente d'une image que PDF.js n'arrive pas à décoder. */
const DELAI_IMAGE_MS = 15_000;

const luminance = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/** Déplie des bits empaquetés (lignes complétées à l'octet) : `siUn` pour 1, `siZero` pour 0. */
function deplierBits(data: ArrayLike<number>, largeur: number, hauteur: number, siUn: number, siZero: number): Uint8Array {
  const octetsParLigne = (largeur + 7) >> 3;
  const sortie = new Uint8Array(largeur * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const ligne = y * octetsParLigne;
    for (let x = 0; x < largeur; x++) {
      const bit = ((data[ligne + (x >> 3)] as number) >> (7 - (x & 7))) & 1;
      sortie[y * largeur + x] = bit ? siUn : siZero;
    }
  }
  return sortie;
}

/** Convertit une image décodée par PDF.js ; `null` si son format n'est pas reconnu. */
export function calqueDepuisPdfJs(image: ImagePdfJs): Calque | null {
  const { width: largeur = 0, height: hauteur = 0, data } = image;
  if (!data || typeof data === 'string' || largeur <= 0 || hauteur <= 0) return null;
  const pixels = largeur * hauteur;
  const octetsParLigne1Bit = (largeur + 7) >> 3;
  const kind =
    image.kind ??
    (data.length === pixels * 3 ? 2 : data.length === pixels * 4 ? 3 : data.length === octetsParLigne1Bit * hauteur ? 1 : 0);

  if (kind === 1 && data.length >= octetsParLigne1Bit * hauteur) {
    // PDF.js garde 1 pour le blanc, quel que soit le tableau /Decode du PDF.
    return { largeur, hauteur, gris: deplierBits(data, largeur, hauteur, 255, 0), alpha: null };
  }
  if ((kind === 2 && data.length >= pixels * 3) || (kind === 3 && data.length >= pixels * 4)) {
    const pas = kind === 2 ? 3 : 4;
    const gris = new Uint8Array(pixels);
    const alpha = kind === 3 ? new Uint8Array(pixels) : null;
    for (let i = 0; i < pixels; i++) {
      const o = i * pas;
      gris[i] = luminance(data[o] as number, data[o + 1] as number, data[o + 2] as number);
      if (alpha) alpha[i] = data[o + 3] as number;
    }
    return { largeur, hauteur, gris, alpha };
  }
  return null;
}

/** Masque d'image (noir et blanc « à trous ») : 0 peint l'encre, 1 laisse voir ce qui est dessous. */
export function calqueDepuisMasque(masque: { width?: number; height?: number; data?: ArrayLike<number> }): Calque | null {
  const { width: largeur = 0, height: hauteur = 0, data } = masque;
  if (!data || largeur <= 0 || hauteur <= 0 || data.length < ((largeur + 7) >> 3) * hauteur) return null;
  return {
    largeur,
    hauteur,
    gris: new Uint8Array(largeur * hauteur),
    alpha: deplierBits(data, largeur, hauteur, 0, 255)
  };
}

/** Composition de deux matrices : `locale` s'applique d'abord, puis `parent`. */
function composer(parent: Matrice, locale: readonly number[]): Matrice {
  const [a, b, c, d, e, f] = parent;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = locale;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

function inverser([a, b, c, d, e, f]: Matrice): Matrice | null {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Rectangle occupé à l'écran par le carré unité de l'image, limité à la page. */
function emprise(m: Matrice, largeur: number, hauteur: number): { x0: number; y0: number; x1: number; y1: number } {
  const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
  const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs))),
    y0: Math.max(0, Math.floor(Math.min(...ys))),
    x1: Math.min(largeur, Math.ceil(Math.max(...xs))),
    y1: Math.min(hauteur, Math.ceil(Math.max(...ys)))
  };
}

/** Pose un calque sur la page recomposée ; renvoie le nombre de pixels couverts. */
function poser(page: Uint8Array, largeur: number, hauteur: number, calque: Calque, matrice: Matrice): number {
  const inverse = inverser(matrice);
  if (!inverse) return 0;
  const [ia, ib, ic, id, ie, iff] = inverse;
  const { x0, y0, x1, y1 } = emprise(matrice, largeur, hauteur);
  let couverts = 0;
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5;
      // Retour dans le carré unité de l'image ; sa première ligne est en haut (v = 1).
      const u = ia * px + ic * py + ie;
      const v = ib * px + id * py + iff;
      if (u < 0 || u >= 1 || v <= 0 || v > 1) continue;
      const source = Math.floor((1 - v) * calque.hauteur) * calque.largeur + Math.floor(u * calque.largeur);
      const g = calque.gris[source] as number;
      const a = calque.alpha ? (calque.alpha[source] as number) : 255;
      const cible = y * largeur + x;
      page[cible] = a === 255 ? g : Math.round(((page[cible] as number) * (255 - a) + g * a) / 255);
      couverts++;
    }
  }
  return couverts;
}

/** Objet de PDF.js, attendu au plus quelques secondes (une image indécodable n'arrive jamais). */
function objetPdfJs(page: PagePdf, cle: string): Promise<unknown> {
  // Les images partagées entre pages (« g_… ») sont gardées à part par PDF.js.
  const objets = cle.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const minuterie = setTimeout(() => resolve(null), DELAI_IMAGE_MS);
    objets.get(cle, (objet: unknown) => {
      clearTimeout(minuterie);
      resolve(objet);
    });
  });
}

/**
 * Recompose une page à partir de ses images, en niveaux de gris, à peu près à
 * leur résolution d'origine. Bandes, masques, formulaires et rotation de la
 * page sont pris en compte. `null` si la page n'a pas l'air scannée : pas
 * d'image, images trop petites, ou couvrant trop peu de la page.
 */
export async function imageDeLaPage(page: PagePdf, operations: Operations): Promise<ImageBrute | null> {
  const liste = await page.getOperatorList();
  const aPoser: Array<{ calque: Calque; matrice: Matrice }> = [];
  const pile: Matrice[] = [];
  let courante: Matrice = [1, 0, 0, 1, 0, 0];

  for (let i = 0; i < liste.fnArray.length; i++) {
    const operation = liste.fnArray[i];
    const args = (liste.argsArray[i] ?? []) as unknown[];
    if (operation === operations.save) pile.push(courante);
    else if (operation === operations.restore) courante = pile.pop() ?? courante;
    else if (operation === operations.transform) courante = composer(courante, args as number[]);
    else if (operation === operations.paintFormXObjectBegin) {
      pile.push(courante);
      courante = composer(courante, Array.from((args[0] as ArrayLike<number> | null) ?? [1, 0, 0, 1, 0, 0]));
    } else if (operation === operations.paintFormXObjectEnd) courante = pile.pop() ?? courante;
    else if (operation === operations.paintImageXObject || operation === operations.paintInlineImageXObject) {
      const source = typeof args[0] === 'string' ? await objetPdfJs(page, args[0]) : args[0];
      const calque = source ? calqueDepuisPdfJs(source as ImagePdfJs) : null;
      if (calque) aPoser.push({ calque, matrice: courante });
    } else if (operation === operations.paintImageMaskXObject) {
      const masque = args[0] as { width?: number; height?: number; data?: unknown } | undefined;
      const donnees = typeof masque?.data === 'string' ? await objetPdfJs(page, masque.data) : masque;
      const calque = donnees ? calqueDepuisMasque(donnees as { width?: number; height?: number; data?: ArrayLike<number> }) : null;
      if (calque) aPoser.push({ calque, matrice: courante });
    }
  }
  if (!aPoser.length || Math.max(...aPoser.map(({ calque }) => Math.max(calque.largeur, calque.hauteur))) < COTE_MIN_SCAN) {
    return null;
  }

  // Échelle : la résolution de l'image la plus fine, bornée pour tenir en mémoire.
  const base = page.getViewport({ scale: 1 });
  const pixelsParPoint = Math.max(
    ...aPoser.map(({ calque, matrice }) => {
      const cote = Math.hypot(matrice[0], matrice[1]) || 1;
      return calque.largeur / cote;
    })
  );
  const echelle = Math.max(1, Math.min(pixelsParPoint, COTE_MAX_RECOMPOSITION / Math.max(base.width, base.height)));
  const vue = page.getViewport({ scale: echelle });
  const largeur = Math.max(1, Math.round(vue.width));
  const hauteur = Math.max(1, Math.round(vue.height));
  const ecran = vue.transform as Matrice;

  const pixels = new Uint8Array(largeur * hauteur).fill(255);
  let couverts = 0;
  for (const { calque, matrice } of aPoser) couverts += poser(pixels, largeur, hauteur, calque, composer(ecran, matrice));
  if (couverts < COUVERTURE_MIN_SCAN * largeur * hauteur) return null;
  return { largeur, hauteur, canaux: 1, pixels };
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
