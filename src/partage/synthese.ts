// Mise en forme de la synthèse du banc, commune au rapport Markdown et à
// l'écran de comparaison. Sans dépendance à Node.

import {
  LIBELLES_STATUT,
  type MetriquesProfil,
  type ResultatBanc,
  type ResultatClassement,
  type ResultatProfil,
  type ResultatRechercheBanc
} from './banc';
import { finPhrase, formaterDuree, formaterEntier, formaterNombre, formaterPourcentage, formaterUsd, TIRET } from './format';

export interface LigneSynthese {
  libelle: string;
  valeurs: string[];
  /** Ce que mesure le critère, en langage simple (bulle d'information). */
  aide: string;
  /** Ligne à mettre en avant (indice de qualité). */
  importante?: boolean;
}

interface DefinitionLigne {
  libelle: string;
  aide: string;
  valeur: (m: MetriquesProfil, p: ResultatProfil) => string;
  /** Affichée même pour un mode non terminé. */
  toujours?: boolean;
  importante?: boolean;
}

const LIGNES: DefinitionLigne[] = [
  {
    libelle: 'Statut',
    aide: 'Terminé ; interrompu après trop d’échecs d’affilée ; ou indisponible, faute de clé ou de serveur.',
    valeur: (_m, p) => LIBELLES_STATUT[p.statut],
    toujours: true
  },
  {
    libelle: 'Moteur de décision',
    aide: 'Ce qui classe les documents et juge si un passage répond à la question.',
    valeur: (_m, p) => p.moteurs.decision,
    toujours: true
  },
  { libelle: 'Moteur de rédaction', aide: 'Ce qui écrit les résumés.', valeur: (_m, p) => p.moteurs.redaction, toujours: true },
  {
    libelle: 'Indice de qualité',
    aide: 'Note sur 100 : moyenne de la justesse du classement, de la recherche et des résumés. Une erreur compte comme une réponse fausse.',
    valeur: (m) => (m.qualite === null ? TIRET : `${formaterNombre(m.qualite)}/100`),
    importante: true
  },
  {
    libelle: 'Catégorie juste',
    aide: 'Part des documents rangés dans la bonne catégorie.',
    valeur: (m) => formaterPourcentage(m.classement.categorie)
  },
  {
    libelle: 'Action requise juste',
    aide: 'Part des documents pour lesquels l’agent a bien vu s’il faut agir (payer, répondre, signer).',
    valeur: (m) => formaterPourcentage(m.classement.action)
  },
  {
    libelle: 'Urgence juste',
    aide: 'Part des documents dont l’urgence (aucune, bientôt, urgente) est la bonne.',
    valeur: (m) => formaterPourcentage(m.classement.urgence)
  },
  {
    libelle: 'Documents « à vérifier »',
    aide: 'Part des documents où l’agent hésite : moins il y en a, moins vous avez à relire.',
    valeur: (m) => formaterPourcentage(m.classement.aVerifier)
  },
  {
    libelle: 'Catégorie juste quand l’agent est sûr',
    aide: 'Justesse sur les seuls documents qui ne sont pas « à vérifier » : on peut s’y fier sans relire.',
    valeur: (m) => formaterPourcentage(m.classement.categorieSiSur)
  },
  {
    libelle: 'Recherche : pertinent en tête',
    aide: 'Part des questions dont le bon document arrive en premier.',
    valeur: (m) => formaterPourcentage(m.recherche.enTete)
  },
  {
    libelle: 'Recherche : pertinent dans les 3 premiers',
    aide: 'Part des questions dont le bon document est parmi les trois premiers résultats.',
    valeur: (m) => formaterPourcentage(m.recherche.dansTop3)
  },
  {
    libelle: 'Recherche : rang réciproque moyen',
    aide: 'Entre 0 et 1 : 1 si le bon document arrive toujours en premier, 0,5 s’il est deuxième, 0 s’il n’est pas trouvé.',
    valeur: (m) => formaterNombre(m.recherche.mrr, 2)
  },
  {
    libelle: 'Résumés : faits couverts',
    aide: 'Part des faits importants attendus (montants, dates, noms) présents dans les résumés.',
    valeur: (m) => formaterPourcentage(m.resume.couverture)
  },
  {
    libelle: 'Résumés : longueur moyenne',
    aide: 'Nombre moyen de mots d’un résumé.',
    valeur: (m) => (m.resume.motsMoyens === null ? TIRET : `${formaterEntier(m.resume.motsMoyens)} mots`)
  },
  { libelle: 'Temps total du banc', aide: 'Durée de tout l’examen pour ce mode.', valeur: (m) => formaterDuree(m.temps.totalMs) },
  { libelle: 'Temps moyen d’un triage', aide: 'Durée moyenne pour classer un document.', valeur: (m) => formaterDuree(m.temps.triageMoyenMs) },
  {
    libelle: 'Temps moyen d’une recherche',
    aide: 'Durée moyenne pour répondre à une question.',
    valeur: (m) => formaterDuree(m.temps.rechercheMoyenneMs)
  },
  { libelle: 'Temps moyen d’un résumé', aide: 'Durée moyenne pour résumer un document.', valeur: (m) => formaterDuree(m.temps.resumeMoyenMs) },
  {
    libelle: 'Coût du banc',
    aide: 'Montant facturé par OpenRouter pendant l’examen ; 0 $ en local.',
    valeur: (m) => formaterUsd(m.cout.totalUsd)
  },
  {
    libelle: 'Coût estimé pour 1 000 documents',
    aide: 'Coût probable pour classer et résumer 1 000 documents, d’après l’examen.',
    valeur: (m) => formaterUsd(m.cout.pour1000DocumentsUsd)
  },
  {
    libelle: 'Appels hors de la machine',
    aide: 'Nombre d’envois sur Internet pendant l’examen.',
    valeur: (m) => formaterEntier(m.confidentialite.appelsHorsMachine)
  },
  {
    libelle: 'Caractères envoyés hors de la machine',
    aide: 'Quantité de texte partie sur Internet pendant l’examen.',
    valeur: (m) => formaterEntier(m.confidentialite.caracteresEnvoyes)
  },
  {
    libelle: 'Données personnelles masquées',
    aide: 'Courriels, téléphones, IBAN, cartes et numéros de sécurité sociale remplacés avant l’envoi.',
    valeur: (m) => formaterEntier(m.confidentialite.elementsMasques)
  },
  {
    libelle: 'Éléments en erreur',
    aide: 'Questions de l’examen restées sans réponse : panne, clé refusée, délai dépassé…',
    valeur: (m) => formaterEntier(m.classement.erreurs + m.recherche.erreurs + m.resume.erreurs),
    toujours: true
  }
];

