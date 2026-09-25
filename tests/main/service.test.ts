import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ServiceAgent } from '../../src/main/service';
import type { Progression } from '../../src/partage/contrat';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT, type Reglages, type Secrets } from '../../src/partage/reglages';
import { type AppelEnregistre, fauxFetch, reponseJson } from '../outils/faux-fetch';

const DEMO = resolve(import.meta.dirname, '../../jeux-evaluation/demo');

function service(options: { reglages?: Partial<Reglages>; secrets?: Secrets; fetch?: typeof fetch } = {}) {
  let reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { profil: 'reference', ...options.reglages });
  const progressions: Progression[] = [];
  const agent = new ServiceAgent({
    reglages: () => reglages,
    secrets: () => options.secrets ?? {},
    envoyer: (p) => progressions.push(p),
    ...(options.fetch ? { fetch: options.fetch } : {})
  });
  return {
    agent,
    progressions,
    changer: (partiel: Parameters<typeof fusionnerReglages>[1]) => {
      reglages = fusionnerReglages(reglages, partiel);
    }
  };
}

describe('service de l’application', () => {
  it('exige un dossier indexé avant de chercher', async () => {
    const { agent } = service();
    await expect(agent.rechercher('facture')).rejects.toThrow("Aucun dossier indexé : choisissez d’abord un dossier.");
    expect(agent.etatCorpus()).toBeNull();
  });

  it('indexe, trie, garde les triages par mode et résume', async () => {
    const { agent, progressions, changer } = service();
    const etat = await agent.indexer(resolve(DEMO, 'documents'));
    expect(etat.documents).toHaveLength(12);
    expect(etat.documents[0]).not.toHaveProperty('texte');
    expect(progressions.some((p) => p.type === 'indexation')).toBe(true);

    const triages = await agent.trier();
    expect(triages).toHaveLength(12);
    expect(progressions.filter((p) => p.type === 'triage').at(-1)).toEqual({ type: 'triage', fait: 12, total: 12 });
    expect(agent.etatCorpus()?.documents.every((d) => d.triage?.profil === 'reference')).toBe(true);
    // Déjà triés : rien à refaire.
    expect(await agent.trier()).toEqual([]);

    // Un autre mode (ou d'autres modèles) n'a pas encore trié ces documents.
    changer({ profil: 'local' });
    expect(agent.etatCorpus()?.documents.every((d) => d.triage === null)).toBe(true);
    changer({ profil: 'reference' });
    expect(agent.etatCorpus()?.documents.every((d) => d.triage !== null)).toBe(true);

    const id = 'contrat-maintenance-site.txt';
    expect(agent.detail(id)).toMatchObject({ id, resume: null, apercu: expect.stringContaining('CONTRAT DE MAINTENANCE') });
    await agent.resumer(id);
    expect(agent.detail(id).resume?.texte).toContain('180 € HT par mois');
    expect(() => agent.cheminDocument('../secret.txt')).toThrow(/Document inconnu/);
    expect(agent.journal()).toEqual([]);
  });

  it('consigne les envois du mode hybride, données personnelles masquées', async () => {
    const corps: unknown[] = [];
    const { fetch } = fauxFetch((appel: AppelEnregistre) => {
      corps.push(appel.corps);
      return reponseJson({
        model: 'typesafe/jev-1.13-20260917',
        answers: {
          categorie: { type: 'choice', choice: 'facture', confidence: 0.9, probabilities: { facture: 0.95 } },
          action: { type: 'noul', noul: 0.97 },
          urgence: { type: 'score', score: 1.2, confidence: 0.7, probabilities: { '0': 0, '1': 0.8, '2': 0.2 } }
        },
        usage: { input_tokens: 900, output_tokens: 60, cost: 0.0000378 }
      });
    });
    const { agent } = service({ reglages: { profil: 'hybride' }, secrets: { cleOpenRouter: 'sk-or-test' }, fetch });
    await agent.indexer(resolve(DEMO, 'documents'));
    const [triage] = await agent.trier(['facture-imprimerie-lumen.txt']);

    expect(triage).toMatchObject({ categorie: 'facture', actionRequise: true, aVerifier: false });
    expect(JSON.stringify(corps)).not.toContain('FR76 1234');
    expect(JSON.stringify(corps)).toContain('[IBAN_1]');
    const [entree] = agent.journal();
    expect(entree).toMatchObject({ operation: 'decision', moteur: 'Jev via OpenRouter', coutUsd: 0.0000378 });
    expect(entree?.caracteres).toBeGreaterThan(500);
    expect(entree?.masques).toBe(2);
  });

  it('fait tourner le banc et garde le dernier rapport', async () => {
    const { agent, progressions } = service();
    expect(agent.dernierBanc).toBeNull();
    const premier = agent.lancerBanc(DEMO, ['reference']);
    await expect(agent.lancerBanc(DEMO, ['reference'])).rejects.toThrow('Une comparaison est déjà en cours.');
    const { resultat, rapport } = await premier;
    expect(resultat.profils[0]?.statut).toBe('termine');
    expect(rapport).toContain('# Rapport de comparaison');
    expect(agent.dernierBanc?.resultat).toBe(resultat);
    expect(progressions.some((p) => p.type === 'banc' && p.etape === 'resume')).toBe(true);
    await expect(agent.lancerBanc(DEMO, [])).rejects.toThrow('Choisissez au moins un mode à comparer.');
  });
});
