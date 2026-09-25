// Lecture OCR facultative des pages scannées, par un modèle de vision d'Ollama
// (API /api/chat, image jointe au message). L'image ne quitte pas la machine
// tant qu'Ollama tourne en local.

import type { Mesure } from '../../partage/types';
import { appelerOllama, estAdresseLocale, type OptionsOllama } from './ollama';
import { depuis, nouvelleMesure, type OptionsAppel } from './types';

export interface ResultatLecture {
  texte: string;
  mesure: Mesure;
}

export interface LecteurOcr {
  readonly nom: string;
  readonly modele: string;
  readonly horsMachine: boolean;
  /** Transcrit le texte d'une page, fournie en PNG. */
  lire(png: Uint8Array, options?: OptionsAppel): Promise<ResultatLecture>;
}

/** Consigne en français : une consigne en anglais pousse les petits modèles à traduire. */
export const CONSIGNE_OCR =
  'Transcris fidèlement tout le texte de cette page numérisée, dans l’ordre de lecture, sans traduire ni résumer. ' +
  'Recopie les nombres, les dates et les montants exactement comme ils sont écrits. ' +
  'Réponds uniquement par le texte de la page, sans commentaire.';

/** Jetons produits au plus pour une page : une page dense en français en compte environ 1 500. */
const JETONS_PAR_PAGE = 3000;

/** Retire l'habillage que certains modèles ajoutent autour de la transcription. */
export function nettoyerTranscription(texte: string): string {
  const sansBalises = texte.trim().replace(/^```[\w-]*\s*\n?([\s\S]*?)\n?```$/, '$1');
  return sansBalises.trim();
}

export class LecteurOcrOllama implements LecteurOcr {
  readonly nom = 'Ollama';
  readonly modele: string;
  readonly horsMachine: boolean;
  readonly #options: OptionsOllama;

  constructor(options: OptionsOllama) {
    this.#options = options;
    this.modele = options.modele;
    this.horsMachine = !estAdresseLocale(options.url);
  }

  async lire(png: Uint8Array, options: OptionsAppel = {}): Promise<ResultatLecture> {
    const mesure = nouvelleMesure('ocr', this);
    const debut = performance.now();
    const image = Buffer.from(png.buffer, png.byteOffset, png.byteLength).toString('base64');
    const reponse = await appelerOllama(
      this.#options,
      {
        model: this.modele,
        messages: [{ role: 'user', content: CONSIGNE_OCR, images: [image] }],
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: JETONS_PAR_PAGE, num_ctx: this.#options.contexte ?? 8192 }
      },
      options.signal
    );
    mesure.dureeMs = depuis(debut);
    mesure.appels = 1;
    mesure.jetonsEntree = reponse.prompt_eval_count ?? 0;
    mesure.jetonsSortie = reponse.eval_count ?? 0;
    // Hors de la machine, l'image part avec la consigne : on compte ses caractères en base64.
    if (this.horsMachine) mesure.caracteresEnvoyes = CONSIGNE_OCR.length + image.length;
    return { texte: nettoyerTranscription(reponse.message?.content ?? ''), mesure };
  }
}
