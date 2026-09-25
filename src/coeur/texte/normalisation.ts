// Normalisation du français pour la recherche lexicale : minuscules, accents
// retirés, élisions supprimées, mots vides écartés, racinisation légère.

/** Retire accents et ligatures : « Œuvre éléphant » → « OEuvre elephant ». */
export function sansAccents(texte: string): string {
  return texte
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

// Mots vides du français, déjà sans accents.
const MOTS_VIDES = new Set(
  `a ai aie aient aies ait alors as au aucun aucune aupres auquel aura aurai auraient aurais aurait auras aurez
  auriez aurions aurons auront aussi autre autres aux auxquelles auxquels avaient avais avait avant avec avez
  aviez avions avoir avons ayant ayez ayons c ca car ce ceci cela celle celles celui cependant ces cet cette ceux
  chacun chacune chaque chez ci comme comment d dans de depuis des desquelles desquels dessous dessus donc dont du
  duquel durant elle elles en encore entre es est et etaient etais etait etant ete etes etiez etions etre eu eue
  eues eurent eus eusse eussent eusses eussiez eussions eut eux fait faites fois furent fus fusse fussent fusses
  fussiez fussions fut ici il ils j je jusqu jusque l la laquelle le lequel les lesquelles lesquels leur leurs lors
  lorsqu lorsque lui m ma mais me meme memes mes moi moins mon n ne ni nos notre nous on ont or ou par parce pas
  pendant peu peut plus pour pourquoi puis puisqu puisque qu quand que quel quelle quelles quels qui quoi s sa sans
  se sera serai seraient serais serait seras serez seriez serions serons seront ses si sien sienne soi soient sois
  soit sommes son sont sous soyez soyons suis sur t ta tandis te tes toi ton tous tout toute toutes tres tu un une
  unes uns vers voici voila vos votre vous y`.split(/\s+/)
);

// Élisions : « l'entreprise », « qu’il », « jusqu'au »…
const ELISIONS = /\b(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu|quoiqu)['’]/g;

/**
 * Racinisation minimale du français (méthode de J. Savoy) : ôte les marques
 * de pluriel et de féminin les plus courantes sans toucher aux mots courts.
 * Attend un mot déjà en minuscules et sans accents.
 */
export function raciner(mot: string): string {
  if (mot.length < 6) return mot;
  if (mot.endsWith('x')) {
    // « chevaux » → « cheval », « impots » reste traité par la règle du s.
    return mot.endsWith('aux') ? `${mot.slice(0, -3)}al` : mot.slice(0, -1);
  }
  let fin = mot.length;
  if (mot[fin - 1] === 's') fin--;
  if (mot[fin - 1] === 'r') fin--;
  if (mot[fin - 1] === 'e') fin--;
  // Deuxième « e » : couvre l'ancien « é » final (« créée », « employée »).
  if (mot[fin - 1] === 'e') fin--;
  if (fin >= 2 && mot[fin - 1] === mot[fin - 2] && /[a-z]/.test(mot[fin - 1] ?? '')) fin--;
  return mot.slice(0, fin);
}

/**
 * Découpe un texte en termes de recherche normalisés.
 * « Les factures d’électricité » → ["factur", "electricite"].
 */
export function termes(texte: string): string[] {
  const minuscules = sansAccents(texte.toLowerCase()).replace(ELISIONS, ' ');
  const resultat: string[] = [];
  for (const brut of minuscules.split(/[^a-z0-9]+/)) {
    if (brut.length < 2 || MOTS_VIDES.has(brut)) continue;
    resultat.push(/^\d+$/.test(brut) ? brut : raciner(brut));
  }
  return resultat;
}

/**
 * Forme canonique pour comparer des expressions (faits attendus d'un résumé) :
 * minuscules, sans accents, espaces uniques, espaces des nombres retirées
 * (« 1 250,00 € » → « 1250,00 € »).
 */
export function pourComparaison(texte: string): string {
  return sansAccents(texte.toLowerCase())
    .replace(/[  ]/g, ' ')
    .replace(/(\d)[ .](?=\d{3}\b)/g, '$1')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
