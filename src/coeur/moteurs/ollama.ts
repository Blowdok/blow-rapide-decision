// Moteurs locaux par Ollama (API /api/chat).
//
// Décisions : chaque option reçoit une lettre (A, B, C…) et le modèle répond par
// une seule lettre. Les log-probabilités (Ollama ≥ 0.12.11) donnent la
// distribution sur les lettres : le mode local fournit donc, comme Jev, des
// probabilités et une confiance comparables d'un mode à l'autre.

import type { Etat, Mesure, Question, Reponse } from '../../partage/types';
import {
  depuis,
  ErreurMoteur,
  etatEnTexte,
  type MessageRedaction,
  type MoteurDecision,
  type MoteurRedaction,
  nouvelleMesure,
  type OptionsAppel,
  OPTIONS_MAX,
  type ResultatDecision,
  type ResultatRedaction,
  validerQuestions
} from './types';

export interface OptionsOllama {
  /** Adresse du serveur Ollama, `http://127.0.0.1:11434` par défaut. */
  url: string;
  modele: string;
  /** Taille de contexte demandée au modèle, en jetons. */
  contexte?: number;
  /** Délai d'un appel, en millisecondes (le premier chargement du modèle peut être long). */
  delaiMs?: number;
  fetch?: typeof fetch;
}

interface JetonLogprob {
  token: string;
  logprob: number;
  top_logprobs?: Array<{ token: string; logprob: number }>;
}

export interface ReponseChatOllama {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  logprobs?: JetonLogprob[];
}

/** Vrai si l'adresse désigne la machine elle-même. */
export function estAdresseLocale(url: string): boolean {
  try {
    const hote = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return hote === 'localhost' || hote === '::1' || hote.startsWith('127.');
  } catch {
    return false;
  }
}

/** Requête POST à l'API d'Ollama, avec des erreurs lisibles (serveur éteint, modèle absent, délai dépassé). */
export async function requeteOllama<T>(
  options: OptionsOllama,
  chemin: '/api/chat' | '/api/embed',
  corps: object,
  signal?: AbortSignal
): Promise<T> {
  const delai = AbortSignal.timeout(options.delaiMs ?? 300_000);
  const url = `${options.url.replace(/\/+$/, '')}${chemin}`;
  let reponse: Response;
  try {
    reponse = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      signal: signal ? AbortSignal.any([signal, delai]) : delai
    });
  } catch (erreur) {
    if (delai.aborted) throw new ErreurMoteur(`Ollama n’a pas répondu à temps (${options.url}).`, { cause: erreur });
    if (signal?.aborted) throw erreur;
    throw new ErreurMoteur(`Ollama est injoignable à ${options.url} : est-il lancé ?`, { cause: erreur });
  }
  const texte = await reponse.text();
  if (!reponse.ok) {
    let detail = texte;
    try {
      detail = (JSON.parse(texte) as { error?: string }).error ?? texte;
    } catch {
      // Corps non JSON : on garde le texte brut.
    }
    if (reponse.status === 404 && /not found/i.test(detail)) {
      throw new ErreurMoteur(
        `Le modèle « ${options.modele} » n’est pas installé dans Ollama : lancez « ollama pull ${options.modele} ».`
      );
    }
    throw new ErreurMoteur(`Erreur Ollama (${reponse.status}) : ${detail.slice(0, 300)}`);
  }
  try {
    return JSON.parse(texte) as T;
  } catch (erreur) {
    throw new ErreurMoteur(`Réponse illisible d’Ollama (${options.url}) : ${texte.slice(0, 120)}`, { cause: erreur });
  }
}

/** Appel à l'API de conversation d'Ollama (/api/chat), sans flux. */
export function appelerOllama(options: OptionsOllama, corps: object, signal?: AbortSignal): Promise<ReponseChatOllama> {
  return requeteOllama<ReponseChatOllama>(options, '/api/chat', corps, signal);
}

interface Candidat {
  lettre: string;
  intitule: string;
  description: string | null;
}

