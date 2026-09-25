import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rechercher } from '../../src/coeur/agent/agent';
import type { Profil } from '../../src/coeur/agent/profils';
import { type Corpus, indexerDossier, trouverCandidats } from '../../src/coeur/index/corpus';
import { fusionnerClassements, IndexVectoriel } from '../../src/coeur/index/vecteurs';
import {
  MoteurPlongementOllama,
  type MoteurPlongement,
  normaliser,
  type TexteAPlonger,
  textePourModele
} from '../../src/coeur/moteurs/plongements';
import { MoteurDecisionReference, MoteurRedactionReference } from '../../src/coeur/moteurs/reference';
import { ErreurMoteur, nouvelleMesure } from '../../src/coeur/moteurs/types';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT } from '../../src/partage/reglages';
import { dossierTemporaire } from '../outils/fabriques';
import { fauxFetch, reponseJson } from '../outils/faux-fetch';
import { ollamaPlongementsSimule, vecteurConcepts } from '../outils/plongements';

let dossier: string;
let nettoyer: () => Promise<void>;

beforeEach(async () => {
  ({ chemin: dossier, nettoyer } = await dossierTemporaire());
  await writeFile(join(dossier, 'bulletin-septembre.txt'), 'Bulletin de paie de septembre : salaire brut 2 400 euros, net 1 870 euros.');
  await writeFile(join(dossier, 'avis-fonciere.txt'), 'Avis de taxe foncière 2026 : montant à régler avant le 15 octobre.');
  await writeFile(join(dossier, 'garage-dupont.txt'), 'Facture du garage Dupont : révision de la voiture et changement des pneus.');
});
afterEach(async () => {
  await nettoyer();
});

/** Moteur de plongement en mémoire, qui compte les textes reçus. */
function moteurSimule(modele = 'embeddinggemma'): MoteurPlongement & { textes: TexteAPlonger[][] } {
  const moteur = {
    nom: 'Simulé',
    modele,
    horsMachine: false,
    textes: [] as TexteAPlonger[][],
    async plonger(textes: TexteAPlonger[], usage: 'requete' | 'document') {
      moteur.textes.push(textes);
      const vecteurs = textes.map((t) => normaliser(vecteurConcepts(textePourModele(modele, usage, t))));
      return { vecteurs, mesure: { ...nouvelleMesure('plongement', moteur), appels: 1 } };
    }
  };
  return moteur;
}

