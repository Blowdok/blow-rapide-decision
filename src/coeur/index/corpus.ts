// Corpus : documents d'un dossier, découpés en passages et indexés en BM25.
// En option : lecture OCR des PDF scannés et index sémantique des passages.

import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { finPhrase } from '../../partage/format';
import type { DocumentIndexe, ErreurIndexation, FormatDocument, Mesure, Passage } from '../../partage/types';
import { type Extraction, extraireDocument, formatDepuisChemin, type OptionsOcr } from '../extraction/extraction';
import { type MoteurPlongement, type ResultatPlongement, type TexteAPlonger, textePourModele } from '../moteurs/plongements';
import { decouperEnPassages } from '../texte/decoupage';
import { IndexBm25 } from './bm25';
import { fusionnerClassements, IndexVectoriel } from './vecteurs';

/** Index sémantique des passages : prêt, ou en échec avec sa raison. */
export type Semantique =
  | { etat: 'pret'; modele: string; moteur: MoteurPlongement; index: IndexVectoriel<Passage> }
  | { etat: 'echec'; modele: string; message: string };

export interface Corpus {
  dossier: string;
  documents: DocumentIndexe[];
  erreurs: ErreurIndexation[];
  index: IndexBm25<Passage>;
  /** Recherche sémantique (option) ; `null` si elle n'était pas active à l'indexation. */
  semantique: Semantique | null;
  /** Avis sur les options : pages scannées non lues, recherche sémantique indisponible… */
  avis: string[];
  /** Appels faits pendant l'indexation : lecture OCR, plongements. */
  mesures: Mesure[];
}

export interface ProgressionIndexation {
  etape: 'extraction' | 'plongements';
  /** Fichiers extraits, ou passages plongés. */
  traites: number;
  total: number;
  /** Fichier en cours d'extraction ; vide pendant les plongements. */
  fichier: string;
  /** Page scannée en cours de lecture par OCR. */
  ocr?: { page: number; pages: number };
}