/** Options d'une question, étiquetées par des lettres. */
export function candidatsDe(question: Question): Candidat[] {
  const lettre = (i: number): string => String.fromCharCode(65 + i);
  switch (question.type) {
    case 'oui-non':
      return [
        { lettre: 'A', intitule: 'oui', description: question.criteres?.oui ?? null },
        { lettre: 'B', intitule: 'non', description: question.criteres?.non ?? null }
      ];
    case 'choix':
      return Object.entries(question.options).map(([intitule, description], i) => ({
        lettre: lettre(i),
        intitule,
        description
      }));
    case 'note':
      return question.echelle.map((description, i) => ({
        lettre: lettre(i),
        intitule: `niveau ${i}`,
        description
      }));
  }
}

const CONSIGNE_DECISION =
  "Tu es un moteur de décision. Tu lis un contexte, une question et des options repérées par des lettres. " +
  "Tu réponds uniquement par la lettre de l’option la plus juste, sans aucun autre caractère.";

export function promptDecision(etat: Etat, question: Question, candidats: Candidat[]): string {
  const options = candidats
    .map((c) => `${c.lettre}) ${c.intitule}${c.description ? ` : ${c.description}` : ''}`)
    .join('\n');
  const lettres = candidats.map((c) => c.lettre).join(', ');
  return `Contexte :\n<<<\n${etatEnTexte(etat)}\n>>>\n\nQuestion : ${question.consigne}\n\nOptions :\n${options}\n\nRéponds par une seule lettre parmi ${lettres}.`;
}

