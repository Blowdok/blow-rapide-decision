// Découpage d'un texte en passages de taille bornée, unités de la recherche
// et des résumés par parties.

/** Nettoie un texte extrait : fins de ligne, espaces insécables, lignes vides. */
export function nettoyerTexte(texte: string): string {
  return texte
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[  ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Coupe un bloc trop long sur les fins de phrase, puis sur les espaces. */
function couperBloc(bloc: string, tailleMax: number): string[] {
  if (bloc.length <= tailleMax) return [bloc];
  const morceaux: string[] = [];
  for (const phrase of bloc.split(/(?<=[.!?…])\s+/)) {
    if (phrase.length <= tailleMax) {
      morceaux.push(phrase);
      continue;
    }
    // Phrase démesurée (tableau, liste sans ponctuation) : coupe aux espaces.
    let reste = phrase;
    while (reste.length > tailleMax) {
      const espace = reste.lastIndexOf(' ', tailleMax);
      const coupe = espace > tailleMax / 2 ? espace : tailleMax;
      morceaux.push(reste.slice(0, coupe).trim());
      reste = reste.slice(coupe).trim();
    }
    if (reste) morceaux.push(reste);
  }
  return morceaux;
}

/**
 * Regroupe paragraphes et phrases en passages d'au plus `tailleMax`
 * caractères, sans couper un paragraphe qui tient dans la limite.
 */
export function decouperEnPassages(texte: string, tailleMax = 1000): string[] {
  const unites = nettoyerTexte(texte)
    .split(/\n\s*\n/)
    .map((bloc) => bloc.trim())
    .filter(Boolean)
    .flatMap((bloc) => couperBloc(bloc, tailleMax));

  const passages: string[] = [];
  let courant = '';
  for (const unite of unites) {
    if (!courant) {
      courant = unite;
    } else if (courant.length + 1 + unite.length <= tailleMax) {
      courant = `${courant}\n${unite}`;
    } else {
      passages.push(courant);
      courant = unite;
    }
  }
  if (courant) passages.push(courant);
  return passages;
}
