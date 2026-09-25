import { describe, expect, it } from 'vitest';
import {
  distributionDepuisLogprobs,
  estAdresseLocale,
  lettreDuJeton,
  listerModelesOllama,
  MoteurDecisionOllama,
  MoteurRedactionOllama
} from '../../src/coeur/moteurs/ollama';
import type { Question } from '../../src/partage/types';
import { fauxFetch, reponseJson } from '../outils/faux-fetch';

const URL_LOCALE = 'http://127.0.0.1:11434';

/** Réponse Ollama dont le premier jeton porte les log-probabilités données. */
function reponseAvecLogprobs(alternatives: Record<string, number>, contenu = 'A'): Response {
  const top = Object.entries(alternatives).map(([token, p]) => ({ token, logprob: Math.log(p) }));
  return reponseJson({
    model: 'qwen3:8b',
    message: { role: 'assistant', content: contenu },
    done: true,
    prompt_eval_count: 120,
    eval_count: 1,
    logprobs: [{ token: contenu, logprob: top[0]?.logprob ?? 0, top_logprobs: top }]
  });
}

describe('lecture des lettres', () => {
  it('reconnaît une lettre malgré espaces, casse et mise en forme', () => {
    const lettres = ['A', 'B', 'C'];
    expect(lettreDuJeton(' A', lettres)).toBe('A');
    expect(lettreDuJeton('b', lettres)).toBe('B');
    expect(lettreDuJeton('**C**', lettres)).toBe('C');
    expect(lettreDuJeton('A)', lettres)).toBe('A');
    expect(lettreDuJeton('D', lettres)).toBeNull();
    expect(lettreDuJeton('Aucune', lettres)).toBeNull();
  });

  it('additionne les variantes d’une même lettre puis normalise', () => {
    const distribution = distributionDepuisLogprobs(
      [
        { token: 'Réponse', logprob: -0.1 },
        {
          token: 'A',
          logprob: Math.log(0.5),
          top_logprobs: [
            { token: 'A', logprob: Math.log(0.5) },
            { token: ' A', logprob: Math.log(0.1) },
            { token: 'B', logprob: Math.log(0.2) },
            { token: 'Le', logprob: Math.log(0.2) }
          ]
        }
      ],
      ['A', 'B']
    );
    expect(distribution?.get('A')).toBeCloseTo(0.75);
    expect(distribution?.get('B')).toBeCloseTo(0.25);
  });

  it('renvoie null sans log-probabilités exploitables', () => {
    expect(distributionDepuisLogprobs(undefined, ['A'])).toBeNull();
    expect(distributionDepuisLogprobs([{ token: 'Bonjour', logprob: 0 }], ['A', 'B'])).toBeNull();
  });
});

