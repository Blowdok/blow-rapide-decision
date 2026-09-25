import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Profil } from '../../src/coeur/agent/profils';
import { creerProfil } from '../../src/coeur/agent/profils';
import { executerBanc } from '../../src/coeur/banc/executer';
import { chargerJeu, ErreurJeu, problemesDuJeu } from '../../src/coeur/banc/jeu';
import { calculerMetriques, evaluerFaits, rangDuPremierPertinent } from '../../src/coeur/banc/metriques';
import { nomDuRapport, rapportMarkdown } from '../../src/coeur/banc/rapport';
import { recommander } from '../../src/coeur/banc/recommandation';
import { type Corpus, indexerDossier } from '../../src/coeur/index/corpus';
import { MoteurPlongementOllama } from '../../src/coeur/moteurs/plongements';
import { MoteurDecisionReference, MoteurRedactionReference } from '../../src/coeur/moteurs/reference';
import type { MoteurDecision } from '../../src/coeur/moteurs/types';
import type { JeuEvaluation, ProgressionBanc, ResultatProfil } from '../../src/partage/banc';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT } from '../../src/partage/reglages';
import type { IdProfil } from '../../src/partage/types';
import { dossierTemporaire } from '../outils/fabriques';
import { ollamaPlongementsSimule } from '../outils/plongements';

const DOSSIER_DEMO = resolve(import.meta.dirname, '../../jeux-evaluation/demo');

let jeu: JeuEvaluation;
let corpus: Corpus;

beforeAll(async () => {
  jeu = await chargerJeu(DOSSIER_DEMO);
  corpus = await indexerDossier(jeu.dossierDocuments);
});

describe('jeu d’évaluation', () => {
  it('charge le jeu de démonstration', () => {
    expect(jeu.nom).toBe('Démo bureau : petite agence web');
    expect(jeu.classement).toHaveLength(12);
    expect(jeu.recherche).toHaveLength(11);
    expect(jeu.resume).toHaveLength(5);
    expect(jeu.criteres.toleranceQualite).toBe(5);
    expect(jeu.dossierDocuments).toBe(join(DOSSIER_DEMO, 'documents'));
  });

  it('est cohérent avec ses documents et les catégories par défaut', () => {
    expect(corpus.documents).toHaveLength(12);
    expect(corpus.erreurs).toEqual([]);
    expect(problemesDuJeu(jeu, corpus, REGLAGES_PAR_DEFAUT.classement.categories)).toEqual([]);
  });

  it('signale document introuvable et catégorie inconnue', () => {
    const faux: JeuEvaluation = {
      ...jeu,
      classement: [{ document: 'absent.txt', categorie: 'poeme' }],
      recherche: [],
      resume: []
    };
    expect(problemesDuJeu(faux, corpus, REGLAGES_PAR_DEFAUT.classement.categories)).toEqual([
      'classement[0] : document « absent.txt » introuvable ou illisible.',
      'classement[0] : catégorie « poeme » absente des réglages.'
    ]);
  });

  describe('fichiers invalides', () => {
    let dossier: string;
    let nettoyer: () => Promise<void>;
    beforeEach(async () => {
      ({ chemin: dossier, nettoyer } = await dossierTemporaire());
    });
    afterEach(async () => nettoyer());

    it.each([
      ['{ pas du json', /Lecture impossible/],
      ['{}', /aucune attente/],
      ['{"classement": [{"document": "a.txt"}]}', /« document » et « categorie » sont obligatoires/],
      ['{"classement": [{"document": "a.txt", "categorie": "facture", "urgence": 5}]}', /« urgence » doit valoir 0, 1 ou 2/],
      ['{"recherche": [{"requete": "x", "pertinents": []}]}', /liste « pertinents » non vide/],
      ['{"resume": [{"document": "a.txt", "faits": ["pas une liste"]}]}', /listes de variantes/]
    ])('refuse %s', async (contenu, message) => {
      await writeFile(join(dossier, 'jeu.json'), contenu);
      await expect(chargerJeu(dossier)).rejects.toThrow(message);
      await expect(chargerJeu(dossier)).rejects.toBeInstanceOf(ErreurJeu);
    });
  });
});

