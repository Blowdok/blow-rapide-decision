// Contrat entre l'interface (rendu isolé) et le processus principal d'Electron.
// L'interface n'accède ni au disque ni au réseau : tout passe par ces appels.

import type { ProgressionBanc, ResultatBanc } from './banc';
import type { Reglages, ReglagesPartiels } from './reglages';
import type { DocumentIndexe, ErreurIndexation, IdProfil, Recherche, Resume, Triage } from './types';

export const CANAUX = {
  reglagesLire: 'reglages:lire',
  reglagesEnregistrer: 'reglages:enregistrer',
  reglagesDefinirCle: 'reglages:definir-cle',
  diagnostic: 'services:diagnostic',
  modelesOllama: 'services:modeles-ollama',
  dossierChoisir: 'dossier:choisir',
  dossierIndexer: 'dossier:indexer',
  dossierEtat: 'dossier:etat',
  documentLire: 'document:lire',
  documentsTrier: 'documents:trier',
  documentResumer: 'document:resumer',
  documentOuvrir: 'document:ouvrir',
  rechercher: 'recherche:lancer',
  bancJeuParDefaut: 'banc:jeu-par-defaut',
  bancChoisirJeu: 'banc:choisir-jeu',
  bancLancer: 'banc:lancer',
  bancAnnuler: 'banc:annuler',
  bancExporter: 'banc:exporter',
  journal: 'journal:lire',
  progression: 'progression'
} as const;

/** Réponse enveloppée d'un appel : l'erreur arrive avec son message lisible. */
export type Reponse<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

export type NomCle = 'cleOpenRouter' | 'cleTypeSafe';

export interface EtatReglages {
  reglages: Reglages;
  /** Clés enregistrées (jamais leur valeur). */
  cles: Record<NomCle, boolean>;
  /** Clés fournies par des variables d'environnement. */
  clesEnvironnement: Record<NomCle, boolean>;
  /** Faux si le système ne sait pas chiffrer : les clés ne peuvent pas être enregistrées. */
  chiffrementDisponible: boolean;
  dernierDossier: string | null;
}

export interface EtatService {
  service: 'Ollama' | 'OpenRouter' | 'Jev';
  ok: boolean;
  detail: string;
}

/** Document tel que listé dans l'interface, sans son texte complet. */
export type ResumeDocument = Omit<DocumentIndexe, 'texte' | 'passages'> & {
  caracteres: number;
  /** Triage du mode actif, s'il a déjà été fait. */
  triage: Triage | null;
};

export interface EtatCorpus {
  dossier: string;
  documents: ResumeDocument[];
  erreurs: ErreurIndexation[];
}

export interface DetailDocument extends ResumeDocument {
  apercu: string;
  /** Résumé du mode actif, s'il a déjà été fait. */
  resume: Resume | null;
}

export interface EntreeJournal {
  date: string;
  operation: 'decision' | 'redaction';
  moteur: string;
  modele: string;
  caracteres: number;
  masques: number;
  coutUsd: number;
}

export interface ResultatComparaison {
  resultat: ResultatBanc;
  rapport: string;
}

export type Progression =
  | { type: 'indexation'; traites: number; total: number; fichier: string }
  | { type: 'triage'; fait: number; total: number }
  | ({ type: 'banc' } & ProgressionBanc);

export interface ApiBureau {
  reglages: {
    lire(): Promise<EtatReglages>;
    enregistrer(partiel: ReglagesPartiels): Promise<EtatReglages>;
    /** Enregistre une clé chiffrée ; une valeur vide la supprime. */
    definirCle(nom: NomCle, valeur: string): Promise<EtatReglages>;
  };
  services: {
    diagnostic(): Promise<EtatService[]>;
    modelesOllama(): Promise<string[]>;
  };
  dossier: {
    choisir(): Promise<string | null>;
    indexer(chemin: string): Promise<EtatCorpus>;
    etat(): Promise<EtatCorpus | null>;
  };
  documents: {
    lire(id: string): Promise<DetailDocument>;
    /** Trie les documents indiqués, ou tous ceux qui ne le sont pas encore. */
    trier(ids?: string[]): Promise<Triage[]>;
    resumer(id: string): Promise<Resume>;
    ouvrir(id: string): Promise<void>;
  };
  rechercher(requete: string): Promise<Recherche>;
  banc: {
    jeuParDefaut(): Promise<string>;
    choisirJeu(): Promise<string | null>;
    lancer(dossierJeu: string, profils: IdProfil[]): Promise<ResultatComparaison>;
    annuler(): Promise<void>;
    /** Enregistre le rapport du dernier banc ; renvoie le chemin choisi, ou `null`. */
    exporter(): Promise<string | null>;
  };
  journal(): Promise<EntreeJournal[]>;
  /** Abonnement aux progressions ; renvoie la fonction de désabonnement. */
  surProgression(rappel: (progression: Progression) => void): () => void;
}
