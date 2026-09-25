// Mise en forme de la synthèse du banc, commune au rapport Markdown et à
// l'écran de comparaison. Sans dépendance à Node.

import { LIBELLES_STATUT, type MetriquesProfil, type ResultatBanc, type ResultatClassement, type ResultatProfil } from './banc';
import { formaterDuree, formaterEntier, formaterNombre, formaterPourcentage, formaterUsd, TIRET } from './format';

export interface LigneSynthese {
  libelle: string;
  valeurs: string[];
  /** Ligne à mettre en avant (indice de qualité). */
  importante?: boolean;
}

interface DefinitionLigne {
  libelle: string;
  valeur: (m: MetriquesProfil, p: ResultatProfil) => string;
  /** Affichée même pour un mode non terminé. */
  toujours?: boolean;
  importante?: boolean;
}

const LIGNES: DefinitionLigne[] = [
  { libelle: 'Statut', valeur: (_m, p) => LIBELLES_STATUT[p.statut], toujours: true },
  { libelle: 'Moteur de décision', valeur: (_m, p) => p.moteurs.decision, toujours: true },
  { libelle: 'Moteur de rédaction', valeur: (_m, p) => p.moteurs.redaction, toujours: true },
  {
    libelle: 'Indice de qualité',
    valeur: (m) => (m.qualite === null ? TIRET : `${formaterNombre(m.qualite)}/100`),
    importante: true
  },
  { libelle: 'Catégorie juste', valeur: (m) => formaterPourcentage(m.classement.categorie) },
  { libelle: 'Action requise juste', valeur: (m) => formaterPourcentage(m.classement.action) },
  { libelle: 'Urgence juste', valeur: (m) => formaterPourcentage(m.classement.urgence) },
  { libelle: 'Documents « à vérifier »', valeur: (m) => formaterPourcentage(m.classement.aVerifier) },
  { libelle: 'Catégorie juste quand l’agent est sûr', valeur: (m) => formaterPourcentage(m.classement.categorieSiSur) },
  { libelle: 'Recherche : pertinent en tête', valeur: (m) => formaterPourcentage(m.recherche.enTete) },
  { libelle: 'Recherche : pertinent dans les 3 premiers', valeur: (m) => formaterPourcentage(m.recherche.dansTop3) },
  { libelle: 'Recherche : rang réciproque moyen', valeur: (m) => formaterNombre(m.recherche.mrr, 2) },
  { libelle: 'Résumés : faits couverts', valeur: (m) => formaterPourcentage(m.resume.couverture) },
  {
    libelle: 'Résumés : longueur moyenne',
    valeur: (m) => (m.resume.motsMoyens === null ? TIRET : `${formaterEntier(m.resume.motsMoyens)} mots`)
  },
  { libelle: 'Temps total du banc', valeur: (m) => formaterDuree(m.temps.totalMs) },
  { libelle: 'Temps moyen d’un triage', valeur: (m) => formaterDuree(m.temps.triageMoyenMs) },
  { libelle: 'Temps moyen d’une recherche', valeur: (m) => formaterDuree(m.temps.rechercheMoyenneMs) },
  { libelle: 'Temps moyen d’un résumé', valeur: (m) => formaterDuree(m.temps.resumeMoyenMs) },
  { libelle: 'Coût du banc', valeur: (m) => formaterUsd(m.cout.totalUsd) },
  { libelle: 'Coût estimé pour 1 000 documents', valeur: (m) => formaterUsd(m.cout.pour1000DocumentsUsd) },
  { libelle: 'Appels hors de la machine', valeur: (m) => formaterEntier(m.confidentialite.appelsHorsMachine) },
  { libelle: 'Caractères envoyés hors de la machine', valeur: (m) => formaterEntier(m.confidentialite.caracteresEnvoyes) },
  { libelle: 'Données personnelles masquées', valeur: (m) => formaterEntier(m.confidentialite.elementsMasques) },
  {
    libelle: 'Éléments en erreur',
    valeur: (m) => formaterEntier(m.classement.erreurs + m.recherche.erreurs + m.resume.erreurs),
    toujours: true
  }
];

/** Lignes du tableau de synthèse, une valeur par profil ; « – » pour un mode non terminé. */
export function lignesSynthese(profils: readonly ResultatProfil[]): LigneSynthese[] {
  return LIGNES.map(({ libelle, valeur, toujours, importante }) => ({
    libelle,
    valeurs: profils.map((p) => (p.statut === 'termine' || toujours ? valeur(p.metriques, p) : TIRET)),
    ...(importante ? { importante } : {})
  }));
}

/** Performance de la recherche lexicale seule, commune à tous les modes. */
export function syntheseRechercheLexicale(resultat: ResultatBanc): { enTete: number | null; mrr: number | null } {
  const lexicale = resultat.rechercheLexicale;
  if (!lexicale.length) return { enTete: null, mrr: null };
  return {
    enTete: lexicale.filter((r) => r.rangPertinent === 1).length / lexicale.length,
    mrr: lexicale.reduce((s, r) => s + (r.rangPertinent ? 1 / r.rangPertinent : 0), 0) / lexicale.length
  };
}

const marque = (juste: boolean | undefined): string => (juste === undefined ? '' : juste ? ' ✓' : ' ✗');

/** Résumé d'un triage évalué : « facture 92 % ✓ · action ✓ · urgence 1,1 ✓ ». */
export function celluleClassement(resultat: ResultatClassement | undefined): string {
  if (!resultat) return TIRET;
  if (resultat.erreur || !resultat.obtenu) return `erreur : ${resultat.erreur ?? 'inconnue'}`;
  const { obtenu } = resultat;
  const morceaux = [`${obtenu.categorie} ${formaterPourcentage(obtenu.confiance)}${marque(resultat.categorieJuste)}`];
  if (resultat.actionJuste !== undefined) {
    morceaux.push(`${obtenu.probabiliteAction >= 0.5 ? 'action' : 'sans action'}${marque(resultat.actionJuste)}`);
  }
  if (resultat.urgenceJuste !== undefined) {
    morceaux.push(`urgence ${formaterNombre(obtenu.urgence)}${marque(resultat.urgenceJuste)}`);
  }
  if (obtenu.aVerifier) morceaux.push('à vérifier');
  return morceaux.join(' · ');
}

/** Attente d'un document : « facture · action · urgence 1 ». */
export function libelleAttente(resultat: ResultatClassement): string {
  const { attendu } = resultat;
  return [
    attendu.categorie,
    attendu.action === undefined ? '' : attendu.action ? 'action' : 'sans action',
    attendu.urgence === undefined ? '' : `urgence ${attendu.urgence}`
  ]
    .filter(Boolean)
    .join(' · ');
}