describe('métriques', () => {
  it('retrouve les faits malgré accents, casse et espaces des milliers', () => {
    const resultat = evaluerFaits('Facture LUMEN : 1 250 € à payer, échéance le 15 Octobre.', [
      ['1 250', '1250'],
      ['15 octobre'],
      ['lumen'],
      ['500 flyers']
    ]);
    expect(resultat).toEqual({ trouves: 3, manquants: ['500 flyers'] });
  });

  it('donne le rang du premier document pertinent', () => {
    expect(rangDuPremierPertinent(['a', 'b', 'c'], ['c', 'b'])).toBe(2);
    expect(rangDuPremierPertinent(['a'], ['z'])).toBeNull();
  });

  it('compte une erreur comme une réponse fausse dans l’indice de qualité', () => {
    const juste = { attendu: { document: 'a', categorie: 'facture', action: true }, dureeMs: 10, coutUsd: 0.001 };
    const metriques = calculerMetriques(
      [
        { ...juste, obtenu: { categorie: 'facture', confiance: 0.9, probabiliteAction: 0.8, urgence: 1, aVerifier: false }, categorieJuste: true, actionJuste: true },
        { ...juste, dureeMs: 0, coutUsd: 0, erreur: 'panne' }
      ],
      [{ requete: 'q', pertinents: ['a'], documentsObtenus: ['b', 'a'], rangPertinent: 2, dureeMs: 5, coutUsd: 0 }],
      [{ document: 'a', faitsTrouves: 1, faitsTotal: 2, faitsManquants: ['x'], mots: 40, dureeMs: 20, coutUsd: 0.002 }],
      [],
      100
    );
    expect(metriques.classement.categorie).toBe(0.5);
    expect(metriques.classement.action).toBe(0.5);
    expect(metriques.classement.urgence).toBeNull();
    expect(metriques.classement.erreurs).toBe(1);
    expect(metriques.recherche.mrr).toBe(0.5);
    expect(metriques.resume.couverture).toBe(0.5);
    // Moyenne de 0,5 (catégorie), 0,5 (action), 0,5 (recherche) et 0,5 (résumés).
    expect(metriques.qualite).toBe(50);
    expect(metriques.cout.pour1000DocumentsUsd).toBeCloseTo(3);
    expect(metriques.temps.triageMoyenMs).toBe(10);
  });
});

/** Profils de test : moteurs de référence, sous le nom du mode demandé. */
function profilDeTest(id: IdProfil, decision: MoteurDecision = new MoteurDecisionReference()): Profil {
  return { id, libelle: id, decision, redaction: new MoteurRedactionReference() };
}