describe('moteur de décision Ollama', () => {
  it('répond aux trois types de questions avec des probabilités', async () => {
    const { fetch, appels } = fauxFetch(
      reponseAvecLogprobs({ A: 0.8, B: 0.2 }),
      reponseAvecLogprobs({ B: 0.7, A: 0.2, C: 0.1 }, 'B'),
      reponseAvecLogprobs({ C: 0.6, B: 0.3, A: 0.1 }, 'C')
    );
    const moteur = new MoteurDecisionOllama({ url: URL_LOCALE, modele: 'qwen3:8b', fetch });
    const questions: Record<string, Question> = {
      action: { type: 'oui-non', consigne: 'Faut-il agir ?' },
      categorie: { type: 'choix', consigne: 'Quel type ?', options: { facture: null, devis: 'Offre de prix', contrat: null } },
      urgence: { type: 'note', consigne: 'Quelle urgence ?', echelle: ['Aucune', 'Bientôt', 'Tout de suite'] }
    };
    const { reponses, mesure } = await moteur.decider({ extrait: 'Devis de refonte' }, questions);

    expect(reponses.action).toEqual({ type: 'oui-non', probabiliteOui: expect.closeTo(0.8, 5) });
    expect(reponses.categorie).toMatchObject({ type: 'choix', choix: 'devis', confiance: expect.closeTo(0.7, 5) });
    expect(reponses.urgence).toMatchObject({ type: 'note', note: expect.closeTo(1.5, 5), confiance: expect.closeTo(0.6, 5) });

    expect(appels).toHaveLength(3);
    expect(appels[0]?.url).toBe(`${URL_LOCALE}/api/chat`);
    expect(appels[0]?.corps).toMatchObject({
      model: 'qwen3:8b',
      stream: false,
      think: false,
      logprobs: true,
      top_logprobs: 20,
      options: { temperature: 0 }
    });
    const prompt = (appels[1]?.corps as { messages: Array<{ content: string }> }).messages[1]?.content ?? '';
    expect(prompt).toContain('B) devis : Offre de prix');
    expect(prompt).toContain('Devis de refonte');

    expect(mesure).toMatchObject({ appels: 3, jetonsEntree: 360, coutUsd: 0, horsMachine: false, caracteresEnvoyes: 0 });
  });

  it('se rabat sur la lettre produite quand Ollama ne donne pas de log-probabilités', async () => {
    const { fetch } = fauxFetch(reponseJson({ message: { content: 'B' }, prompt_eval_count: 10, eval_count: 1 }));
    const moteur = new MoteurDecisionOllama({ url: URL_LOCALE, modele: 'm', fetch });
    const { reponses } = await moteur.decider('x', { q: { type: 'oui-non', consigne: '?' } });
    expect(reponses.q).toEqual({ type: 'oui-non', probabiliteOui: 0 });
  });

  it('explique comment installer un modèle absent', async () => {
    const { fetch } = fauxFetch(reponseJson({ error: "model 'qwen3:8b' not found" }, 404));
    const moteur = new MoteurDecisionOllama({ url: URL_LOCALE, modele: 'qwen3:8b', fetch });
    await expect(moteur.decider('x', { q: { type: 'oui-non', consigne: '?' } })).rejects.toThrow(/ollama pull qwen3:8b/);
  });

  it('signale un serveur Ollama éteint', async () => {
    const { fetch } = fauxFetch(new TypeError('fetch failed'));
    const moteur = new MoteurDecisionOllama({ url: URL_LOCALE, modele: 'm', fetch });
    await expect(moteur.decider('x', { q: { type: 'oui-non', consigne: '?' } })).rejects.toThrow(/injoignable/);
  });

  it('compte comme sortie de la machine un serveur Ollama distant', async () => {
    const { fetch } = fauxFetch(reponseAvecLogprobs({ A: 1 }));
    const moteur = new MoteurDecisionOllama({ url: 'http://serveur-gpu.lan:11434', modele: 'm', fetch });
    expect(moteur.horsMachine).toBe(true);
    const { mesure } = await moteur.decider('x', { q: { type: 'oui-non', consigne: '?' } });
    expect(mesure.caracteresEnvoyes).toBeGreaterThan(0);
  });
});

describe('moteur de rédaction Ollama', () => {
  it('envoie le message et renvoie le texte nettoyé', async () => {
    const { fetch, appels } = fauxFetch(
      reponseJson({ message: { content: '  - Point clé\n' }, prompt_eval_count: 900, eval_count: 60 })
    );
    const moteur = new MoteurRedactionOllama({ url: URL_LOCALE, modele: 'qwen3:8b', fetch });
    const { texte, mesure } = await moteur.rediger({ systeme: 'Sois fidèle.', utilisateur: 'Résume : …', source: '…' });
    expect(texte).toBe('- Point clé');
    expect(appels[0]?.corps).toMatchObject({ think: false, options: { num_predict: 800 } });
    expect(mesure).toMatchObject({ operation: 'redaction', jetonsEntree: 900, jetonsSortie: 60, horsMachine: false });
  });
});

describe('outils Ollama', () => {
  it('distingue adresses locales et distantes', () => {
    expect(estAdresseLocale('http://localhost:11434')).toBe(true);
    expect(estAdresseLocale('http://127.0.0.1:11434')).toBe(true);
    expect(estAdresseLocale('http://[::1]:11434')).toBe(true);
    expect(estAdresseLocale('http://192.168.1.20:11434')).toBe(false);
    expect(estAdresseLocale('pas une url')).toBe(false);
  });

  it('liste les modèles installés', async () => {
    const { fetch } = fauxFetch(reponseJson({ models: [{ name: 'qwen3:8b' }, { name: 'gemma3:4b' }] }));
    expect(await listerModelesOllama(URL_LOCALE, fetch)).toEqual(['gemma3:4b', 'qwen3:8b']);
  });
});
