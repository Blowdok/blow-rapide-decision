// État partagé de l'interface : réglages, dossier ouvert, progression en cours,
// écran affiché (chaque écran peut renvoyer vers un autre, l'aide comprise).

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { EtatCorpus, EtatReglages, Progression } from '../../partage/contrat';
import type { ReglagesPartiels } from '../../partage/reglages';
import { api } from './api';

export type Ecran = 'documents' | 'recherche' | 'comparaison' | 'reglages' | 'aide';

interface ContexteApplication {
  etat: EtatReglages | null;
  enregistrerReglages(partiel: ReglagesPartiels): Promise<EtatReglages>;
  definirEtat(etat: EtatReglages): void;
  corpus: EtatCorpus | null;
  definirCorpus(corpus: EtatCorpus | null): void;
  rafraichirCorpus(): Promise<void>;
  progression: Progression | null;
  erreurDemarrage: string | null;
  ecran: Ecran;
  /** Affiche un écran ; pour l'aide, `sujet` ouvre la question voulue. */
  allerA(ecran: Ecran, sujet?: string): void;
  sujetAide: string | null;
}

const Contexte = createContext<ContexteApplication | null>(null);

export function FournisseurApplication({ children }: { children: ReactNode }) {
  const [etat, definirEtat] = useState<EtatReglages | null>(null);
  const [corpus, definirCorpus] = useState<EtatCorpus | null>(null);
  const [progression, definirProgression] = useState<Progression | null>(null);
  const [erreurDemarrage, definirErreurDemarrage] = useState<string | null>(null);
  const [ecran, definirEcran] = useState<Ecran>('documents');
  const [sujetAide, definirSujetAide] = useState<string | null>(null);

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

  const allerA = useCallback((cible: Ecran, sujet?: string) => {
    definirSujetAide(cible === 'aide' ? (sujet ?? null) : null);
    definirEcran(cible);
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
      erreurDemarrage,
      ecran,
      allerA,
      sujetAide
    }),
    [etat, enregistrerReglages, corpus, rafraichirCorpus, progression, erreurDemarrage, ecran, allerA, sujetAide]
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useApplication(): ContexteApplication {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error('useApplication doit être utilisé dans FournisseurApplication.');
  return contexte;
}
