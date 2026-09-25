// Extraction du texte des documents locaux : texte brut, Markdown, PDF, Word.
// Tout se passe sur la machine, aucun contenu n'est envoyé ailleurs. En option,
// les pages scannées des PDF sont lues par un modèle de vision d'Ollama.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import type { FormatDocument, Mesure } from '../../partage/types';
import type { LecteurOcr } from '../moteurs/ocr';
import type { CacheTexte } from '../outils/cache';
import { nettoyerTexte } from '../texte/decoupage';
import { encoderPng, type ImageBrute, imageDeLaPage, reduire } from './images';

const FORMATS: Record<string, FormatDocument> = {
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
  '.pdf': 'pdf',
  '.docx': 'docx'
};

/** Extensions prises en charge, avec le point. */
export const EXTENSIONS_PRISES_EN_CHARGE = Object.keys(FORMATS);

/** Sous ce nombre de caractères visibles, une page de PDF est tenue pour scannée (ou blanche). */
export const CARACTERES_MIN_PAGE = 40;

/** Plus grand côté de l'image envoyée au modèle de vision, en pixels. */
export const COTE_MAX_OCR = 1600;

/** Version de la lecture OCR : la changer invalide le cache des pages déjà lues. */
const VERSION_OCR = 'ocr-2';

export function formatDepuisChemin(chemin: string): FormatDocument | null {
  return FORMATS[extname(chemin).toLowerCase()] ?? null;
}

/** Décode en UTF-8, ou en Windows-1252 pour les vieux fichiers texte français. */
export function decoderTexte(octets: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('windows-1252').decode(octets);
  }
}

/**
 * Assemble les pages comme `extractText(…, { mergePages: true })` d'unpdf :
 * espaces réduits, lignes gardées, une ligne vide au plus.
 */
export function assemblerPages(pages: readonly string[]): string {
  return pages
    .join('\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

const caracteresVisibles = (texte: string): number => texte.replace(/\s+/g, '').length;

export interface OptionsOcr {
  lecteur: LecteurOcr;
  /** Pages lues au plus par document. */
  pagesMax: number;
  /** Pages déjà lues, retrouvées sans nouvel appel au modèle. */
  cache?: CacheTexte;
}

export interface OptionsExtraction {
  /** Option : lecture OCR des pages scannées des PDF. */
  ocr?: OptionsOcr;
  signal?: AbortSignal;
  /** Page scannée en cours de lecture, sur le nombre de pages à lire. */
  surPageOcr?: (page: number, pages: number) => void;
}

export interface Extraction {
  texte: string;
  /** Pages de PDF sans texte : scannées ou blanches. */
  pagesSansTexte: number;
  /** Pages lues par OCR. */
  pagesOcr: number;
  /** Pages sans texte non examinées, au-delà de la limite de pages lues. */
  pagesAuDela: number;
  /** Échec de la lecture OCR : les pages restantes n'ont pas été lues. */
  erreurOcr?: string;
  mesures: Mesure[];
}

/** Lecture du cache au mieux : un cache illisible vaut un cache vide. */
async function lireCache(cache: CacheTexte, cle: string): Promise<string | null> {
  try {
    return await cache.lire(cle);
  } catch {
    return null;
  }
}

/** Écriture du cache au mieux : disque plein ou droits manquants, la page sera simplement relue. */
async function ecrireCache(cache: CacheTexte, cle: string, texte: string): Promise<void> {
  try {
    await cache.ecrire(cle, texte);
  } catch {
    // Rien à faire : le cache n'est qu'un raccourci.
  }
}

async function extrairePdf(octets: Uint8Array, options: OptionsExtraction): Promise<Extraction> {
  const ocr = options.ocr;
  const cache = ocr?.cache;
  const empreinte = cache ? createHash('sha256').update(octets).digest('hex') : '';
  const pdf = await getDocumentProxy(octets);
  try {
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const sansTexte = pages.flatMap((texte, i) => (caracteresVisibles(texte) < CARACTERES_MIN_PAGE ? [i] : []));
    const resultat: Extraction = { texte: '', pagesSansTexte: sansTexte.length, pagesOcr: 0, pagesAuDela: 0, mesures: [] };

    if (ocr && sansTexte.length) {
      const { OPS } = await getResolvedPDFJS();
      const aLireAuPlus = Math.min(ocr.pagesMax, sansTexte.length);
      // Seules les pages vraiment lues comptent dans la limite : une page blanche ne la consomme pas.
      let lues = 0;
      for (const [position, indice] of sansTexte.entries()) {
        options.signal?.throwIfAborted();
        if (lues >= ocr.pagesMax) {
          resultat.pagesAuDela = sansTexte.length - position;
          break;
        }
        const cle = `${VERSION_OCR}|${ocr.lecteur.modele}|${empreinte}|${indice + 1}`;
        let transcription = cache ? await lireCache(cache, cle) : null;
        if (transcription === null) {
          const page = await pdf.getPage(indice + 1);
          let image: ImageBrute | null;
          try {
            // Page blanche, ou images que PDF.js ne sait pas décoder : rien à lire.
            image = await imageDeLaPage(page, OPS).catch(() => null);
          } finally {
            // PDF.js garde les images décodées jusqu'au nettoyage de la page : sans lui, un long scan remplit la mémoire.
            page.cleanup();
          }
          if (!image) continue;
          options.surPageOcr?.(lues + 1, aLireAuPlus);
          try {
            const lecture = await ocr.lecteur.lire(encoderPng(reduire(image, COTE_MAX_OCR)), {
              ...(options.signal ? { signal: options.signal } : {})
            });
            resultat.mesures.push(lecture.mesure);
            transcription = lecture.texte;
          } catch (erreur) {
            if (options.signal?.aborted) throw erreur;
            // Le texte natif du document reste ; les pages scannées suivantes ne sont pas lues.
            resultat.erreurOcr = (erreur as Error).message;
            break;
          }
          // Une lecture vide n'est pas gardée : la page sera relue la prochaine fois.
          if (cache && transcription) await ecrireCache(cache, cle, transcription);
        }
        lues += 1;
        if (transcription) {
          // La transcription tient lieu du texte absent ; le peu de texte de la page (en-tête, numéro) reste devant.
          const existant = pages[indice] ?? '';
          pages[indice] = existant.trim() ? `${existant}\n${transcription}` : transcription;
          resultat.pagesOcr += 1;
        }
      }
    }
    resultat.texte = assemblerPages(pages);
    return resultat;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function extraireDocx(octets: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: octets });
  return value;
}

/** Texte nettoyé d'un fichier, avec le bilan de la lecture OCR ; lève une erreur si le format est illisible. */
export async function extraireDocument(chemin: string, format: FormatDocument, options: OptionsExtraction = {}): Promise<Extraction> {
  const octets = await readFile(chemin);
  const simple = (texte: string): Extraction => ({ texte: nettoyerTexte(texte), pagesSansTexte: 0, pagesOcr: 0, pagesAuDela: 0, mesures: [] });
  switch (format) {
    case 'txt':
    case 'md':
      return simple(decoderTexte(octets));
    case 'pdf': {
      const extraction = await extrairePdf(new Uint8Array(octets), options);
      return { ...extraction, texte: nettoyerTexte(extraction.texte) };
    }
    case 'docx':
      return simple(await extraireDocx(octets));
  }
}

/** Texte nettoyé d'un fichier, sans OCR ; lève une erreur si le format est illisible. */
export async function extraireTexte(chemin: string, format: FormatDocument): Promise<string> {
  return (await extraireDocument(chemin, format)).texte;
}
