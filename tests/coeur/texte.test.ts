import { describe, expect, it } from 'vitest';
import { decouperEnPassages, nettoyerTexte } from '../../src/coeur/texte/decoupage';
import { pourComparaison, raciner, sansAccents, termes } from '../../src/coeur/texte/normalisation';

describe('normalisation du français', () => {
  it('retire accents et ligatures', () => {
    expect(sansAccents('Œuvre, éléphant, garçon, cœur')).toBe('OEuvre, elephant, garcon, coeur');
  });

  it('ramène pluriels et féminins à une racine commune', () => {
    expect(raciner('factures')).toBe(raciner('facture'));
    expect(raciner('facturer')).toBe(raciner('facture'));
    expect(raciner('contrats')).toBe('contrat');
    expect(raciner('chevaux')).toBe('cheval');
    // Les mots courts ne sont pas touchés.
    expect(raciner('devis')).toBe('devis');
  });

  it('écarte mots vides et élisions', () => {
    expect(termes("Les factures d’électricité de l'entreprise")).toEqual(['factur', 'electricit', 'entrepris']);
    expect(termes("L'électricité")).toEqual(termes('électricité'));
  });

  it('garde les nombres entiers tels quels', () => {
    expect(termes('Échéance 2026 : 1250 euros')).toContain('2026');
    expect(termes('Échéance 2026 : 1250 euros')).toContain('1250');
  });

  it('prépare une forme comparable pour les faits attendus', () => {
    expect(pourComparaison('Montant : 1 250,00 €')).toBe('montant : 1250,00 €');
    expect(pourComparaison('Échéance le  15 Octobre')).toBe('echeance le 15 octobre');
    expect(pourComparaison('1 250 000')).toBe('1250000');
  });
});

describe('découpage en passages', () => {
  it('nettoie fins de ligne, espaces et lignes vides', () => {
    expect(nettoyerTexte('﻿a\r\n\r\n\r\n\r\nb  c  ')).toBe('a\n\nb c');
  });

  it('regroupe les petits paragraphes sans dépasser la taille', () => {
    const passages = decouperEnPassages('Un.\n\nDeux.\n\nTrois.', 12);
    expect(passages).toEqual(['Un.\nDeux.', 'Trois.']);
  });

  it('coupe un paragraphe trop long sur les phrases puis les espaces', () => {
    const phrase = 'Phrase courte. ';
    const long = `${phrase.repeat(10)}${'mot '.repeat(60)}`;
    const passages = decouperEnPassages(long, 80);
    expect(passages.length).toBeGreaterThan(3);
    for (const passage of passages) expect(passage.length).toBeLessThanOrEqual(80);
    expect(passages.join(' ').replace(/\s+/g, ' ')).toBe(long.trim().replace(/\s+/g, ' '));
  });

  it('renvoie une liste vide pour un texte vide', () => {
    expect(decouperEnPassages('   \n\n  ')).toEqual([]);
  });
});
