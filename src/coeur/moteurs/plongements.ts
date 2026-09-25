// Plongements vectoriels par Ollama (API /api/embed), pour la recherche
// sémantique facultative. Un modèle de plongement change un texte en vecteur :
// deux textes de sens voisin ont des vecteurs proches, même sans mot commun.

import type { Mesure } from '../../partage/types';
import { estAdresseLocale, type OptionsOllama, requeteOllama } from './ollama';
import { depuis, ErreurMoteur, nouvelleMesure, type OptionsAppel } from './types';

export type UsagePlongement = 'requete' | 'document';

export interface TexteAPlonger {
  texte: string;
  /** Titre du document, pour les modèles qui l'exploitent. */
  titre?: string;
}

export interface ResultatPlongement {
  /** Vecteurs de norme 1, dans l'ordre des textes. */
  vecteurs: Float32Array[];
  mesure: Mesure;
}

export interface OptionsPlongement extends OptionsAppel {
  /** Appelé après chaque lot, avec le nombre de textes déjà plongés. */
  surAvancement?: (faits: number) => void;
}

export interface MoteurPlongement {
  readonly nom: string;
  readonly modele: string;
  readonly horsMachine: boolean;
  plonger(textes: TexteAPlonger[], usage: UsagePlongement, options?: OptionsPlongement): Promise<ResultatPlongement>;
}

/** Textes envoyés par requête à Ollama. */
export const TAILLE_LOT = 16;

/**
 * Texte soumis au modèle, avec l'invite qu'il attend. EmbeddingGemma et la
 * famille nomic-embed-text distinguent une requête d'un document ; les autres
 * modèles reçoivent le texte seul.
 */
export function textePourModele(modele: string, usage: UsagePlongement, { texte, titre }: TexteAPlonger): string {
  const nom = modele.toLowerCase();
  if (nom.includes('embeddinggemma')) {
    return usage === 'requete' ? `task: search result | query: ${texte}` : `title: ${titre || 'none'} | text: ${texte}`;
  }
  const corps = titre ? `${titre}\n${texte}` : texte;
  if (nom.includes('nomic-embed-text')) return `${usage === 'requete' ? 'search_query' : 'search_document'}: ${corps}`;
  return corps;
}

/** Vecteur ramené à une norme de 1 : la similarité cosinus devient un simple produit scalaire. */
export function normaliser(valeurs: readonly number[]): Float32Array {
  const vecteur = Float32Array.from(valeurs);
  let somme = 0;
  for (const valeur of vecteur) somme += valeur * valeur;
  const norme = Math.sqrt(somme);
  if (norme > 0) for (let i = 0; i < vecteur.length; i++) vecteur[i] = (vecteur[i] as number) / norme;
  return vecteur;
}

interface ReponseEmbedOllama {
  embeddings?: number[][];
  prompt_eval_count?: number;
}

export class MoteurPlongementOllama implements MoteurPlongement {
  readonly nom = 'Ollama';
  readonly modele: string;
  readonly horsMachine: boolean;
  readonly #options: OptionsOllama;

  constructor(options: OptionsOllama) {
    this.#options = options;
    this.modele = options.modele;
    this.horsMachine = !estAdresseLocale(options.url);
  }

  async plonger(textes: TexteAPlonger[], usage: UsagePlongement, options: OptionsPlongement = {}): Promise<ResultatPlongement> {
    const mesure = nouvelleMesure('plongement', this);
    const debut = performance.now();
    const vecteurs: Float32Array[] = [];

    for (let debutLot = 0; debutLot < textes.length; debutLot += TAILLE_LOT) {
      const lot = textes.slice(debutLot, debutLot + TAILLE_LOT).map((t) => textePourModele(this.modele, usage, t));
      let reponse: ReponseEmbedOllama;
      try {
        // `truncate` coupe un texte trop long pour le modèle au lieu d'échouer.
        reponse = await requeteOllama<ReponseEmbedOllama>(
          this.#options,
          '/api/embed',
          { model: this.modele, input: lot, truncate: true },
          options.signal
        );
      } catch (erreur) {
        if (/does not support embed/i.test((erreur as Error).message)) {
          throw new ErreurMoteur(
            `Le modèle « ${this.modele} » ne calcule pas de plongements : choisissez un modèle de plongement, par exemple embeddinggemma.`,
            { cause: erreur }
          );
        }
        throw erreur;
      }
      const recus = reponse.embeddings ?? [];
      if (recus.length !== lot.length || recus.some((v) => !Array.isArray(v) || v.length === 0)) {
        throw new ErreurMoteur(`Réponse inattendue d’Ollama : ${recus.length} vecteur(s) pour ${lot.length} texte(s).`);
      }
      vecteurs.push(...recus.map(normaliser));
      mesure.appels += 1;
      mesure.jetonsEntree += reponse.prompt_eval_count ?? 0;
      if (this.horsMachine) mesure.caracteresEnvoyes += lot.reduce((somme, t) => somme + t.length, 0);
      options.surAvancement?.(vecteurs.length);
    }

    const dimension = vecteurs[0]?.length ?? 0;
    if (vecteurs.some((v) => v.length !== dimension)) {
      throw new ErreurMoteur('Réponse inattendue d’Ollama : vecteurs de tailles différentes.');
    }
    mesure.dureeMs = depuis(debut);
    return { vecteurs, mesure };
  }
}
