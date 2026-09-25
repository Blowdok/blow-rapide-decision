// Métriques d'un profil : qualité, temps, coût et confidentialité.

import type {
  MetriquesProfil,
  ResultatClassement,
  ResultatRechercheBanc,
  ResultatResumeBanc
} from '../../partage/banc';
import type { Mesure } from '../../partage/types';
import { pourComparaison } from '../texte/normalisation';

/** Faits retrouvés dans un texte, comparés sans accents, casse ni espaces de milliers. */
export function evaluerFaits(texte: string, faits: readonly string[][]): { trouves: number; manquants: string[] } {
  const normalise = pourComparaison(texte);
  const manquants = faits.filter((variantes) => !variantes.some((v) => normalise.includes(pourComparaison(v))));
  return { trouves: faits.length - manquants.length, manquants: manquants.map((v) => v[0] ?? '') };
}

/** Rang (à partir de 1) du premier document pertinent, `null` s'il est absent. */
export function rangDuPremierPertinent(documents: readonly string[], pertinents: readonly string[]): number | null {
  const position = documents.findIndex((d) => pertinents.includes(d));
  return position === -1 ? null : position + 1;
}

const moyenne = (valeurs: number[]): number | null =>
  valeurs.length === 0 ? null : valeurs.reduce((a, b) => a + b, 0) / valeurs.length;

/** Part des éléments vrais ; `null` sans élément. */
const taux = (valeurs: boolean[]): number | null => moyenne(valeurs.map((v) => (v ? 1 : 0)));

export function calculerMetriques(
  classement: ResultatClassement[],
  recherche: ResultatRechercheBanc[],
  resume: ResultatResumeBanc[],
  mesures: Mesure[],
  totalMs: number
): MetriquesProfil {
  // Une erreur compte comme une réponse fausse : un mode qui échoue n'est pas récompensé.
  const avecAction = classement.filter((c) => c.attendu.action !== undefined);
  const avecUrgence = classement.filter((c) => c.attendu.urgence !== undefined);
  const obtenus = classement.filter((c) => c.obtenu);
  const surs = obtenus.filter((c) => !c.obtenu?.aVerifier);

  const metriquesClassement = {
    evalues: classement.length,
    categorie: taux(classement.map((c) => c.categorieJuste === true)),
    action: taux(avecAction.map((c) => c.actionJuste === true)),
    urgence: taux(avecUrgence.map((c) => c.urgenceJuste === true)),
    aVerifier: taux(obtenus.map((c) => c.obtenu?.aVerifier === true)),
    categorieSiSur: taux(surs.map((c) => c.categorieJuste === true)),
    erreurs: classement.filter((c) => c.erreur).length
  };
  const metriquesRecherche = {
    evaluees: recherche.length,
    mrr: moyenne(recherche.map((r) => (r.rangPertinent ? 1 / r.rangPertinent : 0))),
    enTete: taux(recherche.map((r) => r.rangPertinent === 1)),
    dansTop3: taux(recherche.map((r) => r.rangPertinent !== null && r.rangPertinent <= 3)),
    erreurs: recherche.filter((r) => r.erreur).length
  };
  const metriquesResume = {
    evalues: resume.length,
    couverture: moyenne(resume.map((r) => (r.faitsTotal ? r.faitsTrouves / r.faitsTotal : 0))),
    motsMoyens: moyenne(resume.filter((r) => !r.erreur).map((r) => r.mots)),
    erreurs: resume.filter((r) => r.erreur).length
  };

  const composantes = [
    metriquesClassement.categorie,
    metriquesClassement.action,
    metriquesClassement.urgence,
    metriquesRecherche.mrr,
    metriquesResume.couverture
  ].filter((v): v is number => v !== null);
  const qualite = composantes.length ? Math.round((1000 * composantes.reduce((a, b) => a + b, 0)) / composantes.length) / 10 : null;

  const reussis = <T extends { erreur?: string }>(elements: T[]): T[] => elements.filter((e) => !e.erreur);
  const triageMoyenUsd = moyenne(reussis(classement).map((c) => c.coutUsd));
  const resumeMoyenUsd = moyenne(reussis(resume).map((r) => r.coutUsd));
  const distantes = mesures.filter((m) => m.horsMachine);

  return {
    qualite,
    classement: metriquesClassement,
    recherche: metriquesRecherche,
    resume: metriquesResume,
    temps: {
      totalMs,
      triageMoyenMs: moyenne(reussis(classement).map((c) => c.dureeMs)),
      rechercheMoyenneMs: moyenne(reussis(recherche).map((r) => r.dureeMs)),
      resumeMoyenMs: moyenne(reussis(resume).map((r) => r.dureeMs))
    },
    cout: {
      totalUsd: mesures.reduce((somme, m) => somme + m.coutUsd, 0),
      pour1000DocumentsUsd:
        triageMoyenUsd === null && resumeMoyenUsd === null ? null : 1000 * ((triageMoyenUsd ?? 0) + (resumeMoyenUsd ?? 0))
    },
    confidentialite: {
      appelsHorsMachine: distantes.reduce((somme, m) => somme + m.appels, 0),
      caracteresEnvoyes: distantes.reduce((somme, m) => somme + m.caracteresEnvoyes, 0),
      elementsMasques: distantes.reduce((somme, m) => somme + m.elementsMasques, 0)
    }
  };
}
