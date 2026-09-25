import { describe, expect, it } from 'vitest';
import { MoteurDecisionReference, MoteurRedactionReference, resumeExtractif } from '../../src/coeur/moteurs/reference';
import { lireChoix, lireNote, lireOuiNon } from '../../src/coeur/moteurs/types';

describe('moteur de décision de référence', () => {
  const moteur = new MoteurDecisionReference();

  it('choisit l’option dont les mots apparaissent dans le document', async () => {
    const { reponses } = await moteur.decider(
      { extrait: 'Facture n° 41 : montant à payer 1 250 euros, paiement à réception.' },
      {
        categorie: {
          type: 'choix',
          consigne: 'Type de document ?',
          options: { facture: 'Demande de paiement, montant à payer', contrat: 'Engagement signé entre parties' }
        }
      }
    );
    const categorie = lireChoix(reponses, 'categorie');
    expect(categorie.choix).toBe('facture');
    expect(categorie.probabilites.facture).toBeGreaterThan(categorie.probabilites.contrat ?? 1);
  });

  it('donne une probabilité de oui plus forte quand les critères du oui se retrouvent', async () => {
    const question = {
      type: 'oui-non' as const,
      consigne: 'Faut-il agir ?',
      criteres: { oui: 'Il faut payer ou répondre avant une échéance.', non: 'Simple information, rien à faire.' }
    };
    const aPayer = await moteur.decider('Merci de payer avant l’échéance du 15 octobre.', { action: question });
    const info = await moteur.decider('Pour information, rien à faire de votre côté.', { action: question });
    expect(lireOuiNon(aPayer.reponses, 'action').probabiliteOui).toBeGreaterThan(0.5);
    expect(lireOuiNon(info.reponses, 'action').probabiliteOui).toBeLessThan(0.5);
  });

  it('renvoie une note attendue entre les niveaux de l’échelle', async () => {
    const { reponses, mesure } = await moteur.decider('Mise en demeure : pénalités dès demain.', {
      urgence: { type: 'note', consigne: 'Urgence ?', echelle: ['Aucune urgence', 'Délai raisonnable', 'Mise en demeure, pénalités'] }
    });
    const urgence = lireNote(reponses, 'urgence');
    expect(urgence.note).toBeGreaterThan(1);
    expect(urgence.probabilites.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(mesure).toMatchObject({ horsMachine: false, coutUsd: 0 });
  });
});

describe('résumé extractif', () => {
  it('garde les phrases porteuses de chiffres, dans l’ordre du texte', () => {
    const source = [
      'Bonjour, nous revenons vers vous au sujet de votre dossier.',
      'Le montant total de la facture est de 1 250 euros.',
      'Nous vous remercions de votre confiance.',
      'Le paiement est attendu avant le 15 octobre 2026.'
    ].join(' ');
    const resume = resumeExtractif(source, 2);
    expect(resume).toBe(
      '- Le montant total de la facture est de 1 250 euros.\n- Le paiement est attendu avant le 15 octobre 2026.'
    );
  });

  it('le moteur de rédaction résume la source fournie', async () => {
    const { texte, mesure } = await new MoteurRedactionReference().rediger({
      systeme: '',
      utilisateur: '',
      source: 'Contrat de maintenance signé pour douze mois. Le prix annuel est de 2 400 euros HT.'
    });
    expect(texte).toContain('2 400 euros');
    expect(mesure.operation).toBe('redaction');
  });
});
