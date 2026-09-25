// Service de l'agent pour l'application de bureau : garde le corpus ouvert,
// les triages et résumés déjà faits, le journal des envois hors machine.
// Aucune dépendance à Electron : il se teste comme le reste du cœur.

import { rechercher, resumerDocument, trierDocument } from '../coeur/agent/agent';
import { creerProfil, type Profil } from '../coeur/agent/profils';
import { executerBanc } from '../coeur/banc/executer';
import { chargerJeu, ErreurJeu, problemesDuJeu } from '../coeur/banc/jeu';
import { rapportMarkdown } from '../coeur/banc/rapport';
import { diagnostiquer } from '../coeur/diagnostic';
import { type Corpus, indexerDossier } from '../coeur/index/corpus';
import { listerModelesOllama } from '../coeur/moteurs/ollama';
import { optionsFacultatives } from '../coeur/options';
import type { CacheTexte } from '../coeur/outils/cache';
import { executerParLots } from '../coeur/outils/concurrence';
import type {
  DetailDocument,
  EntreeJournal,
  EtatCorpus,
  EtatService,
  Progression,
  ResultatComparaison,
  ResumeDocument
} from '../partage/contrat';
import type { Reglages, Secrets } from '../partage/reglages';
import type { DocumentIndexe, IdProfil, Mesure, Recherche, Resume, Triage } from '../partage/types';

export interface DependancesService {
  reglages(): Reglages;
  secrets(): Secrets;
  envoyer(progression: Progression): void;
  fetch?: typeof fetch;
  /** Pages déjà lues par OCR (option), gardées entre deux lancements. */
  cacheOcr?: CacheTexte;
}

const TAILLE_JOURNAL = 200;
const TAILLE_APERCU = 3000;

/** Signature des moteurs de décision : un triage n'est réutilisé qu'avec les mêmes réglages. */
function signatureDecision(r: Reglages): string {
  const moteur = {
    local: `ollama:${r.ollama.url}:${r.ollama.modeleDecision}`,
    hybride: `jev:${r.jev.acces}:${r.jev.modele}:${r.confidentialite.masquage}`,
    reference: 'reference'
  }[r.profil];
  return `${r.profil}|${moteur}|${JSON.stringify(r.classement)}`;
}

function signatureRedaction(r: Reglages): string {
  const moteur = {
    local: `ollama:${r.ollama.url}:${r.ollama.modeleResume}`,
    hybride: `openrouter:${r.openrouter.modeleResume}:${r.confidentialite.masquage}`,
    reference: 'reference'
  }[r.profil];
  return `${r.profil}|${moteur}|${JSON.stringify(r.resume)}`;
}

export class ServiceAgent {
  readonly #deps: DependancesService;
  #corpus: Corpus | null = null;
  readonly #triages = new Map<string, Triage>();
  readonly #resumes = new Map<string, Resume>();
  #journal: EntreeJournal[] = [];
  #banc: ResultatComparaison | null = null;
  #annulation: AbortController | null = null;
  #indexation: AbortController | null = null;
  /** Vecteurs des passages déjà calculés : une réindexation ne recalcule que les passages changés. */
  readonly #memoirePlongements = new Map<string, Float32Array>();

  constructor(dependances: DependancesService) {
    this.#deps = dependances;
  }

  #profil(id?: IdProfil): Profil {
    const reglages = this.#deps.reglages();
    return creerProfil(id ?? reglages.profil, {
      reglages,
      secrets: this.#deps.secrets(),
      ...(this.#deps.fetch ? { fetch: this.#deps.fetch } : {})
    });
  }