describe('moteur de plongement Ollama', () => {
  it('envoie les textes par lots, avec l’invite du modèle, et normalise les vecteurs', async () => {
    const { fetch, appels } = fauxFetch((appel) => {
      const { input } = appel.corps as { input: string[] };
      return reponseJson({ embeddings: input.map(() => [3, 4]), prompt_eval_count: input.length });
    });
    const moteur = new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'embeddinggemma', fetch });
    const textes = Array.from({ length: 20 }, (_, i) => ({ texte: `passage ${i}`, titre: 'devis refonte' }));
    const avancement: number[] = [];
    const { vecteurs, mesure } = await moteur.plonger(textes, 'document', { surAvancement: (n) => avancement.push(n) });

    expect(appels.map((a) => a.url)).toEqual(['http://127.0.0.1:11434/api/embed', 'http://127.0.0.1:11434/api/embed']);
    expect(appels[0]?.corps).toMatchObject({ model: 'embeddinggemma', truncate: true });
    expect((appels[0]?.corps as { input: string[] }).input).toHaveLength(16);
    expect((appels[0]?.corps as { input: string[] }).input[0]).toBe('title: devis refonte | text: passage 0');
    expect(avancement).toEqual([16, 20]);
    expect([...(vecteurs[0] ?? [])].map((v) => Number(v.toFixed(6)))).toEqual([0.6, 0.8]);
    expect(mesure).toMatchObject({ operation: 'plongement', appels: 2, jetonsEntree: 20, horsMachine: false, caracteresEnvoyes: 0 });
  });

  it('ajoute l’invite attendue par chaque famille de modèles', () => {
    expect(textePourModele('embeddinggemma:latest', 'requete', { texte: 'taxe foncière' })).toBe(
      'task: search result | query: taxe foncière'
    );
    expect(textePourModele('embeddinggemma', 'document', { texte: 'Montant dû' })).toBe('title: none | text: Montant dû');
    expect(textePourModele('nomic-embed-text-v2-moe', 'requete', { texte: 'taxe' })).toBe('search_query: taxe');
    expect(textePourModele('nomic-embed-text-v2-moe', 'document', { texte: 'Montant', titre: 'avis' })).toBe(
      'search_document: avis\nMontant'
    );
    expect(textePourModele('bge-m3', 'requete', { texte: 'taxe' })).toBe('taxe');
  });

  it('explique un modèle qui ne calcule pas de plongements', async () => {
    const { fetch } = fauxFetch(reponseJson({ error: '"qwen3.5:4b" does not support embeddings' }, 400));
    const moteur = new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'qwen3.5:4b', fetch });
    await expect(moteur.plonger([{ texte: 'a' }], 'requete')).rejects.toThrow(
      'Le modèle « qwen3.5:4b » ne calcule pas de plongements : choisissez un modèle de plongement, par exemple embeddinggemma.'
    );
  });

  it('indique la commande pour installer un modèle absent', async () => {
    const { fetch } = fauxFetch(reponseJson({ error: 'model "embeddinggemma" not found, try pulling it first' }, 404));
    const moteur = new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'embeddinggemma', fetch });
    await expect(moteur.plonger([{ texte: 'a' }], 'requete')).rejects.toThrow(/ollama pull embeddinggemma/);
  });

  it('refuse une réponse incomplète', async () => {
    const { fetch } = fauxFetch(reponseJson({ embeddings: [[1, 0]] }));
    const moteur = new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'embeddinggemma', fetch });
    await expect(moteur.plonger([{ texte: 'a' }, { texte: 'b' }], 'document')).rejects.toThrow(ErreurMoteur);
  });

  it('compte les caractères envoyés à un Ollama distant', async () => {
    const { fetch } = fauxFetch(reponseJson({ embeddings: [[1, 0]] }));
    const moteur = new MoteurPlongementOllama({ url: 'http://192.168.1.20:11434', modele: 'bge-m3', fetch });
    const { mesure } = await moteur.plonger([{ texte: 'taxe' }], 'requete');
    expect(mesure).toMatchObject({ horsMachine: true, caracteresEnvoyes: 4 });
  });
});

describe('index vectoriel et fusion des classements', () => {
  it('classe par similarité cosinus', () => {
    const index = new IndexVectoriel<string>(2);
    index.ajouter('est', normaliser([1, 0]));
    index.ajouter('nord', normaliser([0, 1]));
    index.ajouter('nord-est', normaliser([1, 1]));
    expect(index.chercher(normaliser([1, 0.2]), 2).map((r) => r.element)).toEqual(['est', 'nord-est']);
    expect(() => index.ajouter('trop', normaliser([1, 0, 0]))).toThrow(/dimension/);
    expect(new IndexVectoriel<string>(0).chercher(normaliser([1, 0]))).toEqual([]);
  });

  it('fusionne deux classements par rang réciproque', () => {
    // b est bien classé des deux côtés : il passe devant a et d, premiers d'un seul classement.
    expect(fusionnerClassements([['a', 'b', 'c'], ['d', 'b', 'e']])).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(fusionnerClassements([[], ['x']])).toEqual(['x']);
  });
});

