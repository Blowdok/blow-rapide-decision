// Questions posées au moteur de décision. Les mêmes servent à l'agent et au
// banc de comparaison : chaque mode répond exactement aux mêmes questions.

import type { Categorie, Question } from '../../partage/types';

/** Triage d'un document : catégorie, action attendue, urgence. */
export function questionsTriage(categories: readonly Categorie[]): Record<string, Question> {
  return {
    categorie: {
      type: 'choix',
      consigne: 'De quel type de document s’agit-il ?',
      options: Object.fromEntries(categories.map((c) => [c.id, `${c.libelle} : ${c.description}`]))
    },
    action: {
      type: 'oui-non',
      consigne: 'Ce document demande-t-il une action à son destinataire ?',
      criteres: {
        oui: 'Il faut payer, répondre, signer, envoyer une pièce ou respecter une échéance.',
        non: 'Document d’information ou d’archive : rien à faire.'
      }
    },
    urgence: {
      type: 'note',
      consigne: 'Quelle est l’urgence de ce document pour son destinataire ?',
      echelle: [
        'Aucune urgence : rien à faire, ou pas de délai.',
        'À traiter dans les semaines qui viennent : délai raisonnable ou échéance lointaine.',
        'Urgent : échéance dans les jours qui viennent, relance, mise en demeure ou pénalités.'
      ]
    }
  };
}

/** Pertinence d'un passage pour une requête. */
export function questionPertinence(requete: string): Question {
  return {
    type: 'oui-non',
    consigne: `Ce passage aide-t-il à répondre à la requête « ${requete} » ?`,
    criteres: {
      oui: `Le passage contient une information utile pour la requête « ${requete} ».`,
      non: 'Le passage parle d’autre chose ou ne permet pas de répondre.'
    }
  };
}
