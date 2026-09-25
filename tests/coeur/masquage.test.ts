import { describe, expect, it } from 'vitest';
import { avecMasquageDecision, avecMasquageRedaction, Pseudonymiseur } from '../../src/coeur/confidentialite/masquage';
import { MoteurDecisionReference } from '../../src/coeur/moteurs/reference';
import type { MoteurDecision, MoteurRedaction } from '../../src/coeur/moteurs/types';
import { nouvelleMesure } from '../../src/coeur/moteurs/types';

const TEXTE =
  'Contact : jeanne.martin@exemple.fr ou 06 12 34 56 78 (+33 6 98 76 54 32). ' +
  'IBAN FR76 3000 6000 0112 3456 7890 189. Carte 4970 1012 3456 7893. ' +
  'N° de sécurité sociale 2 85 05 78 006 084 36. Référence 2026-041, montant 1 250 €.';

describe('pseudonymisation', () => {
  it('remplace les identifiants personnels par des marqueurs', () => {
    const masque = new Pseudonymiseur().masquer(TEXTE);
    expect(masque).toContain('[EMAIL_1]');
    expect(masque).toContain('[TELEPHONE_1]');
    expect(masque).toContain('[TELEPHONE_2]');
    expect(masque).toContain('[IBAN_1]');
    expect(masque).toContain('[CARTE_1]');
    expect(masque).toContain('[NIR_1]');
    for (const fuite of ['jeanne.martin', '06 12 34', 'FR76', '4970', '2 85 05']) expect(masque).not.toContain(fuite);
    // Les informations utiles au classement restent lisibles.
    expect(masque).toContain('Référence 2026-041, montant 1 250 €.');
  });

  it('ne masque pas une suite de chiffres qui n’est pas une carte valide', () => {
    expect(new Pseudonymiseur().masquer('Commande 1234 5678 9012 3456')).toBe('Commande 1234 5678 9012 3456');
  });

  it('donne le même marqueur à la même valeur et restaure le texte', () => {
    const pseudo = new Pseudonymiseur();
    const masque = pseudo.masquer('a@b.fr puis a@b.fr puis c@d.fr');
    expect(masque).toBe('[EMAIL_1] puis [EMAIL_1] puis [EMAIL_2]');
    expect(pseudo.nombre).toBe(2);
    expect(pseudo.restaurer('Écrire à [EMAIL_2] et [EMAIL_9].')).toBe('Écrire à c@d.fr et [EMAIL_9].');
  });

  it('masque en profondeur un état JSON', () => {
    const etat = new Pseudonymiseur().masquerEtat({ fichier: 'x.txt', lignes: ['tel 0612345678', { mail: 'a@b.fr' }] });
    expect(etat).toEqual({ fichier: 'x.txt', lignes: ['tel [TELEPHONE_1]', { mail: '[EMAIL_1]' }] });
  });
});

describe('enveloppes de masquage', () => {
  it('le moteur de décision distant ne reçoit que des données masquées', async () => {
    const recus: unknown[] = [];
    const reference = new MoteurDecisionReference();
    const espion: MoteurDecision = {
      nom: 'espion',
      modele: 'm',
      horsMachine: true,
      decider: async (etat, questions) => {
        recus.push(etat, questions);
        return reference.decider(etat, questions);
      }
    };
    const { mesure } = await avecMasquageDecision(espion).decider(
      { texte: 'Écrire à a@b.fr' },
      { q: { type: 'oui-non', consigne: 'Le passage parle-t-il de a@b.fr ?' } }
    );
    expect(JSON.stringify(recus)).not.toContain('a@b.fr');
    expect(JSON.stringify(recus)).toContain('[EMAIL_1]');
    expect(mesure.elementsMasques).toBe(1);
  });

  it('le moteur de rédaction distant voit des marqueurs, Blowdok lit les vraies valeurs', async () => {
    let recu = '';
    const espion: MoteurRedaction = {
      nom: 'espion',
      modele: 'm',
      horsMachine: true,
      rediger: async (message) => {
        recu = message.utilisateur;
        return { texte: 'Payer avant le 15/10 : IBAN [IBAN_1].', mesure: nouvelleMesure('redaction', espion) };
      }
    };
    const { texte, mesure } = await avecMasquageRedaction(espion).rediger({
      systeme: 's',
      utilisateur: 'Résume : virement sur FR76 3000 6000 0112 3456 7890 189',
      source: 'virement sur FR76 3000 6000 0112 3456 7890 189'
    });
    expect(recu).toBe('Résume : virement sur [IBAN_1]');
    expect(texte).toBe('Payer avant le 15/10 : IBAN FR76 3000 6000 0112 3456 7890 189.');
    expect(mesure.elementsMasques).toBe(1);
  });
});