describe('recherche sémantique (option)', () => {
  const avecOption = { semantique: true };

  it('indexe les passages et retrouve un document par le sens, sans mot commun', async () => {
    const moteur = moteurSimule();
    const etapes: string[] = [];
    const corpus = await indexerDossier(dossier, {
      plongement: moteur,
      surProgression: (p) => p.etape === 'plongements' && etapes.push(`${p.traites}/${p.total}`)
    });
    expect(corpus.semantique).toMatchObject({ etat: 'pret', modele: 'embeddinggemma' });
    expect(etapes).toEqual(['0/3', '3/3']);
    expect(corpus.mesures.map((m) => m.operation)).toEqual(['plongement']);
    // Le titre du document accompagne chaque passage.
    expect(moteur.textes[0]?.[0]).toEqual({ texte: expect.stringContaining('Avis de taxe foncière'), titre: 'avis fonciere' });

    // « rémunération » n'apparaît dans aucun document : BM25 seul ne trouve rien.
    expect((await trouverCandidats(corpus, 'rémunération', 5)).candidats).toEqual([]);
    const trouves = await trouverCandidats(corpus, 'rémunération', 5, avecOption);
    expect(trouves.modelePlongement).toBe('embeddinggemma');
    expect(trouves.candidats[0]).toMatchObject({
      passage: { documentId: 'bulletin-septembre.txt' },
      rangLexical: null,
      rangSemantique: 1
    });
    expect(trouves.mesures).toHaveLength(1);

    const fonciere = await trouverCandidats(corpus, 'taxe foncière', 5, avecOption);
    expect(fonciere.candidats[0]).toMatchObject({ passage: { documentId: 'avis-fonciere.txt' }, rangLexical: 1, rangSemantique: 1 });
  });

  it('reste lexicale quand l’option est désactivée', async () => {
    const corpus = await indexerDossier(dossier, { plongement: moteurSimule() });
    const trouves = await trouverCandidats(corpus, 'taxe foncière', 5, { semantique: false });
    expect(trouves).toMatchObject({ modelePlongement: null, mesures: [] });
    expect(trouves.candidats.map((c) => c.rangSemantique)).toEqual([null]);
  });

  it('demande de réindexer quand l’option est activée après l’indexation', async () => {
    const corpus = await indexerDossier(dossier);
    const trouves = await trouverCandidats(corpus, 'taxe foncière', 5, avecOption);
    expect(trouves.avis).toBe('Recherche sémantique activée après l’indexation : réindexez le dossier pour l’appliquer.');
    expect(trouves.candidats[0]?.passage.documentId).toBe('avis-fonciere.txt');
  });

  it('garde la recherche par mots-clés si les plongements échouent à l’indexation', async () => {
    const { fetch } = fauxFetch(new TypeError('fetch failed'));
    const plongement = new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'embeddinggemma', fetch });
    const corpus = await indexerDossier(dossier, { plongement });

    expect(corpus.documents).toHaveLength(3);
    expect(corpus.semantique).toMatchObject({ etat: 'echec' });
    expect(corpus.avis).toEqual([
      'Recherche sémantique indisponible : Ollama est injoignable à http://127.0.0.1:11434 : est-il lancé ? La recherche par mots-clés reste disponible.'
    ]);
    const trouves = await trouverCandidats(corpus, 'taxe foncière', 5, avecOption);
    expect(trouves.candidats[0]?.passage.documentId).toBe('avis-fonciere.txt');
    expect(trouves.avis).toMatch(/^Recherche sémantique indisponible : .* Réindexez le dossier une fois le problème réglé\.$/);
  });

  it('se replie sur les mots-clés si la requête ne peut pas être plongée', async () => {
    const moteur = moteurSimule();
    const corpus = await indexerDossier(dossier, { plongement: moteur });
    moteur.plonger = async () => {
      throw new ErreurMoteur('Ollama n’a pas répondu à temps (http://127.0.0.1:11434).');
    };
    const trouves = await trouverCandidats(corpus, 'taxe foncière', 5, avecOption);
    expect(trouves.modelePlongement).toBeNull();
    expect(trouves.avis).toBe(
      'Recherche sémantique indisponible : Ollama n’a pas répondu à temps (http://127.0.0.1:11434). Recherche par mots-clés seule.'
    );
    expect(trouves.candidats[0]?.passage.documentId).toBe('avis-fonciere.txt');
  });

  it('signale un changement de modèle depuis l’indexation', async () => {
    const corpus = await indexerDossier(dossier, { plongement: moteurSimule('embeddinggemma') });
    const meme = await trouverCandidats(corpus, 'paie', 5, { semantique: true, modele: 'embeddinggemma:latest' });
    expect(meme.avis).toBeUndefined();
    const autre = await trouverCandidats(corpus, 'paie', 5, { semantique: true, modele: 'nomic-embed-text-v2-moe' });
    expect(autre.avis).toBe('Index sémantique calculé avec embeddinggemma : réindexez le dossier pour passer à nomic-embed-text-v2-moe.');
    expect(autre.modelePlongement).toBe('embeddinggemma');
  });

  it('ne recalcule que les passages nouveaux ou modifiés', async () => {
    const moteur = moteurSimule();
    const memoire = new Map<string, Float32Array>();
    await indexerDossier(dossier, { plongement: moteur, memoirePlongements: memoire });
    expect(moteur.textes.map((t) => t.length)).toEqual([3]);

    const corpus = await indexerDossier(dossier, { plongement: moteur, memoirePlongements: memoire });
    expect(moteur.textes).toHaveLength(1);
    expect(corpus.semantique?.etat).toBe('pret');
    expect(corpus.mesures).toEqual([]);

    await writeFile(join(dossier, 'garage-dupont.txt'), 'Devis du garage Dupont : remplacement du pare-brise du véhicule.');
    await indexerDossier(dossier, { plongement: moteur, memoirePlongements: memoire });
    expect(moteur.textes.map((t) => t.length)).toEqual([3, 1]);
    // La mémoire ne garde que les vecteurs du dossier courant.
    expect(memoire.size).toBe(3);
  });

  it('interrompt l’indexation quand on l’annule pendant les plongements', async () => {
    const annulation = new AbortController();
    const moteur = moteurSimule();
    moteur.plonger = async () => {
      annulation.abort();
      throw new DOMException('Annulé', 'AbortError');
    };
    await expect(indexerDossier(dossier, { plongement: moteur, signal: annulation.signal })).rejects.toThrow('Annulé');
  });
});

