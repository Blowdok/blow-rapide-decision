// État partagé de l'interface : réglages, dossier indexé, progression en cours.

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { EtatCorpus, EtatReglages, Progression } from '../../partage/contrat';
import type { ReglagesPartiels } from '../../partage/reglages';
import { api } from './api';

interface ContexteApplication {
  etat: EtatReglages | null;
  enregistrerReglages(partiel: ReglagesPartiels): Promise<EtatReglages>;
  definirEtat(etat: EtatReglages): void;
  corpus: EtatCorpus | null;
  definirCorpus(corpus: EtatCorpus | null): void;
  rafraichirCorpus(): Promise<void>;
  progression: Progression | null;
  erreurDemarrage: string | null;
}

const Contexte = createContext<ContexteApplication | null>(null);

export function FournisseurApplication({ children }: { children: ReactNode }) {
  const [etat, definirEtat] = useState<EtatReglages | null>(null);
  const [corpus, definirCorpus] = useState<EtatCorpus | null>(null);
  const [progression, definirProgression] = useState<Progression | null>(null);
  const [erreurDemarrage, definirErreurDemarrage] = useState<string | null>(null);

  useEffect(() => {
    api.reglages
      .lire()
      .then(definirEtat)
      .catch((e: unknown) => definirErreurDemarrage(String(e)));
    api.dossier.etat().then(definirCorpus, () => definirCorpus(null));
    return api.surProgression(definirProgression);
  }, []);

  const enregistrerReglages = useCallback(async (partiel: ReglagesPartiels) => {
    const nouvel = await api.reglages.enregistrer(partiel);
    definirEtat(nouvel);
    return nouvel;
  }, []);

  const rafraichirCorpus = useCallback(async () => {
    definirCorpus(await api.dossier.etat());
  }, []);

  const valeur = useMemo(
    () => ({
      etat,
      enregistrerReglages,
      definirEtat,
      corpus,
      definirCorpus,
      rafraichirCorpus,
      progression,
      erreurDemarrage
    }),
    [etat, enregistrerReglages, corpus, rafraichirCorpus, progression, erreurDemarrage]
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useApplication(): ContexteApplication {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error('useApplication doit être utilisé dans FournisseurApplication.');
  return contexte;
}
