// Consignes de rédaction des résumés, en français.

export const SYSTEME_RESUME =
  'Tu es l’assistant documentaire de Blowdok. Tu résumes fidèlement des documents professionnels, en français. ' +
  'Tu n’inventes rien : une information absente du document n’apparaît pas dans le résumé. ' +
  'Tu recopies à l’identique montants, dates, références et marqueurs entre crochets comme [EMAIL_1].';

const FORMAT_RESUME =
  'en 3 à 6 puces courtes et factuelles : nature du document, parties concernées, montants, dates et échéances, ' +
  'obligations ou actions attendues. Termine par une ligne « À retenir : » d’une phrase.';

export function promptResume(nom: string, texte: string): string {
  return `Résume le document « ${nom} » ${FORMAT_RESUME}\n\nDocument :\n<<<\n${texte}\n>>>`;
}

export function promptNotesPartie(nom: string, position: number, total: number, texte: string): string {
  return (
    `Voici la partie ${position}/${total} du document « ${nom} ». ` +
    'Relève en puces les informations factuelles importantes : montants, dates, parties, obligations.' +
    `\n\n<<<\n${texte}\n>>>`
  );
}

export function promptSynthese(nom: string, notes: string): string {
  return (
    `Voici les notes prises partie par partie sur le document « ${nom} ». ` +
    `À partir de ces seules notes, résume le document ${FORMAT_RESUME}\n\nNotes :\n<<<\n${notes}\n>>>`
  );
}
