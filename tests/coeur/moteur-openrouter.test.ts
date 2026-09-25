import { describe, expect, it } from 'vitest';
import { MoteurRedactionOpenRouter, verifierCleOpenRouter } from '../../src/coeur/moteurs/openrouter';
import { fauxFetch, reponseJson } from '../outils/faux-fetch';

const MESSAGE = { systeme: 'Sois fidèle.', utilisateur: 'Résume ce devis.', source: 'Devis' };

function reponseChat(contenu: string): Response {
  return reponseJson({
    model: 'fournisseur/modele-resolu',
    choices: [{ message: { role: 'assistant', content: contenu }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1200, completion_tokens: 150, total_tokens: 1350, cost: 0.00585 }
  });
}

describe('moteur de rédaction OpenRouter', () => {
  it('refuse par défaut la collecte des données et rapporte le coût réel', async () => {
    const { fetch, appels } = fauxFetch(reponseChat('- Devis de 3 200 € HT'));
    const moteur = new MoteurRedactionOpenRouter({ cle: 'sk-or-test', modele: '~anthropic/claude-sonnet-latest', fetch });
    const { texte, mesure } = await moteur.rediger(MESSAGE, { maxJetons: 400 });

    expect(texte).toBe('- Devis de 3 200 € HT');
    expect(appels[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(appels[0]?.entetes.authorization).toBe('Bearer sk-or-test');
    expect(appels[0]?.corps).toMatchObject({
      model: '~anthropic/claude-sonnet-latest',
      max_tokens: 400,
      messages: [
        { role: 'system', content: 'Sois fidèle.' },
        { role: 'user', content: 'Résume ce devis.' }
      ],
      provider: { data_collection: 'deny' }
    });
    expect((appels[0]?.corps as { provider: object }).provider).not.toHaveProperty('zdr');
    expect(mesure).toMatchObject({
      moteur: 'OpenRouter',
      modele: 'fournisseur/modele-resolu',
      jetonsEntree: 1200,
      jetonsSortie: 150,
      coutUsd: 0.00585,
      horsMachine: true,
      caracteresEnvoyes: MESSAGE.systeme.length + MESSAGE.utilisateur.length
    });
  });

  it('exige la rétention nulle quand on la demande', async () => {
    const { fetch, appels } = fauxFetch(reponseChat('ok'));
    const moteur = new MoteurRedactionOpenRouter({ cle: 'k', modele: 'm', exigerZdr: true, fetch });
    await moteur.rediger(MESSAGE);
    expect(appels[0]?.corps).toMatchObject({ provider: { data_collection: 'deny', zdr: true } });
  });

  it('réessaie après un 429 puis réussit', async () => {
    const { fetch, appels } = fauxFetch(reponseJson({ error: { message: 'Rate limit' } }, 429), reponseChat('ok'));
    const moteur = new MoteurRedactionOpenRouter({ cle: 'k', modele: 'm', pauseMs: 1, fetch });
    expect((await moteur.rediger(MESSAGE)).texte).toBe('ok');
    expect(appels).toHaveLength(2);
  });

  it('explique un crédit épuisé sans réessayer', async () => {
    const { fetch, appels } = fauxFetch(reponseJson({ error: { message: 'Insufficient credits' } }, 402));
    const moteur = new MoteurRedactionOpenRouter({ cle: 'k', modele: 'm', pauseMs: 1, fetch });
    await expect(moteur.rediger(MESSAGE)).rejects.toThrow(/Crédit OpenRouter insuffisant/);
    expect(appels).toHaveLength(1);
  });

  it('signale une erreur du fournisseur en cours de génération', async () => {
    const { fetch } = fauxFetch(
      reponseJson({ choices: [{ message: { content: '' }, finish_reason: 'error', error: { message: 'Provider disconnected' } }] })
    );
    const moteur = new MoteurRedactionOpenRouter({ cle: 'k', modele: 'm', fetch });
    await expect(moteur.rediger(MESSAGE)).rejects.toThrow(/Provider disconnected/);
  });

  it('vérifie une clé sans consommer de crédit', async () => {
    const { fetch, appels } = fauxFetch(reponseJson({ data: { limit_remaining: 74.5, usage_monthly: 25.5 } }));
    expect(await verifierCleOpenRouter('k', fetch)).toEqual({ creditRestant: 74.5, consommationMois: 25.5 });
    expect(appels[0]?.url).toBe('https://openrouter.ai/api/v1/key');
  });
});
