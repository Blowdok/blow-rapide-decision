// Exécution parallèle bornée : utile pour les moteurs distants (Jev, OpenRouter),
// inutile pour un modèle local qui traite une requête à la fois.

/** Applique `tache` à chaque élément, `limite` à la fois, en gardant l'ordre. */
export async function executerParLots<E, R>(
  elements: readonly E[],
  limite: number,
  tache: (element: E, position: number) => Promise<R>
): Promise<R[]> {
  const resultats = new Array<R>(elements.length);
  let prochain = 0;
  const ouvrier = async (): Promise<void> => {
    while (prochain < elements.length) {
      const position = prochain++;
      resultats[position] = await tache(elements[position] as E, position);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, elements.length)) }, ouvrier));
  return resultats;
}
