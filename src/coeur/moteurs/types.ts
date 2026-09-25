// Contrats des moteurs : un moteur de décision répond à des questions typées
// (comme Jev), un moteur de rédaction produit du texte (les résumés).

import type { Etat, Mesure, Question, Reponse, ReponseChoix, ReponseNote, ReponseOuiNon } from '../../partage/types';

export interface OptionsAppel {
  signal?: AbortSignal;
}

export interface ResultatDecision {
  reponses: Record<string, Reponse>;
  mesure: Mesure;
}

export interface MoteurDecision {
  /** Nom lisible, par exemple « Jev via OpenRouter ». */
  readonly nom: string;
  readonly modele: string;
  /** Vrai si les données quittent la machine. */
  readonly horsMachine: boolean;
  decider(etat: Etat, questions: Record<string, Question>, options?: OptionsAppel): Promise<ResultatDecision>;
}

export interface MessageRedaction {
  systeme: string;
  utilisateur: string;
  /** Texte brut à traiter, déjà inclus dans `utilisateur` ; utile aux moteurs sans IA. */
  source: string;
}

export interface ResultatRedaction {
  texte: string;
  mesure: Mesure;
}

export interface MoteurRedaction {
  readonly nom: string;
  readonly modele: string;
  readonly horsMachine: boolean;
  rediger(message: MessageRedaction, options?: OptionsAppel & { maxJetons?: number }): Promise<ResultatRedaction>;
}

/** Erreur d'un moteur, avec un message lisible par Blowdok. */
export class ErreurMoteur extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErreurMoteur';
  }
}

/** Nombre maximal d'options d'une question (limite des log-probabilités d'Ollama). */
export const OPTIONS_MAX = 20;

/** Vérifie la forme des questions avant tout appel. */
export function validerQuestions(questions: Record<string, Question>): void {
  const entrees = Object.entries(questions);
  if (entrees.length === 0) throw new ErreurMoteur('Au moins une question est nécessaire.');
  for (const [nom, question] of entrees) {
    if (question.type === 'choix') {
      const nombre = Object.keys(question.options).length;
      if (nombre < 2 || nombre > OPTIONS_MAX) {
        throw new ErreurMoteur(`La question « ${nom} » doit proposer entre 2 et ${OPTIONS_MAX} options.`);
      }
    }
    if (question.type === 'note' && (question.echelle.length < 2 || question.echelle.length > OPTIONS_MAX)) {
      throw new ErreurMoteur(`L’échelle de la question « ${nom} » doit compter entre 2 et ${OPTIONS_MAX} niveaux.`);
    }
  }
}

/** État mis en texte pour un prompt : texte tel quel, JSON indenté sinon. */
export function etatEnTexte(etat: Etat): string {
  return typeof etat === 'string' ? etat : JSON.stringify(etat, null, 2);
}

export function nouvelleMesure(
  operation: Mesure['operation'],
  moteur: { nom: string; modele: string; horsMachine: boolean }
): Mesure {
  return {
    operation,
    moteur: moteur.nom,
    modele: moteur.modele,
    dureeMs: 0,
    jetonsEntree: 0,
    jetonsSortie: 0,
    coutUsd: 0,
    horsMachine: moteur.horsMachine,
    caracteresEnvoyes: 0,
    elementsMasques: 0,
    appels: 0
  };
}

function reponseDe(reponses: Record<string, Reponse>, cle: string, type: Reponse['type']): Reponse {
  const reponse = reponses[cle];
  if (!reponse || reponse.type !== type) {
    throw new ErreurMoteur(`Le moteur n’a pas répondu à la question « ${cle} ».`);
  }
  return reponse;
}

export function lireOuiNon(reponses: Record<string, Reponse>, cle: string): ReponseOuiNon {
  return reponseDe(reponses, cle, 'oui-non') as ReponseOuiNon;
}

export function lireChoix(reponses: Record<string, Reponse>, cle: string): ReponseChoix {
  return reponseDe(reponses, cle, 'choix') as ReponseChoix;
}

export function lireNote(reponses: Record<string, Reponse>, cle: string): ReponseNote {
  return reponseDe(reponses, cle, 'note') as ReponseNote;
}

/** Temps écoulé en millisecondes depuis `debut` (horloge monotone). */
export function depuis(debut: number): number {
  return Math.round(performance.now() - debut);
}
