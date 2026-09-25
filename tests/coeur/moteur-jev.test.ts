import { describe, expect, it } from 'vitest';
import { MoteurJev, versQuestionsJev } from '../../src/coeur/moteurs/jev';
import { ErreurMoteur } from '../../src/coeur/moteurs/types';
import type { Question } from '../../src/partage/types';
import { fauxFetch, reponseJson } from '../outils/faux-fetch';

const QUESTIONS: Record<string, Question> = {
  action: { type: 'oui-non', consigne: 'Faut-il agir ?', criteres: { oui: 'Il faut payer.', non: 'Rien à faire.' } },
  categorie: { type: 'choix', consigne: 'Quel type ?', options: { facture: 'Demande de paiement', devis: null } },
  urgence: { type: 'note', consigne: 'Quelle urgence ?', echelle: ['Aucune', 'Bientôt', 'Tout de suite'] }
};

// Réponse au format documenté de l'API System One, via OpenRouter.
const REPONSE_JEV = {
  id: 'gen-dec-1',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    action: { type: 'noul', noul: 0.91 },
    categorie: { type: 'choice', choice: 'facture', confidence: 0.8, probabilities: { facture: 0.86, devis: 0.14 } },
    urgence: {
      type: 'score',
      score: 1.7,
      confidence: 0.65,
      probabilities: { '0': 0.05, '1': 0.2, '2': 0.75 },
      legend: { '0': 'Aucune', '1': 'Bientôt', '2': 'Tout de suite' }
    }
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 }
};

describe('traduction vers les questions de Jev', () => {
  it('produit noul, choice et score', () => {
    expect(versQuestionsJev(QUESTIONS)).toEqual({
      action: { type: 'noul', instructions: 'Faut-il agir ?', criteria: { true: 'Il faut payer.', false: 'Rien à faire.' } },
      categorie: { type: 'choice', instructions: 'Quel type ?', criteria: { facture: 'Demande de paiement', devis: null } },
      urgence: { type: 'score', instructions: 'Quelle urgence ?', criteria: ['Aucune', 'Bientôt', 'Tout de suite'] }
    });
  });
});

describe('moteur Jev', () => {
  it('passe par l’API System One d’OpenRouter et traduit les réponses', async () => {
    const { fetch, appels } = fauxFetch(reponseJson(REPONSE_JEV));
    const moteur = new MoteurJev({ acces: 'openrouter', cle: 'sk-or-test', fetch });
    const { reponses, mesure } = await moteur.decider({ document: 'Facture à régler' }, QUESTIONS);

    expect(appels[0]?.url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(appels[0]?.entetes.authorization).toBe('Bearer sk-or-test');
    expect(appels[0]?.corps).toMatchObject({ model: 'jev-latest', state: { document: 'Facture à régler' } });

    expect(reponses.action).toEqual({ type: 'oui-non', probabiliteOui: 0.91 });
    expect(reponses.categorie).toEqual({
      type: 'choix',
      choix: 'facture',
      confiance: 0.8,
      probabilites: { facture: 0.86, devis: 0.14 }
    });
    expect(reponses.urgence).toEqual({ type: 'note', note: 1.7, confiance: 0.65, probabilites: [0.05, 0.2, 0.75] });

    expect(mesure).toMatchObject({
      operation: 'decision',
      moteur: 'Jev via OpenRouter',
      modele: 'typesafe/jev-1.13-20260917',
      jetonsEntree: 476,
      jetonsSortie: 70,
      coutUsd: 0.000019992,
      horsMachine: true,
      appels: 1
    });
    expect(mesure.caracteresEnvoyes).toBeGreaterThan(0);
  });

  it('en direct chez TypeSafe, calcule le coût au tarif public', async () => {
    const { usage: _usage, ...sansUsage } = REPONSE_JEV;
    const { fetch, appels } = fauxFetch(reponseJson({ ...sansUsage, usage: { input_tokens: 1_000_000, output_tokens: 70 } }));
    const moteur = new MoteurJev({ acces: 'typesafe', cle: 'ts-test', modele: 'jev-1.13', fetch });
    const { mesure } = await moteur.decider('Facture', QUESTIONS);
    expect(appels[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(appels[0]?.corps).toMatchObject({ model: 'jev-1.13' });
    expect(mesure.coutUsd).toBeCloseTo(0.042, 10);
    expect(mesure.moteur).toBe('Jev via TypeSafe');
  });

  it('traduit un refus de clé en message clair', async () => {
    const { fetch } = fauxFetch(reponseJson({ error: { message: 'User not found.' } }, 401));
    const moteur = new MoteurJev({ acces: 'openrouter', cle: 'mauvaise', fetch });
    await expect(moteur.decider('x', QUESTIONS)).rejects.toThrow(/refuse la clé API \(401\)/);
  });

  it('refuse de démarrer sans clé', () => {
    expect(() => new MoteurJev({ acces: 'openrouter', cle: '' })).toThrow(ErreurMoteur);
  });

  it('signale une réponse d’un type inattendu', async () => {
    const { fetch } = fauxFetch(
      reponseJson({ ...REPONSE_JEV, answers: { ...REPONSE_JEV.answers, action: { type: 'score', score: 1 } } })
    );
    const moteur = new MoteurJev({ acces: 'openrouter', cle: 'k', fetch });
    await expect(moteur.decider('x', QUESTIONS)).rejects.toThrow(/Réponse inattendue de Jev/);
  });
});
