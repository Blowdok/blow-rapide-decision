import { describe, expect, it } from 'vitest';
import { rechercher, resumerDocument, trierDocument } from '../../src/coeur/agent/agent';
import { creerProfil, type Profil } from '../../src/coeur/agent/profils';
import { construireCorpus, passagesDuDocument } from '../../src/coeur/index/corpus';
import { MoteurRedactionReference } from '../../src/coeur/moteurs/reference';
import type { MoteurDecision, MoteurRedaction } from '../../src/coeur/moteurs/types';
import { ErreurMoteur, nouvelleMesure } from '../../src/coeur/moteurs/types';
import { fusionnerReglages, REGLAGES_PAR_DEFAUT } from '../../src/partage/reglages';
import type { DocumentIndexe, Etat, Question } from '../../src/partage/types';

function documentDe(id: string, texte: string): DocumentIndexe {
  return {
    id,
    chemin: `/tmp/${id}`,
    nom: id,
    format: 'txt',
    taille: texte.length,
    modifieLe: '2026-09-25T00:00:00.000Z',
    texte,
    passages: passagesDuDocument(id, texte, 300)
  };
}

/** Moteur de décision scénarisé : la fonction fournie calcule chaque réponse. */
function moteurDecision(
  repondre: (etat: Etat, nom: string, question: Question) => Record<string, unknown>,
  horsMachine = false
): MoteurDecision & { appels: Etat[]; enCours: number; maxEnCours: number } {
  const moteur = {
    nom: 'scénario',
    modele: 'test',
    horsMachine,
    appels: [] as Etat[],
    enCours: 0,
    maxEnCours: 0,
    async decider(etat: Etat, questions: Record<string, Question>) {
      moteur.appels.push(etat);
      moteur.enCours++;
      moteur.maxEnCours = Math.max(moteur.maxEnCours, moteur.enCours);
      await new Promise((r) => setTimeout(r, 2));
      moteur.enCours--;
      const reponses = Object.fromEntries(
        Object.entries(questions).map(([nom, q]) => [nom, { type: q.type, ...repondre(etat, nom, q) }])
      );
      return { reponses: reponses as never, mesure: { ...nouvelleMesure('decision', moteur), appels: 1 } };
    }
  };
  return moteur;
}

function profilDe(decision: MoteurDecision, redaction: MoteurRedaction = new MoteurRedactionReference()): Profil {
  return { id: 'reference', libelle: 'test', decision, redaction };
}

const REGLAGES = fusionnerReglages(REGLAGES_PAR_DEFAUT, {
  classement: { seuilConfiance: 0.6, caracteresMax: 500 },
  recherche: { candidats: 10, resultats: 3 },
  resume: { caracteresParPartie: 1000 }
});

describe('triage d’un document', () => {
  it('traduit les trois décisions et marque « à vérifier » sous le seuil', async () => {
    const decision = moteurDecision((_etat, nom) => {
      if (nom === 'categorie') return { choix: 'facture', confiance: 0.55, probabilites: { facture: 0.55, devis: 0.45 } };
      if (nom === 'action') return { probabiliteOui: 0.9 };
      return { note: 1.8, confiance: 0.7, probabilites: [0.1, 0.1, 0.8] };
    });
    const texte = `Facture 41 : 1 250 euros à régler avant le 15 octobre. ${'Détail de la prestation. '.repeat(40)}`;
    const document = documentDe('facture.txt', texte);
    const triage = await trierDocument(document, profilDe(decision), REGLAGES);

    expect(triage).toMatchObject({
      documentId: 'facture.txt',
      categorie: 'facture',
      confiance: 0.55,
      actionRequise: true,
      probabiliteAction: 0.9,
      urgence: 1.8,
      aVerifier: true
    });
    expect(triage.mesures).toHaveLength(1);
    // Seuls les premiers caractères partent au moteur.
    expect(decision.appels[0]).toEqual({ fichier: 'facture.txt', extrait: texte.slice(0, 500) });
    expect(texte.length).toBeGreaterThan(500);
  });
});