  /** Consigne chaque envoi hors de la machine, du plus récent au plus ancien. */
  #consigner(mesures: Mesure[]): void {
    const date = new Date().toISOString();
    const entrees = mesures
      .filter((m) => m.horsMachine)
      .map((m) => ({
        date,
        operation: m.operation,
        moteur: m.moteur,
        modele: m.modele,
        caracteres: m.caracteresEnvoyes,
        masques: m.elementsMasques,
        coutUsd: m.coutUsd
      }));
    this.#journal = [...entrees.reverse(), ...this.#journal].slice(0, TAILLE_JOURNAL);
  }

  #corpusOuvert(): Corpus {
    if (!this.#corpus) throw new Error('Aucun dossier ouvert : choisissez d’abord un dossier dans l’écran Documents.');
    return this.#corpus;
  }

  #document(id: string): DocumentIndexe {
    const document = this.#corpusOuvert().documents.find((d) => d.id === id);
    if (!document) throw new Error(`Document introuvable : « ${id} ». Actualisez le dossier.`);
    return document;
  }

  #resumeDocument(document: DocumentIndexe, reglages: Reglages): ResumeDocument {
    const { texte, passages: _passages, ...meta } = document;
    return {
      ...meta,
      caracteres: texte.length,
      triage: this.#triages.get(`${signatureDecision(reglages)}|${document.id}`) ?? null
    };
  }

  /** Moteurs des options actives (recherche sémantique, lecture OCR). */
  #optionsFacultatives(reglages: Reglages) {
    return optionsFacultatives(reglages, {
      ...(this.#deps.fetch ? { fetch: this.#deps.fetch } : {}),
      ...(this.#deps.cacheOcr ? { cacheOcr: this.#deps.cacheOcr } : {})
    });
  }

  async indexer(dossier: string): Promise<EtatCorpus> {
    if (this.#indexation) throw new Error('Le dossier est déjà en cours de lecture.');
    const annulation = new AbortController();
    this.#indexation = annulation;
    try {
      const corpus = await indexerDossier(dossier, {
        ...this.#optionsFacultatives(this.#deps.reglages()),
        memoirePlongements: this.#memoirePlongements,
        surProgression: (p) => this.#deps.envoyer({ type: 'indexation', ...p }),
        signal: annulation.signal
      });
      // Le dossier précédent reste ouvert jusqu'à la fin de la nouvelle indexation.
      this.#corpus = corpus;
      this.#triages.clear();
      this.#resumes.clear();
      this.#consigner(corpus.mesures);
      return this.etatCorpus() as EtatCorpus;
    } catch (erreur) {
      if (annulation.signal.aborted) throw new Error('Lecture du dossier annulée.');
      throw erreur;
    } finally {
      this.#indexation = null;
    }
  }

  annulerIndexation(): void {
    this.#indexation?.abort();
  }

  etatCorpus(): EtatCorpus | null {
    if (!this.#corpus) return null;
    const reglages = this.#deps.reglages();
    const { semantique } = this.#corpus;
    return {
      dossier: this.#corpus.dossier,
      documents: this.#corpus.documents.map((d) => this.#resumeDocument(d, reglages)),
      erreurs: this.#corpus.erreurs,
      semantique: semantique?.etat === 'pret' ? { modele: semantique.modele, passages: semantique.index.taille } : null,
      avis: this.#corpus.avis
    };
  }

  detail(id: string): DetailDocument {
    const document = this.#document(id);
    const reglages = this.#deps.reglages();
    return {
      ...this.#resumeDocument(document, reglages),
      apercu: document.texte.slice(0, TAILLE_APERCU),
      resume: this.#resumes.get(`${signatureRedaction(reglages)}|${id}`) ?? null
    };
  }

  cheminDocument(id: string): string {
    return this.#document(id).chemin;
  }

  /** Trie les documents indiqués, ou tous ceux que le mode actif n'a pas encore triés. */
  async trier(ids?: string[]): Promise<Triage[]> {
    const reglages = this.#deps.reglages();
    const profil = this.#profil();
    const signature = signatureDecision(reglages);
    const cibles = ids
      ? ids.map((id) => this.#document(id))
      : this.#corpusOuvert().documents.filter((d) => !this.#triages.has(`${signature}|${d.id}`));
    let fait = 0;
    this.#deps.envoyer({ type: 'triage', fait, total: cibles.length });
    return executerParLots(cibles, profil.decision.horsMachine ? 4 : 1, async (document) => {
      const triage = await trierDocument(document, profil, reglages);
      this.#triages.set(`${signature}|${document.id}`, triage);
      this.#consigner(triage.mesures);
      this.#deps.envoyer({ type: 'triage', fait: ++fait, total: cibles.length });
      return triage;
    });
  }

  async resumer(id: string): Promise<Resume> {
    const reglages = this.#deps.reglages();
    const resume = await resumerDocument(this.#document(id), this.#profil(), reglages);
    this.#resumes.set(`${signatureRedaction(reglages)}|${id}`, resume);
    this.#consigner(resume.mesures);
    return resume;
  }

  async rechercher(requete: string): Promise<Recherche> {
    if (!requete.trim()) throw new Error('Saisissez une requête.');
    const resultat = await rechercher(this.#corpusOuvert(), requete.trim(), this.#profil(), this.#deps.reglages());
    this.#consigner(resultat.mesures);
    return resultat;
  }

  async lancerBanc(dossierJeu: string, profils: IdProfil[]): Promise<ResultatComparaison> {
    if (this.#annulation) throw new Error('Une comparaison est déjà en cours.');
    if (profils.length === 0) throw new Error('Choisissez au moins un mode à comparer.');
    const annulation = new AbortController();
    this.#annulation = annulation;
    try {
      const reglages = this.#deps.reglages();
      const secrets = this.#deps.secrets();
      const jeu = await chargerJeu(dossierJeu);
      const corpus = await indexerDossier(jeu.dossierDocuments, {
        ...this.#optionsFacultatives(reglages),
        signal: annulation.signal
      });
      this.#consigner(corpus.mesures);
      const problemes = problemesDuJeu(jeu, corpus, reglages.classement.categories);
      if (problemes.length) throw new ErreurJeu(`Jeu d’évaluation incohérent : ${problemes.slice(0, 5).join(' ')}`);
      const resultat = await executerBanc(jeu, corpus, {
        reglages,
        profils,
        fabriquerProfil: (id) =>
          creerProfil(id, { reglages, secrets, ...(this.#deps.fetch ? { fetch: this.#deps.fetch } : {}) }),
        surProgression: (p) => this.#deps.envoyer({ type: 'banc', ...p }),
        signal: annulation.signal
      });
      for (const profil of resultat.profils) this.#consigner(profil.mesures);
      this.#banc = { resultat, rapport: rapportMarkdown(resultat) };
      return this.#banc;
    } catch (erreur) {
      if (annulation.signal.aborted) throw new Error('Comparaison annulée.');
      throw erreur;
    } finally {
      this.#annulation = null;
    }
  }

  annulerBanc(): void {
    this.#annulation?.abort();
  }

  get dernierBanc(): ResultatComparaison | null {
    return this.#banc;
  }

  journal(): EntreeJournal[] {
    return [...this.#journal];
  }

  diagnostic(): Promise<EtatService[]> {
    return diagnostiquer(this.#deps.reglages(), this.#deps.secrets(), this.#deps.fetch);
  }

  modelesOllama(): Promise<string[]> {
    return listerModelesOllama(this.#deps.reglages().ollama.url, this.#deps.fetch);
  }
}