export interface OptionsIndexation {
  /** Taille des passages en caractères. */
  taillePassage?: number;
  /** Fichiers plus gros ignorés, en octets (20 Mo par défaut). */
  tailleMaxOctets?: number;
  surProgression?: (progression: ProgressionIndexation) => void;
  signal?: AbortSignal;
  /** Option : lecture OCR des pages scannées des PDF. */
  ocr?: OptionsOcr;
  /** Option : recherche sémantique, avec ce modèle de plongement. */
  plongement?: MoteurPlongement;
  /** Vecteurs déjà calculés, réutilisés d'une indexation à l'autre ; mise à jour sur place. */
  memoirePlongements?: Map<string, Float32Array>;
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

/** Nom du fichier sans extension ni séparateurs : il aide à retrouver le document. */
const titreDuDocument = (document: DocumentIndexe): string =>
  document.nom.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').trim();

/** Texte indexé d'un passage : le nom du fichier aide à retrouver le document. */
function texteIndexe(document: DocumentIndexe, passage: Passage): string {
  return `${document.nom.replace(/[._-]+/g, ' ')}\n${passage.texte}`;
}

/** Construit un corpus à partir de documents déjà extraits, sans index sémantique. */
export function construireCorpus(
  dossier: string,
  documents: DocumentIndexe[],
  erreurs: ErreurIndexation[] = []
): Corpus {
  const index = new IndexBm25<Passage>();
  for (const document of documents) {
    for (const passage of document.passages) index.ajouter(passage, texteIndexe(document, passage));
  }
  return { dossier, documents, erreurs, index, semantique: null, avis: [], mesures: [] };
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

/** Clé d'un vecteur en mémoire : même modèle et même texte donnent le même vecteur. */
function cleVecteur(modele: string, texte: TexteAPlonger): string {
  return createHash('sha256').update(`${modele}\n${textePourModele(modele, 'document', texte)}`).digest('hex');
}

/**
 * Calcule l'index sémantique des passages. Un échec ne bloque rien : le corpus
 * garde sa recherche par mots-clés et un avis explique pourquoi.
 */
export async function ajouterSemantique(
  corpus: Corpus,
  moteur: MoteurPlongement,
  options: Pick<OptionsIndexation, 'surProgression' | 'signal' | 'memoirePlongements'> = {}
): Promise<void> {
  const elements = corpus.documents.flatMap((document) =>
    document.passages.map((passage) => ({ passage, texte: { texte: passage.texte, titre: titreDuDocument(document) } }))
  );
  const cles = elements.map((e) => cleVecteur(moteur.modele, e.texte));
  const memoire = options.memoirePlongements;
  const manquants = elements.flatMap((_, i) => (memoire?.has(cles[i] as string) ? [] : [i]));
  const dejaCalcules = elements.length - manquants.length;
  let dernier = -1;
  const avancer = (faits: number): void => {
    if (faits === dernier) return;
    dernier = faits;
    options.surProgression?.({ etape: 'plongements', traites: dejaCalcules + faits, total: elements.length, fichier: '' });
  };

  try {
    avancer(0);
    const nouveaux = new Map<string, Float32Array>();
    if (manquants.length) {
      const { vecteurs, mesure } = await moteur.plonger(
        manquants.map((i) => (elements[i] as (typeof elements)[number]).texte),
        'document',
        { ...(options.signal ? { signal: options.signal } : {}), surAvancement: avancer }
      );
      corpus.mesures.push(mesure);
      manquants.forEach((i, j) => nouveaux.set(cles[i] as string, vecteurs[j] as Float32Array));
      avancer(manquants.length);
    }
    const vecteurDe = (i: number): Float32Array => (nouveaux.get(cles[i] as string) ?? memoire?.get(cles[i] as string)) as Float32Array;
    const index = new IndexVectoriel<Passage>(elements.length ? vecteurDe(0).length : 0);
    elements.forEach((e, i) => index.ajouter(e.passage, vecteurDe(i)));
    if (memoire) {
      // La mémoire ne garde que les vecteurs du dossier courant.
      const conserves = cles.map((cle, i) => [cle, vecteurDe(i)] as const);
      memoire.clear();
      for (const [cle, vecteur] of conserves) memoire.set(cle, vecteur);
    }
    corpus.semantique = { etat: 'pret', modele: moteur.modele, moteur, index };
  } catch (erreur) {
    if (options.signal?.aborted) throw erreur;
    memoire?.clear();
    const message = (erreur as Error).message;
    corpus.semantique = { etat: 'echec', modele: moteur.modele, message };
    corpus.avis.push(`Recherche sémantique indisponible : ${finPhrase(message)} La recherche par mots-clés reste disponible.`);
  }
}

/** Raison d'un document sans texte, avec la piste pour le lire. */
export function raisonSansTexte(format: FormatDocument, extraction: Extraction, ocrDemande: boolean, panneOcr: string | null): string {
  if (format !== 'pdf' || extraction.pagesSansTexte === 0) return 'Aucun texte extrait : document vide.';
  if (!ocrDemande) return 'Aucun texte extrait : PDF scanné ou vide. L’option de lecture des PDF scannés peut le lire.';
  if (panneOcr) return `Aucun texte extrait : lecture OCR impossible. ${finPhrase(panneOcr)}`;
  return 'Aucun texte extrait, même par lecture OCR : pages blanches ou images illisibles.';
}

/** Parcourt un dossier, extrait chaque document pris en charge et l'indexe. */
export async function indexerDossier(dossier: string, options: OptionsIndexation = {}): Promise<Corpus> {
  const tailleMax = options.tailleMaxOctets ?? 20 * 1024 * 1024;
  const fichiers = await listerFichiers(dossier);
  const documents: DocumentIndexe[] = [];
  const erreurs: ErreurIndexation[] = [];
  const avis: string[] = [];
  const mesures: Mesure[] = [];
  // Après un échec du modèle de vision (Ollama éteint, modèle absent), les PDF suivants sont lus sans OCR.
  let panneOcr: string | null = null;

  for (const [position, chemin] of fichiers.entries()) {
    options.signal?.throwIfAborted();
    const id = relative(dossier, chemin).split(sep).join('/');
    const progression: ProgressionIndexation = { etape: 'extraction', traites: position, total: fichiers.length, fichier: id };
    options.surProgression?.(progression);
    const format = formatDepuisChemin(chemin);
    if (!format) continue;
    try {
      const infos = await stat(chemin);
      if (infos.size > tailleMax) {
        erreurs.push({ chemin: id, message: `Fichier ignoré : plus de ${Math.round(tailleMax / 1048576)} Mo.` });
        continue;
      }
      const extraction = await extraireDocument(chemin, format, {
        ...(options.ocr && !panneOcr ? { ocr: options.ocr } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        surPageOcr: (page, pages) => options.surProgression?.({ ...progression, ocr: { page, pages } })
      });
      mesures.push(...extraction.mesures);
      if (extraction.erreurOcr) {
        panneOcr = extraction.erreurOcr;
        avis.push(`Lecture des PDF scannés interrompue : ${finPhrase(panneOcr)} Les pages scannées suivantes n’ont pas été lues.`);
      }
      if (!extraction.texte) {
        erreurs.push({ chemin: id, message: raisonSansTexte(format, extraction, Boolean(options.ocr), panneOcr) });
        continue;
      }
      if (extraction.pagesAuDela && options.ocr) {
        avis.push(
          `${id} : ${extraction.pagesAuDela} page(s) scannée(s) non lue(s), au-delà de la limite de ${options.ocr.pagesMax} pages par document.`
        );
      }
      documents.push({
        id,
        chemin,
        nom: basename(chemin),
        format,
        taille: infos.size,
        modifieLe: infos.mtime.toISOString(),
        texte: extraction.texte,
        passages: passagesDuDocument(id, extraction.texte, options.taillePassage),
        ...(extraction.pagesOcr ? { pagesOcr: extraction.pagesOcr } : {})
      });
    } catch (erreur) {
      if (options.signal?.aborted) throw erreur;
      erreurs.push({ chemin: id, message: `Extraction impossible : ${(erreur as Error).message}` });
    }
  }
  options.surProgression?.({ etape: 'extraction', traites: fichiers.length, total: fichiers.length, fichier: '' });

  const corpus = construireCorpus(dossier, documents, erreurs);
  corpus.avis.push(...avis);
  corpus.mesures.push(...mesures);
  if (options.plongement) {
    await ajouterSemantique(corpus, options.plongement, {
      ...(options.surProgression ? { surProgression: options.surProgression } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.memoirePlongements ? { memoirePlongements: options.memoirePlongements } : {})
    });
  }
  return corpus;
}

/** Passages les plus proches d'une requête pour BM25 seul, avec leur rang (à partir de 1). */
export function chercherPassages(
  corpus: Corpus,
  requete: string,
  limite: number
): Array<{ passage: Passage; score: number; rang: number }> {
  return corpus.index
    .chercher(requete, limite)
    .map(({ element, score }, position) => ({ passage: element, score, rang: position + 1 }));
}

export interface Candidat {
  passage: Passage;
  /** Rang BM25, à partir de 1 ; `null` si seule la recherche sémantique propose le passage. */
  rangLexical: number | null;
  /** Rang sémantique, à partir de 1 ; `null` sans recherche sémantique. */
  rangSemantique: number | null;
}

export interface Candidats {
  candidats: Candidat[];
  /** Modèle de plongement utilisé, `null` si la recherche est restée lexicale. */
  modelePlongement: string | null;
  /** Pourquoi la recherche sémantique demandée n'a pas servi, ou ce qui la limite. */
  avis?: string;
  mesures: Mesure[];
}

export interface OptionsCandidats {
  /** Recherche sémantique demandée dans les réglages. */
  semantique?: boolean;
  /** Modèle de plongement choisi dans les réglages, comparé à celui de l'indexation. */
  modele?: string;
  signal?: AbortSignal;
}

/** Profondeur de chaque classement avant la fusion. */
export const PROFONDEUR_FUSION = 50;

/** Ollama ajoute « :latest » aux noms sans étiquette. */
const memeModele = (a: string, b: string): boolean => a.replace(/:latest$/, '') === b.replace(/:latest$/, '');

/**
 * Passages proposés à la décision de pertinence : BM25 seul, ou BM25 et
 * recherche sémantique fusionnés par rang réciproque. Si la recherche
 * sémantique échoue, la recherche par mots-clés prend le relais avec un avis.
 */
export async function trouverCandidats(
  corpus: Corpus,
  requete: string,
  limite: number,
  options: OptionsCandidats = {}
): Promise<Candidats> {
  const lexicaux = corpus.index.chercher(requete, Math.max(limite, PROFONDEUR_FUSION)).map((r) => r.element);
  const seulementLexical = (avis?: string): Candidats => ({
    candidats: lexicaux.slice(0, limite).map((passage, i) => ({ passage, rangLexical: i + 1, rangSemantique: null })),
    modelePlongement: null,
    ...(avis ? { avis } : {}),
    mesures: []
  });

  const semantique = corpus.semantique;
  if (!options.semantique) return seulementLexical();
  if (!semantique) return seulementLexical('Recherche sémantique activée après la lecture du dossier : actualisez le dossier pour l’appliquer.');
  if (semantique.etat === 'echec') {
    return seulementLexical(`Recherche sémantique indisponible : ${finPhrase(semantique.message)} Actualisez le dossier une fois le problème réglé.`);
  }

  let plongement: ResultatPlongement;
  try {
    plongement = await semantique.moteur.plonger([{ texte: requete }], 'requete', options.signal ? { signal: options.signal } : {});
  } catch (erreur) {
    if (options.signal?.aborted) throw erreur;
    return seulementLexical(`Recherche sémantique indisponible : ${finPhrase((erreur as Error).message)} Recherche par mots-clés seule.`);
  }
  const [vecteur] = plongement.vecteurs;
  const semantiques = vecteur ? semantique.index.chercher(vecteur, PROFONDEUR_FUSION).map((r) => r.element) : [];

  const rangs = (passages: Passage[]): Map<string, number> => new Map(passages.map((p, i) => [p.id, i + 1]));
  const rangsLexicaux = rangs(lexicaux);
  const rangsSemantiques = rangs(semantiques);
  const parId = new Map([...lexicaux, ...semantiques].map((p) => [p.id, p]));
  const candidats = fusionnerClassements([lexicaux.map((p) => p.id), semantiques.map((p) => p.id)])
    .slice(0, limite)
    .map((id) => ({
      passage: parId.get(id) as Passage,
      rangLexical: rangsLexicaux.get(id) ?? null,
      rangSemantique: rangsSemantiques.get(id) ?? null
    }));
  const avis =
    options.modele && !memeModele(options.modele, semantique.modele)
      ? `Recherche sémantique préparée avec ${semantique.modele} : actualisez le dossier pour passer à ${options.modele}.`
      : undefined;
  return { candidats, modelePlongement: semantique.modele, ...(avis ? { avis } : {}), mesures: [plongement.mesure] };
}