describe('recherche', () => {
  const corpus = construireCorpus('/tmp', [
    documentDe('site.txt', 'Maintenance du site internet : mises à jour mensuelles.'),
    documentDe('devis.txt', 'Devis de maintenance du site : 180 euros par mois, hébergement compris.'),
    documentDe('reunion.txt', 'Réunion : le site sera mis en ligne en novembre.')
  ]);

  it('reclasse les passages selon la pertinence décidée', async () => {
    const decision = moteurDecision((etat) => ({
      probabiliteOui: JSON.stringify(etat).includes('180 euros') ? 0.95 : 0.1
    }));
    const recherche = await rechercher(corpus, 'combien coûte la maintenance du site', profilDe(decision), REGLAGES);

    expect(recherche.resultats[0]?.passage.documentId).toBe('devis.txt');
    expect(recherche.resultats[0]?.pertinence).toBe(0.95);
    expect(recherche.resultats.length).toBeLessThanOrEqual(3);
    expect(recherche.mesures).toHaveLength(decision.appels.length);
    expect(decision.maxEnCours).toBe(1);
  });

  it('interroge un moteur distant en parallèle, quatre passages à la fois au plus', async () => {
    const beaucoup = construireCorpus(
      '/tmp',
      Array.from({ length: 9 }, (_, i) => documentDe(`d${i}.txt`, `Maintenance du site, document ${i}.`))
    );
    const decision = moteurDecision(() => ({ probabiliteOui: 0.5 }), true);
    await rechercher(beaucoup, 'maintenance site', profilDe(decision), REGLAGES);
    expect(decision.appels).toHaveLength(9);
    expect(decision.maxEnCours).toBeGreaterThan(1);
    expect(decision.maxEnCours).toBeLessThanOrEqual(4);
  });

  it('ne fait aucun appel quand rien ne correspond', async () => {
    const decision = moteurDecision(() => ({ probabiliteOui: 1 }));
    const recherche = await rechercher(corpus, 'xylophone', profilDe(decision), REGLAGES);
    expect(recherche.resultats).toEqual([]);
    expect(decision.appels).toHaveLength(0);
  });
});

describe('résumé', () => {
  function redactionEspionne(): MoteurRedaction & { messages: string[] } {
    const moteur = {
      nom: 'espion',
      modele: 'test',
      horsMachine: false,
      messages: [] as string[],
      async rediger(message: { utilisateur: string }) {
        moteur.messages.push(message.utilisateur);
        return { texte: `résumé ${moteur.messages.length}`, mesure: nouvelleMesure('redaction', moteur) };
      }
    };
    return moteur;
  }

  it('résume un document court en un appel', async () => {
    const redaction = redactionEspionne();
    const resume = await resumerDocument(documentDe('court.txt', 'Contrat de douze mois.'), profilDe(moteurDecision(() => ({})), redaction), REGLAGES);
    expect(resume).toMatchObject({ texte: 'résumé 1', parties: 1 });
    expect(redaction.messages[0]).toContain('« court.txt »');
    expect(redaction.messages[0]).toContain('Contrat de douze mois.');
  });

  it('résume un long document par parties puis synthétise', async () => {
    const redaction = redactionEspionne();
    const long = Array.from({ length: 30 }, (_, i) => `Paragraphe ${i} : une information importante sur le projet.`).join('\n\n');
    const resume = await resumerDocument(documentDe('long.txt', long), profilDe(moteurDecision(() => ({})), redaction), REGLAGES);
    expect(resume.parties).toBeGreaterThan(1);
    expect(resume.mesures).toHaveLength(resume.parties + 1);
    expect(redaction.messages.at(-1)).toContain('Voici les notes prises partie par partie');
    expect(resume.texte).toBe(`résumé ${resume.parties + 1}`);
  });

  it('refuse un document vide', async () => {
    const profil = profilDe(moteurDecision(() => ({})), redactionEspionne());
    await expect(resumerDocument(documentDe('vide.txt', '  '), profil, REGLAGES)).rejects.toThrow(ErreurMoteur);
  });
});

describe('profils', () => {
  it('le mode local pilote Ollama avec les modèles réglés', () => {
    const profil = creerProfil('local', { reglages: REGLAGES_PAR_DEFAUT, secrets: {} });
    expect(profil.decision.nom).toBe('Ollama');
    expect(profil.decision.modele).toBe('qwen3:8b');
    expect(profil.decision.horsMachine).toBe(false);
  });

  it('le mode hybride exige une clé OpenRouter', () => {
    expect(() => creerProfil('hybride', { reglages: REGLAGES_PAR_DEFAUT, secrets: {} })).toThrow(/Clé OpenRouter manquante/);
  });

  it('le mode hybride associe Jev et OpenRouter', () => {
    const profil = creerProfil('hybride', { reglages: REGLAGES_PAR_DEFAUT, secrets: { cleOpenRouter: 'k' } });
    expect(profil.decision.nom).toBe('Jev via OpenRouter');
    expect(profil.redaction.modele).toBe('~anthropic/claude-sonnet-latest');
    expect(profil.decision.horsMachine && profil.redaction.horsMachine).toBe(true);
  });

  it('Jev en direct demande une clé TypeSafe', () => {
    const reglages = fusionnerReglages(REGLAGES_PAR_DEFAUT, { jev: { acces: 'typesafe' } });
    expect(() => creerProfil('hybride', { reglages, secrets: { cleOpenRouter: 'k' } })).toThrow(/Clé TypeSafe manquante/);
  });
});
