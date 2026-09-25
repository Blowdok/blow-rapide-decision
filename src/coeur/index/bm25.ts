// Index lexical BM25 (Okapi) sur des termes français normalisés.

import { termes } from '../texte/normalisation';

interface Occurrence {
  position: number;
  frequence: number;
}

export interface ResultatBm25<T> {
  element: T;
  score: number;
}

export class IndexBm25<T> {
  readonly #elements: T[] = [];
  readonly #longueurs: number[] = [];
  readonly #postings = new Map<string, Occurrence[]>();
  readonly k1: number;
  readonly b: number;
  #longueurTotale = 0;

  /**
   * @param k1 saturation de la fréquence d'un terme (1,2 par défaut)
   * @param b poids de la normalisation par la longueur (0,75 par défaut)
   */
  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  get taille(): number {
    return this.#elements.length;
  }

  ajouter(element: T, texte: string): void {
    const position = this.#elements.length;
    const liste = termes(texte);
    const frequences = new Map<string, number>();
    for (const terme of liste) frequences.set(terme, (frequences.get(terme) ?? 0) + 1);
    for (const [terme, frequence] of frequences) {
      const occurrences = this.#postings.get(terme);
      if (occurrences) occurrences.push({ position, frequence });
      else this.#postings.set(terme, [{ position, frequence }]);
    }
    this.#elements.push(element);
    this.#longueurs.push(liste.length);
    this.#longueurTotale += liste.length;
  }

  /** Éléments classés par score décroissant ; seuls les scores positifs sont gardés. */
  chercher(requete: string, limite = 10): ResultatBm25<T>[] {
    const total = this.#elements.length;
    if (total === 0) return [];
    const longueurMoyenne = this.#longueurTotale / total || 1;
    const scores = new Map<number, number>();

    for (const terme of new Set(termes(requete))) {
      const occurrences = this.#postings.get(terme);
      if (!occurrences) continue;
      const idf = Math.log(1 + (total - occurrences.length + 0.5) / (occurrences.length + 0.5));
      for (const { position, frequence } of occurrences) {
        const longueur = this.#longueurs[position] ?? 0;
        const normalisation = this.k1 * (1 - this.b + (this.b * longueur) / longueurMoyenne);
        const gain = (idf * frequence * (this.k1 + 1)) / (frequence + normalisation);
        scores.set(position, (scores.get(position) ?? 0) + gain);
      }
    }

    return [...scores]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limite)
      .map(([position, score]) => ({ element: this.#elements[position] as T, score }));
  }
}
