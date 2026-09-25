// Plongements simulés : chaque texte devient un vecteur de « concepts ». Deux
// textes qui parlent de la même chose sans partager de mot restent proches,
// comme avec un vrai modèle de plongement.

import { sansAccents } from '../../src/coeur/texte/normalisation';
import { fauxFetch, reponseJson } from './faux-fetch';

const CONCEPTS: string[][] = [
  ['impot', 'impots', 'taxe', 'fiscal', 'fiscale', 'fonciere', 'tresor'],
  ['salaire', 'paie', 'remuneration', 'bulletin', 'brut', 'net'],
  ['voiture', 'vehicule', 'automobile', 'garage', 'pneus'],
  ['site', 'internet', 'web', 'hebergement', 'maintenance']
];

/** Vecteur de concepts d'un texte, invites des modèles retirées. */
export function vecteurConcepts(texte: string): number[] {
  const sansInvite = texte.replace(/^(task: search result \| query: |title: [^|]* \| text: |search_(query|document): )/, '');
  const mots = sansAccents(sansInvite.toLowerCase()).split(/[^a-z]+/);
  // Petite composante commune : aucun vecteur n'est nul.
  return [...CONCEPTS.map((concept) => mots.filter((m) => concept.includes(m)).length), 0.1];
}

/** Doublure d'Ollama pour /api/embed : répond par les vecteurs de concepts. */
export function ollamaPlongementsSimule() {
  return fauxFetch((appel) => {
    if (!appel.url.endsWith('/api/embed')) throw new Error(`Adresse inattendue : ${appel.url}`);
    const { input } = appel.corps as { input: string[] };
    return reponseJson({ model: 'embeddinggemma', embeddings: input.map(vecteurConcepts), prompt_eval_count: 10 * input.length });
  });
}
