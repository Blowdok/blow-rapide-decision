// Index vectoriel en mémoire, pour la recherche sémantique facultative, et
// fusion de classements par rang réciproque.

export interface ResultatVectoriel<T> {
  element: T;
  /** Similarité cosinus avec la requête, entre -1 et 1. */
  similarite: number;
}

/**
 * Recherche exhaustive par produit scalaire de vecteurs de norme 1 : assez
 * rapide pour quelques dizaines de milliers de passages.
 */
export class IndexVectoriel<T> {
  readonly dimension: number;
  readonly #elements: T[] = [];
  readonly #vecteurs: Float32Array[] = [];

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  get taille(): number {
    return this.#elements.length;
  }

  ajouter(element: T, vecteur: Float32Array): void {
    if (vecteur.length !== this.dimension) {
      throw new Error(`Vecteur de dimension ${vecteur.length} au lieu de ${this.dimension}.`);
    }
    this.#elements.push(element);
    this.#vecteurs.push(vecteur);
  }

  /** Éléments les plus proches de la requête, par similarité décroissante. */
  chercher(requete: Float32Array, limite = 10): ResultatVectoriel<T>[] {
    if (this.#elements.length === 0) return [];
    if (requete.length !== this.dimension) {
      throw new Error(`Requête de dimension ${requete.length} au lieu de ${this.dimension}.`);
    }
    const scores = this.#vecteurs.map((vecteur, position) => {
      let produit = 0;
      for (let i = 0; i < vecteur.length; i++) produit += (vecteur[i] as number) * (requete[i] as number);
      return { position, produit };
    });
    return scores
      .sort((a, b) => b.produit - a.produit || a.position - b.position)
      .slice(0, limite)
      .map(({ position, produit }) => ({ element: this.#elements[position] as T, similarite: produit }));
  }
}

/** Constante de la fusion par rang réciproque : elle atténue l'écart entre les premiers rangs. */
export const K_FUSION = 60;

/**
 * Fusion par rang réciproque (Reciprocal Rank Fusion) : chaque classement
 * apporte 1 / (k + rang) à ses éléments. Sans score à calibrer, elle marie un
 * classement par mots-clés et un classement par le sens. À score égal, le
 * meilleur rang l'emporte, puis le classement cité en premier.
 */
export function fusionnerClassements(classements: ReadonlyArray<readonly string[]>, k = K_FUSION): string[] {
  const cumuls = new Map<string, { score: number; meilleurRang: number; classement: number }>();
  classements.forEach((ids, classement) => {
    ids.forEach((id, position) => {
      const rang = position + 1;
      const cumul = cumuls.get(id);
      if (!cumul) {
        cumuls.set(id, { score: 1 / (k + rang), meilleurRang: rang, classement });
        return;
      }
      cumul.score += 1 / (k + rang);
      if (rang < cumul.meilleurRang) {
        cumul.meilleurRang = rang;
        cumul.classement = classement;
      }
    });
  });
  return [...cumuls]
    .sort(([, a], [, b]) => b.score - a.score || a.meilleurRang - b.meilleurRang || a.classement - b.classement)
    .map(([id]) => id);
}
