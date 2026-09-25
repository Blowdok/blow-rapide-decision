// Rapport du banc en Markdown, lisible par Blowdok et versionnable.

import type { ResultatBanc } from '../../partage/banc';
import { formaterDuree, formaterNombre, TIRET } from '../../partage/format';
import { celluleClassement, libelleAttente, lignesSynthese, phrasesSansDecision } from '../../partage/synthese';
import { TARIF_JEV_ENTREE_USD_PAR_MILLION } from '../moteurs/jev';

/** Échappe une valeur pour une cellule de tableau Markdown. */
const cellule = (texte: string): string => texte.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

function tableau(entetes: string[], lignes: string[][]): string {
  const ligne = (cellules: string[]): string => `| ${cellules.map(cellule).join(' | ')} |`;
  return [ligne(entetes), `|${entetes.map(() => '---').join('|')}|`, ...lignes.map(ligne)].join('\n');
}

function sectionSynthese(resultat: ResultatBanc): string {
  const { profils } = resultat;
  const lignes = lignesSynthese(profils).map(({ libelle, valeurs, importante }) =>
    importante ? [`**${libelle}**`, ...valeurs.map((v) => (v === TIRET ? v : `**${v}**`))] : [libelle, ...valeurs]
  );
  return ['## Synthèse', tableau(['Critère', ...profils.map((p) => p.libelle)], lignes), ...phrasesSansDecision(resultat)].join(
    '\n\n'
  );
}

function sectionClassement(resultat: ResultatBanc): string {
  const reference = resultat.profils.find((p) => p.classement.length) ?? resultat.profils[0];
  if (!reference?.classement.length) return '';
  const lignes = reference.classement.map((c, i) => [
    c.attendu.document,
    libelleAttente(c),
    ...resultat.profils.map((p) => celluleClassement(p.classement[i]))
  ]);
  return ['## Classement, document par document', tableau(['Document', 'Attendu', ...resultat.profils.map((p) => p.libelle)], lignes)].join('\n\n');
}

function sectionRecherche(resultat: ResultatBanc): string {
  if (!resultat.rechercheLexicale.length) return '';
  const rang = (r: { rangPertinent: number | null; erreur?: string } | undefined): string => {
    if (!r) return TIRET;
    if (r.erreur) return 'erreur';
    return r.rangPertinent === null ? 'absent' : `${r.rangPertinent}`;
  };
  // Colonne de la recherche fusionnée, quand la recherche sémantique (option) a servi.
  const fusionnee = resultat.semantique?.recherche.length ? resultat.semantique.recherche : null;
  const lignes = resultat.rechercheLexicale.map((lexicale, i) => [
    lexicale.requete,
    lexicale.pertinents.join(', '),
    rang(lexicale),
    ...(fusionnee ? [rang(fusionnee[i])] : []),
    ...resultat.profils.map((p) => rang(p.recherche[i]))
  ]);
  const entetes = ['Requête', 'Document attendu', 'Lexical seul', ...(fusionnee ? ['Lexical et sémantique'] : [])];
  return [
    '## Recherche, requête par requête',
    'Rang du premier document pertinent (1 = en tête).',
    tableau([...entetes, ...resultat.profils.map((p) => p.libelle)], lignes)
  ].join('\n\n');
}

function sectionResumes(resultat: ResultatBanc): string {
  const avecResumes = resultat.profils.filter((p) => p.resume.length);
  const premier = avecResumes[0];
  if (!premier) return '';
  const blocs = premier.resume.map((_, i) => {
    const titre = `### ${premier.resume[i]?.document ?? ''}`;
    const parProfil = avecResumes.map((p) => {
      const r = p.resume[i];
      if (!r) return `- **${p.libelle}** : ${TIRET}`;
      if (r.erreur) return `- **${p.libelle}** : erreur : ${r.erreur}`;
      const manque = r.faitsManquants.length ? ` (manque : ${r.faitsManquants.map((f) => `« ${f} »`).join(', ')})` : '';
      const texte = (r.texte ?? '').split('\n').map((l) => `  > ${l}`).join('\n');
      return `- **${p.libelle}** : ${r.faitsTrouves}/${r.faitsTotal} faits${manque}, ${formaterDuree(r.dureeMs)}\n\n${texte}\n`;
    });
    return [titre, ...parProfil].join('\n\n');
  });
  return ['## Résumés', ...blocs].join('\n\n');
}

function sectionMethode(resultat: ResultatBanc): string {
  const tolerance = formaterNombre(resultat.toleranceQualite);
  return [
    '## Méthode',
    [
      '- Chaque mode répond aux mêmes questions, sur les mêmes documents ; seuls les moteurs changent.',
      '- Indice de qualité : moyenne sur 100 de la justesse de la catégorie, de l’action requise et de l’urgence, ' +
        'du rang réciproque moyen de la recherche et de la part des faits attendus présents dans les résumés. ' +
        'Une erreur compte comme une réponse fausse.',
      '- Recherche : l’index propose des passages, puis chaque mode juge leur pertinence. ' +
        (resultat.semantique?.modele
          ? `La recherche sémantique (option, ${resultat.semantique.modele}) complétait BM25 ; les deux classements étaient fusionnés par rang réciproque.`
          : 'L’index était la recherche lexicale BM25.'),
      `- Tolérance : ${tolerance} points. Le mode local est recommandé tant que le mode hybride ne le dépasse pas de plus de ${tolerance} points.`,
      `- Coûts : montants facturés par OpenRouter pendant le banc (Jev : ${formaterNombre(TARIF_JEV_ENTREE_USD_PAR_MILLION, 3)} $ par million de jetons d’entrée, sortie gratuite). ` +
        'L’estimation pour 1 000 documents extrapole le coût moyen d’un triage et d’un résumé. Le mode local ne compte ni l’électricité ni le matériel.',
      '- Confidentialité : caractères réellement envoyés hors de la machine. Le masquage remplace courriels, téléphones, IBAN, cartes bancaires ' +
        'et numéros de sécurité sociale ; il ne détecte ni les noms ni les adresses postales.',
      '- Limites : un petit jeu donne un résultat indicatif ; les faits des résumés sont vérifiés par simple présence du texte attendu.'
    ].join('\n')
  ].join('\n\n');
}

/** Rapport complet du banc, en Markdown. */
export function rapportMarkdown(resultat: ResultatBanc): string {
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(resultat.date));
  const { recommandation } = resultat;
  const entete = [
    `# Rapport de comparaison : ${resultat.jeu.nom}`,
    `${date} · ${resultat.jeu.documents} documents · modes : ${resultat.profils.map((p) => p.libelle).join(', ')}`
  ].join('\n\n');
  const blocRecommandation = [
    '## Recommandation',
    `**${recommandation.titre}**`,
    recommandation.raisons.map((r) => `- ${r}`).join('\n'),
    recommandation.avertissements.map((a) => `> Attention : ${a}`).join('\n>\n')
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    entete,
    blocRecommandation,
    sectionSynthese(resultat),
    sectionClassement(resultat),
    sectionRecherche(resultat),
    sectionResumes(resultat),
    sectionMethode(resultat)
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

/** Nom de base des fichiers de rapport : `comparaison-AAAA-MM-JJ-HHMM`. */
export function nomDuRapport(date: Date): string {
  const deux = (n: number): string => String(n).padStart(2, '0');
  return `comparaison-${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}-${deux(date.getHours())}${deux(date.getMinutes())}`;
}
