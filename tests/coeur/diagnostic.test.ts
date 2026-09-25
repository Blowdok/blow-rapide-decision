import { describe, expect, it } from 'vitest';
import { diagnostiquer } from '../../src/coeur/diagnostic';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT } from '../../src/partage/reglages';
import { type AppelEnregistre, fauxFetch, reponseJson } from '../outils/faux-fetch';

/** Services simulés, choisis selon l'adresse appelée. */
function services(options: { ollama?: string[] | 'eteint'; cle?: 'valide' | 'refusee'; jev?: string[] }) {
  return fauxFetch((appel: AppelEnregistre) => {
    if (appel.url.endsWith('/api/tags')) {
      if (options.ollama === 'eteint') throw new TypeError('fetch failed');
      return reponseJson({ models: (options.ollama ?? []).map((name) => ({ name })) });
    }
    if (appel.url === 'https://openrouter.ai/api/v1/key') {
      return options.cle === 'refusee'
        ? reponseJson({ error: { message: 'User not found' } }, 401)
        : reponseJson({ data: { limit_remaining: null, usage_monthly: 1.5 } });
    }
    if (appel.url === 'https://api.typesafe.ai/v1/models') {
      return reponseJson({ models: (options.jev ?? []).map((name) => ({ name, description: '', release_date: '' })) });
    }
    throw new Error(`Adresse inattendue : ${appel.url}`);
  });
}

describe('diagnostic', () => {
  it('confirme un poste prêt pour les deux modes', async () => {
    const { fetch } = services({ ollama: ['qwen3.5:4b', 'gemma3:4b'], cle: 'valide' });
    const etats = await diagnostiquer(REGLAGES_PAR_DEFAUT, { cleOpenRouter: 'k' }, fetch);
    expect(etats.map((e) => [e.service, e.ok])).toEqual([
      ['Ollama', true],
      ['OpenRouter', true],
      ['Jev', true]
    ]);
    expect(etats[1]?.detail).toBe('Clé valide, sans limite de crédit, 1,50 $ consommés ce mois-ci.');
  });

  it('indique la commande pour installer un modèle manquant', async () => {
    const { fetch } = services({ ollama: ['gemma3:4b'] });
    const [ollama] = await diagnostiquer(REGLAGES_PAR_DEFAUT, {}, fetch);
    expect(ollama).toEqual({ service: 'Ollama', ok: false, detail: 'Modèle absent : lancez « ollama pull qwen3.5:4b ».' });
  });

  it('accepte un modèle installé sous l’étiquette « latest »', async () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { ollama: { modeleDecision: 'mistral', modeleResume: 'mistral' } });
    const { fetch } = services({ ollama: ['mistral:latest'] });
    const [ollama] = await diagnostiquer(reglages, {}, fetch);
    expect(ollama?.ok).toBe(true);
  });

  it('signale Ollama éteint, clé absente et Jev bloqué', async () => {
    const { fetch } = services({ ollama: 'eteint' });
    const etats = await diagnostiquer(REGLAGES_PAR_DEFAUT, {}, fetch);
    expect(etats[0]?.detail).toMatch(/injoignable/);
    expect(etats[1]?.detail).toBe('Clé absente : le mode hybride est indisponible.');
    expect(etats[2]).toMatchObject({ ok: false, detail: expect.stringMatching(/corrigez d’abord la clé OpenRouter/) });
  });

  it('vérifie l’accès direct à Jev chez TypeSafe', async () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { jev: { acces: 'typesafe' } });
    const { fetch } = services({ ollama: ['qwen3.5:4b'], cle: 'refusee', jev: ['jev-1.13'] });
    const etats = await diagnostiquer(reglages, { cleOpenRouter: 'k', cleTypeSafe: 't' }, fetch);
    expect(etats[1]).toMatchObject({ ok: false, detail: expect.stringMatching(/401/) });
    expect(etats[2]).toEqual({ service: 'Jev', ok: true, detail: 'Accès direct TypeSafe valide, modèles : jev-1.13.' });
  });
});

describe('diagnostic des options facultatives', () => {
  const options = fusionnerReglages(REGLAGES_PAR_DEFAUT, { semantique: { active: true }, ocr: { active: true } });

  it('vérifie les modèles des options actives', async () => {
    const { fetch } = services({ ollama: ['qwen3.5:4b', 'embeddinggemma:latest', 'minicpm-v4.6:1b'] });
    const [ollama] = await diagnostiquer(options, {}, fetch);
    expect(ollama).toEqual({
      service: 'Ollama',
      ok: true,
      detail: 'Joignable, 3 modèle(s) installé(s), dont qwen3.5:4b, embeddinggemma et minicpm-v4.6:1b.'
    });
  });

  it('dit à quoi sert un modèle d’option absent', async () => {
    const { fetch } = services({ ollama: ['qwen3.5:4b'] });
    const [ollama] = await diagnostiquer(options, {}, fetch);
    expect(ollama?.detail).toBe(
      'Modèle absent : lancez « ollama pull embeddinggemma » (recherche sémantique), ' +
        'lancez « ollama pull minicpm-v4.6:1b » (lecture des PDF scannés).'
    );
  });

  it('ignore les modèles des options désactivées', async () => {
    const { fetch } = services({ ollama: ['qwen3.5:4b'] });
    const [ollama] = await diagnostiquer(REGLAGES_PAR_DEFAUT, {}, fetch);
    expect(ollama?.ok).toBe(true);
  });
});
