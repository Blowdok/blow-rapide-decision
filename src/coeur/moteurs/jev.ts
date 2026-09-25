// Moteur de décision Jev (TypeSafe AI), par le SDK officiel `@typesafe-ai/sdk`.
// Jev ne rédige pas : il renvoie des décisions typées avec leurs probabilités.
// Deux accès possibles : OpenRouter (même clé que les résumés) ou TypeSafe en direct.

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  type Question as QuestionJev,
  type Questions,
  TypeSafeClient
} from '@typesafe-ai/sdk';
import type { AccesJev } from '../../partage/reglages';
import type { Etat, Mesure, Question, Reponse } from '../../partage/types';
import {
  depuis,
  ErreurMoteur,
  type MoteurDecision,
  nouvelleMesure,
  type OptionsAppel,
  type ResultatDecision,
  validerQuestions
} from './types';

/** Racine de l'API System One d'OpenRouter, pour le SDK TypeSafe. */
export const URL_JEV_OPENROUTER = 'https://openrouter.ai/api';

/** Tarif public de Jev en septembre 2026 : 0,042 $ par million de jetons d'entrée, sortie gratuite. */
export const TARIF_JEV_ENTREE_USD_PAR_MILLION = 0.042;

export interface OptionsJev {
  acces: AccesJev;
  /** Clé OpenRouter ou clé TypeSafe, selon l'accès. */
  cle: string;
  /** `jev-latest` par défaut ; OpenRouter le route vers `~typesafe/jev-latest`. */
  modele?: string;
  /** Délai par tentative, en millisecondes. */
  delaiMs?: number;
  /** Implémentation de `fetch`, remplaçable pour les tests. */
  fetch?: typeof fetch;
}

/** Traduit nos questions vers le format de Jev (`noul`, `choice`, `score`). */
export function versQuestionsJev(questions: Record<string, Question>): Questions {
  const resultat: Questions = {};
  for (const [nom, question] of Object.entries(questions)) {
    let traduite: QuestionJev;
    switch (question.type) {
      case 'oui-non':
        traduite = {
          type: 'noul',
          instructions: question.consigne,
          criteria: question.criteres
            ? { true: question.criteres.oui ?? null, false: question.criteres.non ?? null }
            : null
        };
        break;
      case 'choix':
        traduite = { type: 'choice', instructions: question.consigne, criteria: question.options };
        break;
      case 'note':
        traduite = {
          type: 'score',
          instructions: question.consigne,
          criteria: question.echelle as unknown as [string, string, ...string[]]
        };
        break;
    }
    resultat[nom] = traduite;
  }
  return resultat;
}

/** Forme brute d'une réponse de Jev, telle que renvoyée par l'API. */
type ReponseJevBrute =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> };

/** Traduit une réponse de Jev vers notre format, en vérifiant son type. */
export function depuisReponseJev(nom: string, question: Question, brute: ReponseJevBrute | undefined): Reponse {
  if (question.type === 'oui-non' && brute?.type === 'noul') {
    return { type: 'oui-non', probabiliteOui: brute.noul };
  }
  if (question.type === 'choix' && brute?.type === 'choice') {
    return {
      type: 'choix',
      choix: brute.choice,
      confiance: brute.confidence,
      probabilites: { ...brute.probabilities }
    };
  }
  if (question.type === 'note' && brute?.type === 'score') {
    return {
      type: 'note',
      note: brute.score,
      confiance: brute.confidence,
      probabilites: question.echelle.map((_, niveau) => brute.probabilities[String(niveau)] ?? 0)
    };
  }
  throw new ErreurMoteur(`Réponse inattendue de Jev pour la question « ${nom} ».`);
}

