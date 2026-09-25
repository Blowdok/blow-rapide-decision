// Moteurs de référence, sans IA : heuristiques lexicales déterministes.
// Ils servent de point de comparaison dans le banc (que gagne-t-on avec
// l'IA ?), de mode hors ligne et de doublure dans les tests.

import type { Etat, Mesure, Question, Reponse } from '../../partage/types';
import { termes } from '../texte/normalisation';
import {
  depuis,
  etatEnTexte,
  type MessageRedaction,
  type MoteurDecision,
  type MoteurRedaction,
  nouvelleMesure,
  type ResultatDecision,
  type ResultatRedaction,
  validerQuestions
} from './types';

/** Recouvrement lexical entre l'état et un texte d'option, pondéré par la taille de l'option. */
function similarite(termesEtat: Set<string>, texte: string): number {
  const candidats = new Set(termes(texte));
  if (candidats.size === 0) return 0;
  let communs = 0;
  for (const terme of candidats) if (termesEtat.has(terme)) communs++;
  return communs / Math.sqrt(candidats.size);
}

function softmax(scores: number[], beta = 3): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(beta * (s - max)));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}

const sigmoide = (x: number): number => 1 / (1 + Math.exp(-x));

/** Réponse heuristique à une question, à partir des termes de l'état. */
export function repondreParRecouvrement(termesEtat: Set<string>, question: Question): Reponse {
  switch (question.type) {
    case 'oui-non': {
      const oui = similarite(termesEtat, question.criteres?.oui ?? question.consigne);
      const non = similarite(termesEtat, question.criteres?.non ?? '');
      return { type: 'oui-non', probabiliteOui: sigmoide(3 * (oui - non) - 1) };
    }
    case 'choix': {
      const etiquettes = Object.keys(question.options);
      const probabilites = softmax(
        etiquettes.map((e) => similarite(termesEtat, `${e.replace(/-/g, ' ')} ${question.options[e] ?? ''}`))
      );
      let meilleur = 0;
      probabilites.forEach((p, i) => {
        if (p > (probabilites[meilleur] ?? 0)) meilleur = i;
      });
      return {
        type: 'choix',
        choix: etiquettes[meilleur] ?? '',
        confiance: probabilites[meilleur] ?? 0,
        probabilites: Object.fromEntries(etiquettes.map((e, i) => [e, probabilites[i] ?? 0]))
      };
    }
    case 'note': {
      const probabilites = softmax(question.echelle.map((niveau) => similarite(termesEtat, niveau)));
      return {
        type: 'note',
        note: probabilites.reduce((somme, p, niveau) => somme + p * niveau, 0),
        confiance: Math.max(...probabilites),
        probabilites
      };
    }
  }
}

export class MoteurDecisionReference implements MoteurDecision {
  readonly nom = 'Référence sans IA';
  readonly modele = 'recouvrement lexical';
  readonly horsMachine = false;

  async decider(etat: Etat, questions: Record<string, Question>): Promise<ResultatDecision> {
    validerQuestions(questions);
    const debut = performance.now();
    const termesEtat = new Set(termes(etatEnTexte(etat)));
    const reponses: Record<string, Reponse> = {};
    for (const [nom, question] of Object.entries(questions)) {
      reponses[nom] = repondreParRecouvrement(termesEtat, question);
    }
    const mesure: Mesure = nouvelleMesure('decision', this);
    mesure.dureeMs = depuis(debut);
    mesure.appels = 1;
    return { reponses, mesure };
  }
}

/** Phrases d'un texte, découpées sur la ponctuation forte et les retours à la ligne. */
export function phrasesDe(texte: string): string[] {
  return texte
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((p) => p.replace(/^[-*#>\s]+/, '').trim())
    .filter((p) => p.split(/\s+/).length >= 3);
}

/** Résumé extractif : les phrases les plus représentatives, dans l'ordre du texte. */
export function resumeExtractif(source: string, nombre = 5): string {
  const phrases = phrasesDe(source);
  const frequences = new Map<string, number>();
  for (const terme of termes(source)) frequences.set(terme, (frequences.get(terme) ?? 0) + 1);
  const notees = phrases.map((phrase, position) => {
    const uniques = new Set(termes(phrase));
    let poids = 0;
    for (const terme of uniques) poids += frequences.get(terme) ?? 0;
    // Les chiffres (montants, dates, références) font souvent l'essentiel.
    const bonus = (/\d/.test(phrase) ? 1 : 0) + (/€|euros?\b/i.test(phrase) ? 0.5 : 0);
    return { phrase, position, score: poids / Math.sqrt(uniques.size + 1) + bonus };
  });
  return notees
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, nombre)
    .sort((a, b) => a.position - b.position)
    .map(({ phrase }) => `- ${phrase}`)
    .join('\n');
}

export class MoteurRedactionReference implements MoteurRedaction {
  readonly nom = 'Référence sans IA';
  readonly modele = 'résumé extractif';
  readonly horsMachine = false;

  async rediger(message: MessageRedaction): Promise<ResultatRedaction> {
    const debut = performance.now();
    const texte = resumeExtractif(message.source) || message.source.slice(0, 500);
    const mesure = nouvelleMesure('redaction', this);
    mesure.dureeMs = depuis(debut);
    mesure.appels = 1;
    return { texte, mesure };
  }
}