/** Lettre désignée par un jeton (« A », « a », « **A** », « A) »…), ou `null`. */
export function lettreDuJeton(jeton: string, lettres: readonly string[]): string | null {
  const nettoye = jeton
    .trim()
    .replace(/^[\s*_("'«[]+|[\s*_)"'».:,\]]+$/g, '')
    .toUpperCase();
  return lettres.includes(nettoye) ? nettoye : null;
}

/**
 * Distribution de probabilité sur les lettres, lue dans les log-probabilités
 * du premier jeton qui désigne une lettre. `null` si le modèle n'en fournit pas.
 */
export function distributionDepuisLogprobs(
  logprobs: JetonLogprob[] | undefined,
  lettres: readonly string[]
): Map<string, number> | null {
  if (!logprobs?.length) return null;
  const jeton = logprobs.find((j) => lettreDuJeton(j.token, lettres) !== null);
  if (!jeton) return null;
  const alternatives = jeton.top_logprobs?.length ? jeton.top_logprobs : [jeton];
  const masses = new Map<string, number>();
  for (const alternative of alternatives) {
    const lettre = lettreDuJeton(alternative.token, lettres);
    if (lettre) masses.set(lettre, (masses.get(lettre) ?? 0) + Math.exp(alternative.logprob));
  }
  const total = [...masses.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return new Map(lettres.map((l) => [l, (masses.get(l) ?? 0) / total]));
}

/** Construit la réponse typée à partir de la distribution sur les lettres. */
export function reponseDepuisDistribution(
  question: Question,
  candidats: Candidat[],
  distribution: Map<string, number>
): Reponse {
  const probabilite = (c: Candidat): number => distribution.get(c.lettre) ?? 0;
  switch (question.type) {
    case 'oui-non':
      return { type: 'oui-non', probabiliteOui: probabilite(candidats[0] as Candidat) };
    case 'choix': {
      const probabilites = Object.fromEntries(candidats.map((c) => [c.intitule, probabilite(c)]));
      const meilleur = candidats.reduce((a, b) => (probabilite(b) > probabilite(a) ? b : a));
      return { type: 'choix', choix: meilleur.intitule, confiance: probabilite(meilleur), probabilites };
    }
    case 'note': {
      const probabilites = candidats.map(probabilite);
      return {
        type: 'note',
        note: probabilites.reduce((somme, p, niveau) => somme + p * niveau, 0),
        confiance: Math.max(...probabilites),
        probabilites
      };
    }
  }
}

export class MoteurDecisionOllama implements MoteurDecision {
  readonly nom = 'Ollama';
  readonly modele: string;
  readonly horsMachine: boolean;
  readonly #options: OptionsOllama;

  constructor(options: OptionsOllama) {
    this.#options = options;
    this.modele = options.modele;
    this.horsMachine = !estAdresseLocale(options.url);
  }

  async decider(etat: Etat, questions: Record<string, Question>, options: OptionsAppel = {}): Promise<ResultatDecision> {
    validerQuestions(questions);
    const mesure: Mesure = nouvelleMesure('decision', this);
    const reponses: Record<string, Reponse> = {};
    const debut = performance.now();

    // Une génération par question ; l'état vient en tête du prompt pour que
    // le cache de contexte d'Ollama serve d'une question à la suivante.
    for (const [nom, question] of Object.entries(questions)) {
      const candidats = candidatsDe(question);
      const lettres = candidats.map((c) => c.lettre);
      const prompt = promptDecision(etat, question, candidats);
      const reponse = await appelerOllama(
        this.#options,
        {
          model: this.modele,
          messages: [
            { role: 'system', content: CONSIGNE_DECISION },
            { role: 'user', content: prompt }
          ],
          stream: false,
          think: false,
          logprobs: true,
          top_logprobs: OPTIONS_MAX,
          options: { temperature: 0, num_predict: 4, num_ctx: this.#options.contexte ?? 8192 }
        },
        options.signal
      );
      mesure.appels += 1;
      mesure.jetonsEntree += reponse.prompt_eval_count ?? 0;
      mesure.jetonsSortie += reponse.eval_count ?? 0;
      if (this.horsMachine) mesure.caracteresEnvoyes += CONSIGNE_DECISION.length + prompt.length;

      let distribution = distributionDepuisLogprobs(reponse.logprobs, lettres);
      if (!distribution) {
        // Ollama trop ancien pour les log-probabilités : on lit la lettre produite.
        const lettre = lettreDuJeton((reponse.message?.content ?? '').trim().slice(0, 6), lettres)
          ?? lettres.find((l) => new RegExp(`\\b${l}\\b`).test(reponse.message?.content ?? ''));
        if (!lettre) {
          throw new ErreurMoteur(
            `Réponse illisible du modèle local pour « ${nom} » : « ${(reponse.message?.content ?? '').slice(0, 40)} ».`
          );
        }
        distribution = new Map(lettres.map((l) => [l, l === lettre ? 1 : 0]));
      }
      reponses[nom] = reponseDepuisDistribution(question, candidats, distribution);
    }

    mesure.dureeMs = depuis(debut);
    return { reponses, mesure };
  }
}

export class MoteurRedactionOllama implements MoteurRedaction {
  readonly nom = 'Ollama';
  readonly modele: string;
  readonly horsMachine: boolean;
  readonly #options: OptionsOllama;

  constructor(options: OptionsOllama) {
    this.#options = options;
    this.modele = options.modele;
    this.horsMachine = !estAdresseLocale(options.url);
  }

  async rediger(message: MessageRedaction, options: OptionsAppel & { maxJetons?: number } = {}): Promise<ResultatRedaction> {
    const mesure = nouvelleMesure('redaction', this);
    const debut = performance.now();
    const reponse = await appelerOllama(
      this.#options,
      {
        model: this.modele,
        messages: [
          { role: 'system', content: message.systeme },
          { role: 'user', content: message.utilisateur }
        ],
        stream: false,
        think: false,
        options: {
          temperature: 0.2,
          num_predict: options.maxJetons ?? 800,
          num_ctx: this.#options.contexte ?? 8192
        }
      },
      options.signal
    );
    mesure.dureeMs = depuis(debut);
    mesure.appels = 1;
    mesure.jetonsEntree = reponse.prompt_eval_count ?? 0;
    mesure.jetonsSortie = reponse.eval_count ?? 0;
    if (this.horsMachine) mesure.caracteresEnvoyes = message.systeme.length + message.utilisateur.length;
    const texte = (reponse.message?.content ?? '').trim();
    if (!texte) throw new ErreurMoteur('Le modèle local a renvoyé un texte vide.');
    return { texte, mesure };
  }
}

/** Modèles installés dans Ollama (API /api/tags). */
export async function listerModelesOllama(url: string, fetchFn: typeof fetch = fetch): Promise<string[]> {
  let reponse: Response;
  try {
    reponse = await fetchFn(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch (erreur) {
    throw new ErreurMoteur(`Ollama est injoignable à ${url} : est-il lancé ?`, { cause: erreur });
  }
  if (!reponse.ok) throw new ErreurMoteur(`Erreur Ollama (${reponse.status}) à la lecture des modèles.`);
  const corps = (await reponse.json()) as { models?: Array<{ name?: string }> };
  return (corps.models ?? []).map((m) => m.name ?? '').filter(Boolean).sort();
}
