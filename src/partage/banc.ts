// Types du banc de décision, partagés avec l'interface. Sans dépendance à Node.

import type { IdProfil, Mesure } from './types';

export interface AttenteClassement {
  document: string;
  categorie: string;
  /** Action requise attendue ; omise si le cas prête à débat. */
  action?: boolean;
  /** Urgence attendue, 0, 1 ou 2 ; omise si le cas prête à débat. */
  urgence?: number;
}

export interface AttenteRecherche {
  requete: string;
  /** Documents qui répondent à la requête. */
  pertinents: string[];
}

export interface AttenteResume {
  document: string;
  /** Faits à citer ; chaque fait liste ses variantes acceptées. */
  faits: string[][];
}

export interface JeuEvaluation {
  nom: string;
  description: string;
  /** Dossier des documents, chemin absolu. */
  dossierDocuments: string;
  classement: AttenteClassement[];
  recherche: AttenteRecherche[];
  resume: AttenteResume[];
  criteres: {
    /** Écart de qualité (points sur 100) sous lequel le mode local est préféré. */
    toleranceQualite: number;
  };
}

/** Durée et coût d'un élément évalué, toutes mesures confondues. */
interface CoutElement {
  dureeMs: number;
  coutUsd: number;
  erreur?: string;
}

export interface ResultatClassement extends CoutElement {
  attendu: AttenteClassement;
  obtenu?: { categorie: string; confiance: number; probabiliteAction: number; urgence: number; aVerifier: boolean };
  categorieJuste?: boolean;
  actionJuste?: boolean;
  urgenceJuste?: boolean;
}

export interface ResultatRechercheBanc extends CoutElement {
  requete: string;
  pertinents: string[];
  /** Documents trouvés, sans doublon, dans l'ordre du classement final. */
  documentsObtenus: string[];
  /** Rang du premier document pertinent (à partir de 1), `null` s'il est absent. */
  rangPertinent: number | null;
}

export interface ResultatResumeBanc extends CoutElement {
  document: string;
  texte?: string;
  faitsTrouves: number;
  faitsTotal: number;
  /** Première variante de chaque fait absent du résumé. */
  faitsManquants: string[];
  mots: number;
}

export interface MetriquesProfil {
  /** Indice de qualité sur 100 : moyenne des taux de réussite disponibles. */
  qualite: number | null;
  classement: {
    evalues: number;
    categorie: number | null;
    action: number | null;
    urgence: number | null;
    /** Part des documents marqués « à vérifier ». */
    aVerifier: number | null;
    /** Catégorie juste parmi les documents non marqués « à vérifier ». */
    categorieSiSur: number | null;
    erreurs: number;
  };
  recherche: {
    evaluees: number;
    /** Rang réciproque moyen du premier document pertinent. */
    mrr: number | null;
    enTete: number | null;
    dansTop3: number | null;
    erreurs: number;
  };
  resume: {
    evalues: number;
    couverture: number | null;
    motsMoyens: number | null;
    erreurs: number;
  };
  temps: {
    totalMs: number;
    triageMoyenMs: number | null;
    rechercheMoyenneMs: number | null;
    resumeMoyenMs: number | null;
  };
  cout: {
    totalUsd: number;
    /** Estimation pour 1 000 documents triés et résumés. */
    pour1000DocumentsUsd: number | null;
  };
  confidentialite: {
    appelsHorsMachine: number;
    caracteresEnvoyes: number;
    elementsMasques: number;
  };
}

export type StatutProfil = 'termine' | 'interrompu' | 'indisponible';

export const LIBELLES_STATUT: Record<StatutProfil, string> = {
  termine: 'terminé',
  interrompu: 'interrompu',
  indisponible: 'indisponible'
};

export interface ResultatProfil {
  profil: IdProfil;
  libelle: string;
  moteurs: { decision: string; redaction: string };
  statut: StatutProfil;
  message?: string;
  classement: ResultatClassement[];
  recherche: ResultatRechercheBanc[];
  resume: ResultatResumeBanc[];
  mesures: Mesure[];
  metriques: MetriquesProfil;
}

export interface Recommandation {
  profil: IdProfil | null;
  titre: string;
  raisons: string[];
  avertissements: string[];
}

/** Recherche sémantique (option) pendant le banc. */
export interface SemantiqueBanc {
  /** Modèle de plongement ; `null` si l'index sémantique n'a pas pu être calculé. */
  modele: string | null;
  /** Raison de l'indisponibilité. */
  avis?: string;
  /** Classement par BM25 et recherche sémantique fusionnés, sans décision (vide si indisponible). */
  recherche: ResultatRechercheBanc[];
}

export interface ResultatBanc {
  jeu: { nom: string; description: string; documents: number };
  /** Date du banc, au format ISO. */
  date: string;
  toleranceQualite: number;
  /** Classement par la seule recherche lexicale (BM25), commun à tous les modes. */
  rechercheLexicale: ResultatRechercheBanc[];
  /** Recherche sémantique (option) ; absente si l'option était désactivée. */
  semantique?: SemantiqueBanc;
  profils: ResultatProfil[];
  recommandation: Recommandation;
}

export interface ProgressionBanc {
  profil: IdProfil;
  etape: 'classement' | 'recherche' | 'resume';
  fait: number;
  total: number;
}