/** Message lisible pour une erreur du SDK ou du réseau. */
export function messageErreurJev(erreur: unknown, service: string): string {
  if (erreur instanceof APIError) {
    switch (erreur.status) {
      case 401:
        return `${service} refuse la clé API (401). Vérifiez la clé dans les réglages.`;
      case 402:
        return `Crédit ${service} insuffisant (402).`;
      case 403:
        return `${service} refuse l’accès à Jev (403) : l’accès au modèle est peut-être limité.`;
      case 429:
        return `Trop de requêtes vers ${service} (429). Réessayez dans un instant.`;
      default:
        return `Erreur ${service} : ${erreur.message}`;
    }
  }
  if (erreur instanceof APITimeoutError) return `${service} n’a pas répondu à temps.`;
  if (erreur instanceof APIConnectionError) return `Connexion impossible à ${service} : vérifiez le réseau.`;
  return `Erreur ${service} : ${(erreur as Error).message}`;
}

export class MoteurJev implements MoteurDecision {
  readonly nom: string;
  readonly modele: string;
  readonly horsMachine = true;
  readonly #client: TypeSafeClient;
  readonly #service: string;

  constructor(options: OptionsJev) {
    if (!options.cle) {
      throw new ErreurMoteur(
        options.acces === 'openrouter'
          ? 'Clé OpenRouter manquante : Jev passe par OpenRouter en mode hybride.'
          : 'Clé TypeSafe manquante pour appeler Jev en direct.'
      );
    }
    this.#service = options.acces === 'openrouter' ? 'OpenRouter' : 'TypeSafe';
    this.nom = `Jev via ${this.#service}`;
    this.modele = options.modele ?? 'jev-latest';
    this.#client = new TypeSafeClient({
      apiKey: options.cle,
      ...(options.acces === 'openrouter' ? { baseURL: URL_JEV_OPENROUTER } : {}),
      defaultModel: this.modele,
      timeout: options.delaiMs ?? 20_000,
      logLevel: 'error',
      ...(options.fetch ? { fetch: options.fetch } : {})
    });
  }

  async decider(etat: Etat, questions: Record<string, Question>, options: OptionsAppel = {}): Promise<ResultatDecision> {
    validerQuestions(questions);
    const questionsJev = versQuestionsJev(questions);
    const mesure: Mesure = nouvelleMesure('decision', this);
    const debut = performance.now();
    let resultat;
    try {
      resultat = await this.#client.systemOne(
        { state: etat, questions: questionsJev, model: this.modele },
        options.signal ? { signal: options.signal } : {}
      );
    } catch (erreur) {
      throw new ErreurMoteur(messageErreurJev(erreur, this.#service), { cause: erreur });
    }
    mesure.dureeMs = depuis(debut);
    mesure.appels = 1;
    mesure.caracteresEnvoyes = JSON.stringify({ state: etat, questions: questionsJev }).length;

    const usage = resultat.usage as { input_tokens?: number; output_tokens?: number; cost?: number };
    mesure.jetonsEntree = usage.input_tokens ?? 0;
    mesure.jetonsSortie = usage.output_tokens ?? 0;
    // OpenRouter renvoie le coût facturé ; en direct, on applique le tarif public.
    mesure.coutUsd = usage.cost ?? (mesure.jetonsEntree * TARIF_JEV_ENTREE_USD_PAR_MILLION) / 1_000_000;
    mesure.modele = resultat.model || this.modele;

    const reponses: Record<string, Reponse> = {};
    const brutes = resultat.answers as Record<string, ReponseJevBrute | undefined>;
    for (const [nom, question] of Object.entries(questions)) {
      reponses[nom] = depuisReponseJev(nom, question, brutes[nom]);
    }
    return { reponses, mesure };
  }
}

/** Modèles Jev accessibles avec une clé TypeSafe (accès direct uniquement). */
export async function listerModelesJev(cle: string, fetchFn?: typeof fetch): Promise<string[]> {
  const client = new TypeSafeClient({ apiKey: cle, logLevel: 'error', timeout: 10_000, ...(fetchFn ? { fetch: fetchFn } : {}) });
  try {
    return (await client.models.list()).map((m) => m.name);
  } catch (erreur) {
    throw new ErreurMoteur(messageErreurJev(erreur, 'TypeSafe'), { cause: erreur });
  }
}