describe('agent : recherche avec l’option sémantique', () => {
  const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { semantique: { active: true }, recherche: { candidats: 3, resultats: 3 } });
  const profil: Profil = {
    id: 'reference',
    libelle: 'test',
    decision: new MoteurDecisionReference(),
    redaction: new MoteurRedactionReference()
  };

  it('soumet à la décision les passages trouvés par le sens', async () => {
    const { fetch, appels } = ollamaPlongementsSimule();
    const corpus: Corpus = await indexerDossier(dossier, {
      plongement: new MoteurPlongementOllama({ url: 'http://127.0.0.1:11434', modele: 'embeddinggemma', fetch })
    });
    const recherche = await rechercher(corpus, 'rémunération du mois', profil, reglages);

    expect(recherche.modelePlongement).toBe('embeddinggemma');
    expect(recherche.resultats.map((r) => r.passage.documentId)).toContain('bulletin-septembre.txt');
    expect(recherche.resultats.find((r) => r.passage.documentId === 'bulletin-septembre.txt')).toMatchObject({
      rangLexical: null,
      rangSemantique: 1
    });
    // Une requête de plongement, puis une décision par candidat.
    expect(recherche.mesures.map((m) => m.operation)).toEqual(['plongement', 'decision', 'decision', 'decision']);
    expect((appels.at(-1)?.corps as { input: string[] }).input).toEqual(['task: search result | query: rémunération du mois']);
  });
});
