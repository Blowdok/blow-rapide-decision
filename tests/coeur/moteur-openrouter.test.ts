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
    const moteur = new MoteurRedactionOpenRouter({ cle: 'sk-or-test', modele: 'qwen/qwen3.8-flash', fetch });
    const { texte, mesure } = await moteur.rediger(MESSAGE, { maxJetons: 400 });

    expect(texte).toBe('- Devis de 3 200 € HT');
    expect(appels[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(appels[0]?.entetes.authorization).toBe('Bearer sk-or-test');
    expect(appels[0]?.corps).toMatchObject({
      model: 'qwen/qwen3.8-flash',
      max_tokens: 400,
      reasoning: { enabled: false },
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

  it('garde le raisonnement au minimum quand le modèle l’impose', async () => {
    const { fetch, appels } = fauxFetch(
      reponseJson({ error: { message: 'Reasoning is mandatory for this endpoint and cannot be disabled.' } }, 400),
      reponseChat('- Premier résumé'),
      reponseChat('- Second résumé')
    );
    // Modèle propre à ce test : le refus est retenu pour tout le processus.
    const modele = 'fournisseur/modele-a-raisonnement';
    const premier = await new MoteurRedactionOpenRouter({ cle: 'k', modele, fetch }).rediger(MESSAGE);

    expect(premier.texte).toBe('- Premier résumé');
    expect(appels[1]?.corps).toMatchObject({ max_tokens: 800 + 4000, reasoning: { effort: 'low', exclude: true } });
    // Le refus a aussi fait partir le texte : les deux envois sont comptés.
    expect(premier.mesure.appels).toBe(2);
    expect(premier.mesure.caracteresEnvoyes).toBe(2 * (MESSAGE.systeme.length + MESSAGE.utilisateur.length));

    // Même avec un nouveau moteur, les appels suivants passent directement avec le raisonnement minimal.
    const second = await new MoteurRedactionOpenRouter({ cle: 'k', modele, fetch }).rediger(MESSAGE);
    expect(second.mesure.appels).toBe(1);
    expect(appels).toHaveLength(3);
    expect(appels[2]?.corps).toMatchObject({ reasoning: { effort: 'low', exclude: true } });
  });

  it('explique un résumé vide faute de jetons', async () => {
    const { fetch } = fauxFetch(
      reponseJson({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }], usage: { cost: 0.0004 } })
    );
    const moteur = new MoteurRedactionOpenRouter({ cle: 'k', modele: 'qwen/qwen3.8-flash', fetch });
    await expect(moteur.rediger(MESSAGE)).rejects.toThrow(/a atteint sa limite de jetons avant d’écrire le résumé/);
  });

  it('explique quel réglage de confidentialité bloque le seul fournisseur du modèle', async () => {
    const refus = () =>
      reponseJson({ error: { message: 'No endpoints found matching your data policy (Paid model training).' } }, 404);
    const filtre = new MoteurRedactionOpenRouter({ cle: 'k', modele: 'qwen/qwen3.8-flash', fetch: fauxFetch(refus()).fetch });
    await expect(filtre.rediger(MESSAGE)).rejects.toThrow(/Aucun fournisseur de ce modèle ne respecte vos exigences de confidentialité/);

    const sansFiltre = new MoteurRedactionOpenRouter({
      cle: 'k',
      modele: 'qwen/qwen3.8-flash',
      refuserCollecte: false,
      fetch: fauxFetch(refus()).fetch
    });
    await expect(sansFiltre.rediger(MESSAGE)).rejects.toThrow(/Modèle ou fournisseur introuvable sur OpenRouter \(404\)/);
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
