import { describe, expect, it } from 'vitest';
import { configurationDepuisEnvironnement } from '../../src/coeur/configuration';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT } from '../../src/partage/reglages';

describe('réglages', () => {
  it('fusionne un réglage partiel sans perdre le reste de la section', () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { ollama: { modeleResume: 'gemma3:12b' } });
    expect(reglages.ollama).toEqual({ ...REGLAGES_PAR_DEFAUT.ollama, modeleResume: 'gemma3:12b' });
    expect(reglages.openrouter).toEqual(REGLAGES_PAR_DEFAUT.openrouter);
  });

  it('borne les valeurs hors limites et ignore un profil inconnu', () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, {
      profil: 'cloud-total' as never,
      classement: { seuilConfiance: 3 },
      recherche: { candidats: 5, resultats: 40 }
    });
    expect(reglages.profil).toBe('local');
    expect(reglages.classement.seuilConfiance).toBe(1);
    expect(reglages.recherche.resultats).toBe(5);
  });

  it('lit la configuration de la ligne de commande dans l’environnement', () => {
    const { reglages, secrets } = configurationDepuisEnvironnement({
      OLLAMA_URL: 'http://localhost:11500',
      BRD_OLLAMA_MODELE_DECISION: 'gemma3:4b',
      BRD_JEV_ACCES: 'typesafe',
      BRD_MASQUAGE: '0',
      OPENROUTER_API_KEY: ' sk-or-1 ',
      TYPESAFE_API_KEY: ''
    });
    expect(reglages.ollama.url).toBe('http://localhost:11500');
    expect(reglages.ollama.modeleDecision).toBe('gemma3:4b');
    expect(reglages.ollama.modeleResume).toBe(REGLAGES_PAR_DEFAUT.ollama.modeleResume);
    expect(reglages.jev.acces).toBe('typesafe');
    expect(reglages.confidentialite.masquage).toBe(false);
    expect(secrets).toEqual({ cleOpenRouter: 'sk-or-1' });
  });

  it('garde les valeurs par défaut sans variable d’environnement', () => {
    expect(configurationDepuisEnvironnement({}).reglages).toEqual(REGLAGES_PAR_DEFAUT);
  });
});

describe('réglages abîmés', () => {
  it('garde la valeur de base pour un champ numérique vide ou invalide', () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, {
      ollama: { contexte: Number.NaN },
      classement: { seuilConfiance: null as never }
    });
    expect(reglages.ollama.contexte).toBe(REGLAGES_PAR_DEFAUT.ollama.contexte);
    expect(reglages.classement.seuilConfiance).toBe(REGLAGES_PAR_DEFAUT.classement.seuilConfiance);
  });
});

describe('thème', () => {
  it('suit le système par défaut et refuse un thème inconnu', () => {
    expect(REGLAGES_PAR_DEFAUT.apparence.theme).toBe('systeme');
    expect(fusionnerReglages(REGLAGES_PAR_DEFAUT, { apparence: { theme: 'sombre' } }).apparence.theme).toBe('sombre');
    expect(fusionnerReglages(REGLAGES_PAR_DEFAUT, { apparence: { theme: 'fluo' as never } }).apparence.theme).toBe('systeme');
  });
});

describe('options facultatives', () => {
  it('sont désactivées par défaut, avec les modèles installés chez Blowdok', () => {
    expect(REGLAGES_PAR_DEFAUT.semantique).toEqual({ active: false, modele: 'embeddinggemma' });
    expect(REGLAGES_PAR_DEFAUT.ocr).toEqual({ active: false, modele: 'minicpm-v4.6:1b', pagesMax: 10 });
  });

  it('valident leurs valeurs', () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, {
      semantique: { active: 'oui' as never, modele: '  nomic-embed-text-v2-moe  ' },
      ocr: { active: true, modele: '   ', pagesMax: 1000 }
    });
    expect(reglages.semantique).toEqual({ active: false, modele: 'nomic-embed-text-v2-moe' });
    expect(reglages.ocr).toEqual({ active: true, modele: 'minicpm-v4.6:1b', pagesMax: 200 });
  });

  it('se règlent aussi par l’environnement pour la ligne de commande', () => {
    const { reglages } = configurationDepuisEnvironnement({
      BRD_SEMANTIQUE: '1',
      BRD_OLLAMA_MODELE_PLONGEMENT: 'nomic-embed-text-v2-moe',
      BRD_OCR: 'oui',
      BRD_OCR_PAGES_MAX: 'beaucoup'
    });
    expect(reglages.semantique).toEqual({ active: true, modele: 'nomic-embed-text-v2-moe' });
    expect(reglages.ocr).toEqual({ active: true, modele: 'minicpm-v4.6:1b', pagesMax: 10 });
  });
});