/** Lignes du tableau de synthèse, une valeur par profil ; « – » pour un mode non terminé. */
export function lignesSynthese(profils: readonly ResultatProfil[]): LigneSynthese[] {
  return LIGNES.map(({ libelle, aide, valeur, toujours, importante }) => ({
    libelle,
    aide,
    valeurs: profils.map((p) => (p.statut === 'termine' || toujours ? valeur(p.metriques, p) : TIRET)),
    ...(importante ? { importante } : {})
  }));
}

/** Performance d'un classement sans décision ; une erreur compte comme un document absent. */
export function syntheseClassement(recherches: readonly ResultatRechercheBanc[]): { enTete: number | null; mrr: number | null } {
  if (!recherches.length) return { enTete: null, mrr: null };
  return {
    enTete: recherches.filter((r) => r.rangPertinent === 1).length / recherches.length,
    mrr: recherches.reduce((s, r) => s + (r.rangPertinent ? 1 / r.rangPertinent : 0), 0) / recherches.length
  };
}

/** Performance de la recherche lexicale seule, commune à tous les modes. */
export function syntheseRechercheLexicale(resultat: ResultatBanc): { enTete: number | null; mrr: number | null } {
  return syntheseClassement(resultat.rechercheLexicale);
}

/**
 * Phrases sur les classements sans décision, communes à tous les modes :
 * BM25 seul, et BM25 fusionné avec la recherche sémantique quand l'option est active.
 */
export function phrasesSansDecision(resultat: ResultatBanc): string[] {
  const performance = (s: { enTete: number | null; mrr: number | null }): string =>
    `pertinent en tête ${formaterPourcentage(s.enTete)}, rang réciproque moyen ${formaterNombre(s.mrr, 2)}`;
  const phrases = [`Recherche lexicale seule (BM25), sans décision : ${performance(syntheseRechercheLexicale(resultat))}.`];
  const { semantique } = resultat;
  if (semantique?.modele) {
    phrases.push(
      `Recherche lexicale et sémantique fusionnées (${semantique.modele}), sans décision : ${performance(syntheseClassement(semantique.recherche))}. ` +
        'Les modes ont jugé ces passages fusionnés.'
    );
  } else if (semantique) {
    phrases.push(
      `Recherche sémantique demandée mais indisponible : ${finPhrase(semantique.avis ?? 'raison inconnue')} ` +
        'Les modes ont jugé les passages de la seule recherche lexicale.'
    );
  }
  return phrases;
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
