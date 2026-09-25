// Types du domaine, partagés par le cœur, le processus principal et l'interface.
// Ce fichier ne doit dépendre ni de Node ni du DOM.

/** Valeur JSON sérialisable. */
export type ValeurJson = string | number | boolean | null | ValeurJson[] | { [cle: string]: ValeurJson };

/** Contenu soumis à un moteur de décision : texte, objet ou tableau JSON. */
export type Etat = string | { [cle: string]: ValeurJson } | ValeurJson[];

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type FormatDocument = 'txt' | 'md' | 'pdf' | 'docx';

/** Morceau de document, unité de la recherche. */
export interface Passage {
  /** Identifiant unique : `<id du document>#<rang>`. */
  id: string;
  documentId: string;
  /** Position du passage dans le document, à partir de 0. */
  rang: number;
  texte: string;
}

export interface DocumentIndexe {
  /** Chemin relatif au dossier indexé, avec des « / ». */
  id: string;
  /** Chemin absolu sur la machine. */
  chemin: string;
  nom: string;
  format: FormatDocument;
  /** Taille du fichier en octets. */
  taille: number;
  /** Date de dernière modification, au format ISO. */
  modifieLe: string;
  texte: string;
  passages: Passage[];
}

export interface ErreurIndexation {
  chemin: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Décisions : les trois types de questions de Jev (System One)
// ---------------------------------------------------------------------------

/** Question fermée : oui ou non. Jev la nomme `noul`. */
export interface QuestionOuiNon {
  type: 'oui-non';
  consigne: string;
  criteres?: { oui?: string; non?: string };
}

/** Choix d'une étiquette parmi une liste. Jev la nomme `choice`. */
export interface QuestionChoix {
  type: 'choix';
  consigne: string;
  /** Étiquette → description (ou `null` si l'étiquette se suffit). */
  options: Record<string, string | null>;
}

/** Note sur une échelle ordonnée, niveaux indexés depuis 0. Jev la nomme `score`. */
export interface QuestionNote {
  type: 'note';
  consigne: string;
  /** Au moins deux niveaux, du plus bas au plus haut. */
  echelle: readonly string[];
}

export type Question = QuestionOuiNon | QuestionChoix | QuestionNote;

export interface ReponseOuiNon {
  type: 'oui-non';
  /** Probabilité du « oui », entre 0 et 1. */
  probabiliteOui: number;
}

export interface ReponseChoix {
  type: 'choix';
  choix: string;
  /** Confiance dans l'étiquette choisie, entre 0 et 1. */
  confiance: number;
  probabilites: Record<string, number>;
}

export interface ReponseNote {
  type: 'note';
  /** Note attendue (moyenne pondérée), qui peut tomber entre deux niveaux. */
  note: number;
  confiance: number;
  /** Probabilité de chaque niveau, dans l'ordre de l'échelle. */
  probabilites: number[];
}

export type Reponse = ReponseOuiNon | ReponseChoix | ReponseNote;

// ---------------------------------------------------------------------------
// Mesures : ce que coûte chaque appel à un moteur
// ---------------------------------------------------------------------------

export interface Mesure {
  operation: 'decision' | 'redaction';
  /** Nom lisible du moteur, par exemple « Jev via OpenRouter ». */
  moteur: string;
  modele: string;
  dureeMs: number;
  jetonsEntree: number;
  jetonsSortie: number;
  /** Coût facturé en dollars US ; 0 pour un moteur local. */
  coutUsd: number;
  /** Vrai si le contenu a quitté la machine. */
  horsMachine: boolean;
  /** Caractères envoyés hors de la machine (0 en local). */
  caracteresEnvoyes: number;
  /** Données personnelles remplacées avant l'envoi. */
  elementsMasques: number;
  /** Nombre d'appels effectués au moteur. */
  appels: number;
}

// ---------------------------------------------------------------------------
// Résultats de l'agent
// ---------------------------------------------------------------------------

export type IdProfil = 'local' | 'hybride' | 'reference';

export interface Categorie {
  id: string;
  libelle: string;
  description: string;
}

export interface Triage {
  documentId: string;
  profil: IdProfil;
  categorie: string;
  confiance: number;
  probabilites: Record<string, number>;
  actionRequise: boolean;
  probabiliteAction: number;
  /** Urgence attendue, de 0 (aucune) à 2 (urgente). */
  urgence: number;
  /** Vrai si la confiance est sous le seuil : Blowdok doit vérifier. */
  aVerifier: boolean;
  mesures: Mesure[];
}

export interface ResultatRecherche {
  passage: Passage;
  documentNom: string;
  scoreLexical: number;
  /** Rang dans le classement lexical seul, à partir de 1. */
  rangLexical: number;
  /** Probabilité de pertinence décidée par le moteur, ou `null` sans décision. */
  pertinence: number | null;
}

export interface Recherche {
  requete: string;
  profil: IdProfil;
  resultats: ResultatRecherche[];
  mesures: Mesure[];
}

export interface Resume {
  documentId: string;
  profil: IdProfil;
  texte: string;
  /** Nombre de parties résumées séparément avant la synthèse (1 si court). */
  parties: number;
  mesures: Mesure[];
}