describe('exécution du banc', () => {
  it('fait tourner la référence sans IA sur tout le jeu de démonstration', async () => {
    const progressions: ProgressionBanc[] = [];
    const resultat = await executerBanc(jeu, corpus, {
      reglages: REGLAGES_PAR_DEFAUT,
      profils: ['reference'],
      fabriquerProfil: (id) => creerProfil(id, { reglages: REGLAGES_PAR_DEFAUT, secrets: {} }),
      surProgression: (p) => progressions.push(p),
      maintenant: () => new Date('2026-09-25T08:00:00')
    });
    const [reference] = resultat.profils;
    expect(reference?.statut).toBe('termine');
    expect(reference?.classement).toHaveLength(12);
    expect(reference?.recherche).toHaveLength(11);
    expect(reference?.resume).toHaveLength(5);
    expect(reference?.metriques.qualite).toBeGreaterThan(0);
    expect(reference?.metriques.confidentialite.caracteresEnvoyes).toBe(0);
    expect(reference?.metriques.cout.totalUsd).toBe(0);
    expect(resultat.rechercheLexicale).toHaveLength(11);
    expect(progressions.filter((p) => p.etape === 'classement').at(-1)).toEqual({
      profil: 'reference',
      etape: 'classement',
      fait: 12,
      total: 12
    });
    expect(resultat.date).toBe(new Date('2026-09-25T08:00:00').toISOString());
  });

  it('marque indisponible un mode dont les moteurs ne peuvent pas démarrer', async () => {
    const resultat = await executerBanc(jeu, corpus, {
      reglages: REGLAGES_PAR_DEFAUT,
      profils: ['hybride'],
      fabriquerProfil: (id) => creerProfil(id, { reglages: REGLAGES_PAR_DEFAUT, secrets: {} })
    });
    expect(resultat.profils[0]).toMatchObject({ statut: 'indisponible', message: expect.stringMatching(/Clé OpenRouter manquante/) });
    expect(resultat.recommandation.profil).toBeNull();
  });

  it('interrompt un mode après trois échecs sans succès', async () => {
    let appels = 0;
    const enPanne: MoteurDecision = {
      nom: 'Ollama',
      modele: 'm',
      horsMachine: false,
      decider: async () => {
        appels++;
        throw new Error('Ollama est injoignable');
      }
    };
    const resultat = await executerBanc(jeu, corpus, {
      reglages: REGLAGES_PAR_DEFAUT,
      profils: ['local'],
      fabriquerProfil: (id) => profilDeTest(id, enPanne)
    });
    const [local] = resultat.profils;
    expect(appels).toBe(3);
    expect(local?.statut).toBe('interrompu');
    expect(local?.message).toBe('Ollama est injoignable');
    expect(local?.classement.at(-1)?.erreur).toMatch(/Non évalué/);
    expect(local?.resume.every((r) => r.erreur)).toBe(true);
  });

  it('produit un rapport Markdown complet', async () => {
    const resultat = await executerBanc(jeu, corpus, {
      reglages: REGLAGES_PAR_DEFAUT,
      profils: ['local', 'hybride', 'reference'],
      fabriquerProfil: (id) => profilDeTest(id),
      maintenant: () => new Date('2026-09-25T08:00:00')
    });
    const rapport = rapportMarkdown(resultat);
    expect(rapport).toMatch(/^# Rapport de comparaison : Démo bureau : petite agence web/);
    expect(rapport).toContain('25 septembre 2026');
    expect(rapport).toContain('## Recommandation');
    expect(rapport).toContain('**Mode recommandé : local**');
    expect(rapport).toContain('| Critère | Local | Hybride | Référence sans IA |');
    expect(rapport).toContain('## Classement, document par document');
    expect(rapport).toContain('| facture-imprimerie-lumen.txt | facture · action · urgence 1 |');
    expect(rapport).toContain('## Recherche, requête par requête');
    expect(rapport).toContain('### urssaf-mise-en-demeure.txt');
    expect(rapport).toContain('## Méthode');
    expect(nomDuRapport(new Date('2026-09-25T08:05:00'))).toBe('comparaison-2026-09-25-0805');
  });
});

describe('banc avec la recherche sémantique (option)', () => {
  const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { semantique: { active: true } });
  const options = {
    reglages,
    profils: ['reference'] as IdProfil[],
    fabriquerProfil: (id: IdProfil) => creerProfil(id, { reglages, secrets: {} })
  };

  it('ajoute le classement fusionné sans décision, commun à tous les modes', async () => {
    const { fetch } = ollamaPlongementsSimule();
    const plongement = new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'embeddinggemma', fetch });
    const corpusSemantique = await indexerDossier(jeu.dossierDocuments, { plongement });
    const resultat = await executerBanc(jeu, corpusSemantique, options);

    expect(resultat.semantique?.modele).toBe('embeddinggemma');
    expect(resultat.semantique?.recherche).toHaveLength(11);
    expect(resultat.semantique?.recherche.every((r) => !r.erreur)).toBe(true);
    const rapport = rapportMarkdown(resultat);
    expect(rapport).toContain('| Requête | Document attendu | Lexical seul | Lexical et sémantique | Référence sans IA |');
    expect(rapport).toContain('Recherche lexicale et sémantique fusionnées (embeddinggemma), sans décision : pertinent en tête');
    expect(rapport).toContain('La recherche sémantique (option, embeddinggemma) complétait BM25');
  });

  it('signale une recherche sémantique demandée mais indisponible', async () => {
    const resultat = await executerBanc(jeu, corpus, options);
    expect(resultat.semantique).toEqual({ modele: null, avis: 'index sémantique absent du corpus.', recherche: [] });
    expect(rapportMarkdown(resultat)).toContain(
      'Recherche sémantique demandée mais indisponible : index sémantique absent du corpus. ' +
        'Les modes ont jugé les passages de la seule recherche lexicale.'
    );
  });

  it('n’ajoute rien quand l’option est désactivée', async () => {
    const resultat = await executerBanc(jeu, corpus, { ...options, reglages: REGLAGES_PAR_DEFAUT });
    expect(resultat).not.toHaveProperty('semantique');
    expect(rapportMarkdown(resultat)).not.toContain('Lexical et sémantique');
  });
});

