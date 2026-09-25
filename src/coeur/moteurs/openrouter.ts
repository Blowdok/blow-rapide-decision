// Moteur de rédaction cloud par OpenRouter (API compatible chat completions).
// OpenRouter renvoie le coût réel de chaque appel dans `usage.cost` (en dollars).

import {
  depuis,
  ErreurMoteur,
  type MessageRedaction,
  type MoteurRedaction,
  nouvelleMesure,
  type OptionsAppel,
  type ResultatRedaction
} from './types';

export const URL_OPENROUTER = 'https://openrouter.ai/api/v1';

export interface OptionsOpenRouter {
  cle: string;
  modele: string;
  /** Exclut les fournisseurs qui conservent ou réutilisent les requêtes. */
  refuserCollecte?: boolean;
  /** N'accepte que des fournisseurs à rétention nulle (ZDR). */
  exigerZdr?: boolean;
  delaiMs?: number;
  /** Nouvelles tentatives sur 429 et 5xx. */
  tentatives?: number;
  /** Pause de base entre deux tentatives, doublée à chaque essai (1 s par défaut). */
  pauseMs?: number;
  url?: string;
  fetch?: typeof fetch;
}

interface ReponseChat {
  model?: string;
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> | null };
    finish_reason?: string;
    error?: { message?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number | string };
}

/** Message lisible pour un statut HTTP d'OpenRouter. */
export function messageErreurOpenRouter(statut: number, detail: string): string {
  switch (statut) {
    case 401:
    case 403:
      return `OpenRouter refuse la requête (${statut}) : vérifiez la clé API. ${detail}`.trim();
    case 402:
      return 'Crédit OpenRouter insuffisant (402) : rechargez le compte ou relevez la limite de la clé.';
    case 404:
      return `Modèle ou fournisseur introuvable sur OpenRouter (404). ${detail}`.trim();
    case 429:
      return 'Trop de requêtes vers OpenRouter (429). Réessayez dans un instant.';
    default:
      return `Erreur OpenRouter (${statut}) : ${detail}`.trim();
  }
}

function attendre(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(resoudre, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(minuteur);
        rejeter(signal.reason);
      },
      { once: true }
    );
  });
}

function texteDuMessage(contenu: string | Array<{ type?: string; text?: string }> | null | undefined): string {
  if (typeof contenu === 'string') return contenu;
  return (contenu ?? []).map((partie) => partie.text ?? '').join('');
}

export class MoteurRedactionOpenRouter implements MoteurRedaction {
  readonly nom = 'OpenRouter';
  readonly modele: string;
  readonly horsMachine = true;
  readonly #options: OptionsOpenRouter;

  constructor(options: OptionsOpenRouter) {
    if (!options.cle) throw new ErreurMoteur('Clé OpenRouter manquante pour les résumés en mode hybride.');
    this.#options = options;
    this.modele = options.modele;
  }

  async rediger(message: MessageRedaction, options: OptionsAppel & { maxJetons?: number } = {}): Promise<ResultatRedaction> {
    const corps = {
      model: this.modele,
      messages: [
        { role: 'system', content: message.systeme },
        { role: 'user', content: message.utilisateur }
      ],
      temperature: 0.2,
      max_tokens: options.maxJetons ?? 800,
      provider: {
        data_collection: this.#options.refuserCollecte === false ? 'allow' : 'deny',
        ...(this.#options.exigerZdr ? { zdr: true } : {})
      }
    };
    const mesure = nouvelleMesure('redaction', this);
    mesure.caracteresEnvoyes = message.systeme.length + message.utilisateur.length;
    const debut = performance.now();
    const reponse = await this.#appeler(corps, options.signal);
    mesure.dureeMs = depuis(debut);
    mesure.appels = 1;
    mesure.jetonsEntree = reponse.usage?.prompt_tokens ?? 0;
    mesure.jetonsSortie = reponse.usage?.completion_tokens ?? 0;
    mesure.coutUsd = reponse.usage?.cost ?? 0;
    if (reponse.model) mesure.modele = reponse.model;

    const choix = reponse.choices?.[0];
    if (choix?.finish_reason === 'error') {
      throw new ErreurMoteur(`Le fournisseur a échoué pendant la rédaction : ${choix.error?.message ?? 'erreur inconnue'}.`);
    }
    const texte = texteDuMessage(choix?.message?.content).trim();
    if (!texte) throw new ErreurMoteur('OpenRouter a renvoyé un texte vide.');
    return { texte, mesure };
  }

  async #appeler(corps: object, signal?: AbortSignal): Promise<ReponseChat> {
    const tentatives = this.#options.tentatives ?? 2;
    const pause = this.#options.pauseMs ?? 1000;
    const url = `${(this.#options.url ?? URL_OPENROUTER).replace(/\/+$/, '')}/chat/completions`;
    for (let essai = 0; ; essai++) {
      const delai = AbortSignal.timeout(this.#options.delaiMs ?? 120_000);
      let reponse: Response;
      try {
        reponse = await (this.#options.fetch ?? fetch)(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.#options.cle}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corps),
          signal: signal ? AbortSignal.any([signal, delai]) : delai
        });
      } catch (erreur) {
        if (signal?.aborted) throw erreur;
        if (essai < tentatives) {
          await attendre(pause * 2 ** essai, signal);
          continue;
        }
        const raison = delai.aborted ? "n’a pas répondu à temps" : 'est injoignable : vérifiez le réseau';
        throw new ErreurMoteur(`OpenRouter ${raison}.`, { cause: erreur });
      }
      const texte = await reponse.text();
      if (reponse.ok) {
        try {
          return JSON.parse(texte) as ReponseChat;
        } catch (erreur) {
          throw new ErreurMoteur('Réponse illisible d’OpenRouter.', { cause: erreur });
        }
      }
      const reessayable = reponse.status === 429 || reponse.status >= 500;
      if (reessayable && essai < tentatives) {
        const apres = Number(reponse.headers.get('retry-after'));
        await attendre(Number.isFinite(apres) && apres > 0 ? Math.min(apres, 30) * 1000 : pause * 2 ** essai, signal);
        continue;
      }
      let detail = texte.slice(0, 300);
      try {
        detail = (JSON.parse(texte) as ReponseChat).error?.message ?? detail;
      } catch {
        // Corps non JSON : on garde le début du texte.
      }
      throw new ErreurMoteur(messageErreurOpenRouter(reponse.status, detail));
    }
  }
}

export interface EtatCleOpenRouter {
  /** Crédit restant sur la clé, ou `null` si elle n'a pas de limite. */
  creditRestant: number | null;
  consommationMois: number;
}

/** Vérifie une clé OpenRouter (API /key) sans consommer de crédit. */
export async function verifierCleOpenRouter(cle: string, fetchFn: typeof fetch = fetch): Promise<EtatCleOpenRouter> {
  let reponse: Response;
  try {
    reponse = await fetchFn(`${URL_OPENROUTER}/key`, {
      headers: { Authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (erreur) {
    throw new ErreurMoteur('OpenRouter est injoignable : vérifiez le réseau.', { cause: erreur });
  }
  if (!reponse.ok) throw new ErreurMoteur(messageErreurOpenRouter(reponse.status, ''));
  const { data } = (await reponse.json()) as { data?: { limit_remaining?: number | null; usage_monthly?: number } };
  return { creditRestant: data?.limit_remaining ?? null, consommationMois: data?.usage_monthly ?? 0 };
}
