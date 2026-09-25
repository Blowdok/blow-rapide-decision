// Pseudonymisation réversible avant tout envoi hors de la machine.
//
// Les identifiants structurés (courriel, téléphone, IBAN, carte bancaire,
// numéro de sécurité sociale) sont remplacés par des marqueurs comme
// « [EMAIL_1] » ; les marqueurs présents dans un texte généré sont ensuite
// remplacés par les valeurs d'origine, sur la machine.
//
// Limite assumée : noms de personnes et adresses postales ne sont pas détectés.

import type { Etat, Question, ValeurJson } from '../../partage/types';
import type { MessageRedaction, MoteurDecision, MoteurRedaction, OptionsAppel } from '../moteurs/types';

export type TypeDonnee = 'IBAN' | 'CARTE' | 'NIR' | 'EMAIL' | 'TELEPHONE';

/** Algorithme de Luhn, pour ne masquer que de vrais numéros de carte. */
function luhnValide(chiffres: string): boolean {
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let n = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

// L'ordre compte : les motifs longs passent avant ceux qu'ils contiennent.
const MOTIFS: Array<{ type: TypeDonnee; motif: RegExp; valide?: (valeur: string) => boolean }> = [
  { type: 'EMAIL', motif: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'IBAN', motif: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g },
  {
    type: 'CARTE',
    motif: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
    valide: (valeur) => luhnValide(valeur.replace(/\D/g, ''))
  },
  { type: 'NIR', motif: /\b[12] ?\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\d) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3}(?: ?\d{2})?\b/g },
  { type: 'TELEPHONE', motif: /(?:\+33 ?|0033 ?|\b0)[1-9](?:[ .-]?\d{2}){4}\b/g }
];

export class Pseudonymiseur {
  readonly #versOriginal = new Map<string, string>();
  readonly #versMarqueur = new Map<string, string>();
  readonly #compteurs = new Map<TypeDonnee, number>();

  /** Nombre de valeurs distinctes remplacées. */
  get nombre(): number {
    return this.#versOriginal.size;
  }

  masquer(texte: string): string {
    let resultat = texte;
    for (const { type, motif, valide } of MOTIFS) {
      resultat = resultat.replace(motif, (valeur) => {
        if (valide && !valide(valeur)) return valeur;
        const existant = this.#versMarqueur.get(valeur);
        if (existant) return existant;
        const numero = (this.#compteurs.get(type) ?? 0) + 1;
        this.#compteurs.set(type, numero);
        const marqueur = `[${type}_${numero}]`;
        this.#versMarqueur.set(valeur, marqueur);
        this.#versOriginal.set(marqueur, valeur);
        return marqueur;
      });
    }
    return resultat;
  }

  /** Masque toutes les chaînes d'un état JSON, clés comprises. */
  masquerEtat(etat: Etat): Etat {
    const parcourir = (valeur: ValeurJson): ValeurJson => {
      if (typeof valeur === 'string') return this.masquer(valeur);
      if (Array.isArray(valeur)) return valeur.map(parcourir);
      if (valeur && typeof valeur === 'object') {
        return Object.fromEntries(Object.entries(valeur).map(([cle, v]) => [this.masquer(cle), parcourir(v)]));
      }
      return valeur;
    };
    return parcourir(etat) as Etat;
  }

  masquerQuestion(question: Question): Question {
    switch (question.type) {
      case 'oui-non':
        return {
          ...question,
          consigne: this.masquer(question.consigne),
          ...(question.criteres
            ? {
                criteres: {
                  ...(question.criteres.oui !== undefined ? { oui: this.masquer(question.criteres.oui) } : {}),
                  ...(question.criteres.non !== undefined ? { non: this.masquer(question.criteres.non) } : {})
                }
              }
            : {})
        };
      case 'choix':
        // Les étiquettes restent intactes : ce sont les clés des réponses.
        return {
          ...question,
          consigne: this.masquer(question.consigne),
          options: Object.fromEntries(
            Object.entries(question.options).map(([e, d]) => [e, d === null ? null : this.masquer(d)])
          )
        };
      case 'note':
        return { ...question, consigne: this.masquer(question.consigne), echelle: question.echelle.map((n) => this.masquer(n)) };
    }
  }

  /** Remet les valeurs d'origine à la place des marqueurs connus. */
  restaurer(texte: string): string {
    return texte.replace(/\[(?:IBAN|CARTE|NIR|EMAIL|TELEPHONE)_\d+\]/g, (marqueur) => this.#versOriginal.get(marqueur) ?? marqueur);
  }
}

/** Enveloppe un moteur de décision distant : l'état et les questions partent masqués. */
export function avecMasquageDecision(moteur: MoteurDecision): MoteurDecision {
  return {
    nom: moteur.nom,
    modele: moteur.modele,
    horsMachine: moteur.horsMachine,
    async decider(etat, questions, options?: OptionsAppel) {
      const pseudo = new Pseudonymiseur();
      const etatMasque = pseudo.masquerEtat(etat);
      const questionsMasquees = Object.fromEntries(
        Object.entries(questions).map(([nom, q]) => [nom, pseudo.masquerQuestion(q)])
      );
      const resultat = await moteur.decider(etatMasque, questionsMasquees, options);
      resultat.mesure.elementsMasques = pseudo.nombre;
      return resultat;
    }
  };
}

/** Enveloppe un moteur de rédaction distant : envoi masqué, texte restauré au retour. */
export function avecMasquageRedaction(moteur: MoteurRedaction): MoteurRedaction {
  return {
    nom: moteur.nom,
    modele: moteur.modele,
    horsMachine: moteur.horsMachine,
    async rediger(message: MessageRedaction, options) {
      const pseudo = new Pseudonymiseur();
      const masque: MessageRedaction = {
        systeme: pseudo.masquer(message.systeme),
        utilisateur: pseudo.masquer(message.utilisateur),
        source: pseudo.masquer(message.source)
      };
      const resultat = await moteur.rediger(masque, options);
      return {
        texte: pseudo.restaurer(resultat.texte),
        mesure: { ...resultat.mesure, elementsMasques: pseudo.nombre }
      };
    }
  };
}
