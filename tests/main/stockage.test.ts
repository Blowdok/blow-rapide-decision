import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Chiffreur, Stockage } from '../../src/main/stockage';
import { REGLAGES_PAR_DEFAUT } from '../../src/partage/reglages';
import { dossierTemporaire } from '../outils/fabriques';

/** Chiffrement de test, réversible, qui ne laisse pas la clé en clair. */
const chiffreur = (disponible = true): Chiffreur => ({
  disponible: () => disponible,
  chiffrer: (texte) => Buffer.from(`chiffre:${[...texte].reverse().join('')}`),
  dechiffrer: (donnees) => [...donnees.toString().replace(/^chiffre:/, '')].reverse().join('')
});

let dossier: string;
let nettoyer: () => Promise<void>;
beforeEach(async () => {
  ({ chemin: dossier, nettoyer } = await dossierTemporaire());
});
afterEach(async () => nettoyer());

describe('stockage de l’application', () => {
  it('part des réglages par défaut et les conserve d’un lancement à l’autre', () => {
    const stockage = new Stockage(dossier, chiffreur());
    expect(stockage.reglages).toEqual(REGLAGES_PAR_DEFAUT);
    stockage.enregistrerReglages({ profil: 'hybride', ollama: { modeleResume: 'gemma3:12b' } });
    stockage.dernierDossier = '/documents/clients';

    const relu = new Stockage(dossier, chiffreur());
    expect(relu.reglages.profil).toBe('hybride');
    expect(relu.reglages.ollama.modeleResume).toBe('gemma3:12b');
    expect(relu.dernierDossier).toBe('/documents/clients');
  });

  it('chiffre les clés sur le disque et les relit', () => {
    new Stockage(dossier, chiffreur()).definirCle('cleOpenRouter', '  sk-or-secrete  ');
    expect(readFileSync(join(dossier, 'secrets.json'), 'utf8')).not.toContain('sk-or-secrete');
    const relu = new Stockage(dossier, chiffreur());
    expect(relu.secrets).toEqual({ cleOpenRouter: 'sk-or-secrete' });
    relu.definirCle('cleOpenRouter', '');
    expect(new Stockage(dossier, chiffreur()).secrets).toEqual({});
  });

  it('refuse d’enregistrer une clé sans chiffrement du système', () => {
    const stockage = new Stockage(dossier, chiffreur(false));
    expect(stockage.chiffrementDisponible).toBe(false);
    expect(() => stockage.definirCle('cleTypeSafe', 'ts-1')).toThrow(/chiffrement du système est indisponible/);
  });

  it('ignore un fichier de réglages abîmé', () => {
    writeFileSync(join(dossier, 'reglages.json'), '{ abîmé');
    expect(new Stockage(dossier, chiffreur()).reglages).toEqual(REGLAGES_PAR_DEFAUT);
  });
});