/** Résultat de profil minimal, pour tester la règle de recommandation. */
function profil(id: IdProfil, qualite: number | null, extra: Partial<ResultatProfil['metriques']> = {}): ResultatProfil {
  const metriques = calculerMetriques([], [], [], [], 0);
  return {
    profil: id,
    libelle: { local: 'Local', hybride: 'Hybride', reference: 'Référence sans IA' }[id],
    moteurs: { decision: '', redaction: '' },
    statut: qualite === null ? 'indisponible' : 'termine',
    ...(qualite === null ? { message: 'Ollama est injoignable' } : {}),
    classement: [],
    recherche: [],
    resume: [],
    mesures: [],
    metriques: { ...metriques, ...extra, qualite }
  };
}

describe('recommandation', () => {
  const hybrideCher = {
    cout: { totalUsd: 0.05, pour1000DocumentsUsd: 4.5 },
    confidentialite: { appelsHorsMachine: 40, caracteresEnvoyes: 45_210, elementsMasques: 14 }
  };

  it('préfère le local quand l’écart reste dans la tolérance', () => {
    const r = recommander([profil('local', 80), profil('hybride', 84, hybrideCher), profil('reference', 50)], 5, 30);
    expect(r.profil).toBe('local');
    expect(r.titre).toBe('Mode recommandé : local');
    expect(r.raisons[0]).toContain('L’écart de 4 points reste dans la tolérance de 5.');
    expect(r.raisons.join(' ')).toContain('+30 points par rapport à la référence sans IA');
    expect(r.avertissements).toEqual([]);
  });

  it('recommande l’hybride au-delà de la tolérance, avec son coût', () => {
    const r = recommander([profil('local', 70), profil('hybride', 88, hybrideCher)], 5, 30);
    expect(r.profil).toBe('hybride');
    expect(r.raisons[0]).toContain('soit 18 points de plus');
    expect(r.raisons[1]).toContain('4,50 $ pour 1 000 documents');
    expect(r.raisons[2]).toContain('14 données personnelles masquées');
  });

  it('signale une comparaison incomplète et un petit jeu', () => {
    const r = recommander([profil('local', null), profil('hybride', 75)], 5, 12);
    expect(r.profil).toBe('hybride');
    expect(r.titre).toBe('Comparaison incomplète : seul le mode Hybride a tourné');
    expect(r.avertissements[0]).toBe('Mode Local indisponible : Ollama est injoignable.');
    expect(r.avertissements.join(' ')).toContain('Jeu de 12 documents');
  });

  it('prévient quand l’IA ne fait pas mieux que la référence', () => {
    const r = recommander([profil('local', 52), profil('hybride', 53), profil('reference', 50)], 5, 30);
    expect(r.avertissements.join(' ')).toContain('L’IA ne fait guère mieux que la référence sans IA');
  });
});
