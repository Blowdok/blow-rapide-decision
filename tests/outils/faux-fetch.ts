// Doublure de `fetch` : renvoie des réponses préparées et garde trace des appels.

export interface AppelEnregistre {
  url: string;
  methode: string;
  entetes: Record<string, string>;
  corps: unknown;
}

type Prevue = Response | Error | ((appel: AppelEnregistre) => Response);

export function reponseJson(corps: unknown, statut = 200, entetes: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'content-type': 'application/json', ...entetes }
  });
}

/** Chaque appel consomme la réponse suivante ; la dernière est réutilisée si besoin. */
export function fauxFetch(...prevues: Prevue[]): { fetch: typeof fetch; appels: AppelEnregistre[] } {
  const appels: AppelEnregistre[] = [];
  const faux = async (entree: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const entetes: Record<string, string> = {};
    new Headers(init.headers).forEach((valeur, cle) => {
      entetes[cle] = valeur;
    });
    const texte = typeof init.body === 'string' ? init.body : undefined;
    const appel: AppelEnregistre = {
      url: String(entree),
      methode: init.method ?? 'GET',
      entetes,
      corps: texte === undefined ? undefined : JSON.parse(texte)
    };
    appels.push(appel);
    const prevue = prevues[Math.min(appels.length - 1, prevues.length - 1)];
    if (prevue === undefined) throw new Error('Aucune réponse prévue.');
    if (prevue instanceof Error) throw prevue;
    const reponse = typeof prevue === 'function' ? prevue(appel) : prevue;
    return reponse.clone();
  };
  return { fetch: faux as typeof fetch, appels };
}
