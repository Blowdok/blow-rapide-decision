// Corpus : documents d'un dossier, découpés en passages et indexés en BM25.

import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { DocumentIndexe, ErreurIndexation, Passage } from '../../partage/types';
import { extraireTexte, formatDepuisChemin } from '../extraction/extraction';
import { decouperEnPassages } from '../texte/decoupage';
import { IndexBm25 } from './bm25';

export interface Corpus {
  dossier: string;
  documents: DocumentIndexe[];
  erreurs: ErreurIndexation[];
  index: IndexBm25<Passage>;
}

export interface ProgressionIndexation {
  traites: number;
  total: number;
  fichier: string;
}

export interface OptionsIndexation {
  /** Taille des passages en caractères. */
  taillePassage?: number;
  /** Fichiers plus gros ignorés, en octets (20 Mo par défaut). */
  tailleMaxOctets?: number;
  surProgression?: (progression: ProgressionIndexation) => void;
  signal?: AbortSignal;
}

const DOSSIERS_IGNORES = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);

/** Liste récursive des fichiers pris en charge, triée pour un ordre stable. */
export async function listerFichiers(dossier: string): Promise<string[]> {
  const fichiers: string[] = [];
  const parcourir = async (courant: string): Promise<void> => {
    const entrees = await readdir(courant, { withFileTypes: true });
    for (const entree of entrees) {
      if (entree.name.startsWith('.') || entree.name.startsWith('~$')) continue;
      const chemin = join(courant, entree.name);
      if (entree.isDirectory()) {
        if (!DOSSIERS_IGNORES.has(entree.name)) await parcourir(chemin);
      } else if (entree.isFile() && formatDepuisChemin(chemin)) {
        fichiers.push(chemin);
      }
    }
  };
  await parcourir(dossier);
  return fichiers.sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Texte indexé d'un passage : le nom du fichier aide à retrouver le document. */
function texteIndexe(document: DocumentIndexe, passage: Passage): string {
  return `${document.nom.replace(/[._-]+/g, ' ')}\n${passage.texte}`;
}

/** Construit un corpus à partir de documents déjà extraits. */
export function construireCorpus(
  dossier: string,
  documents: DocumentIndexe[],
  erreurs: ErreurIndexation[] = []
): Corpus {
  const index = new IndexBm25<Passage>();
  for (const document of documents) {
    for (const passage of document.passages) index.ajouter(passage, texteIndexe(document, passage));
  }
  return { dossier, documents, erreurs, index };
}

/** Découpe un texte en passages rattachés à leur document. */
export function passagesDuDocument(documentId: string, texte: string, taillePassage = 1000): Passage[] {
  return decouperEnPassages(texte, taillePassage).map((morceau, rang) => ({
    id: `${documentId}#${rang}`,
    documentId,
    rang,
    texte: morceau
  }));
}

/** Parcourt un dossier, extrait chaque document pris en charge et l'indexe. */
export async function indexerDossier(dossier: string, options: OptionsIndexation = {}): Promise<Corpus> {
  const tailleMax = options.tailleMaxOctets ?? 20 * 1024 * 1024;
  const fichiers = await listerFichiers(dossier);
  const documents: DocumentIndexe[] = [];
  const erreurs: ErreurIndexation[] = [];

  for (const [position, chemin] of fichiers.entries()) {
    options.signal?.throwIfAborted();
    const id = relative(dossier, chemin).split(sep).join('/');
    options.surProgression?.({ traites: position, total: fichiers.length, fichier: id });
    const format = formatDepuisChemin(chemin);
    if (!format) continue;
    try {
      const infos = await stat(chemin);
      if (infos.size > tailleMax) {
        erreurs.push({ chemin: id, message: `Fichier ignoré : plus de ${Math.round(tailleMax / 1048576)} Mo.` });
        continue;
      }
      const texte = await extraireTexte(chemin, format);
      if (!texte) {
        erreurs.push({ chemin: id, message: 'Aucun texte extrait (document vide ou scanné sans OCR).' });
        continue;
      }
      documents.push({
        id,
        chemin,
        nom: basename(chemin),
        format,
        taille: infos.size,
        modifieLe: infos.mtime.toISOString(),
        texte,
        passages: passagesDuDocument(id, texte, options.taillePassage)
      });
    } catch (erreur) {
      erreurs.push({ chemin: id, message: `Extraction impossible : ${(erreur as Error).message}` });
    }
  }
  options.surProgression?.({ traites: fichiers.length, total: fichiers.length, fichier: '' });
  return construireCorpus(dossier, documents, erreurs);
}

/** Passages les plus proches d'une requête, avec leur rang lexical (à partir de 1). */
export function chercherPassages(
  corpus: Corpus,
  requete: string,
  limite: number
): Array<{ passage: Passage; score: number; rang: number }> {
  return corpus.index
    .chercher(requete, limite)
    .map(({ element, score }, position) => ({ passage: element, score, rang: position + 1 }));
}
