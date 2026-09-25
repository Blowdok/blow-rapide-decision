import { useLayoutEffect, useRef, useState } from 'react';
import { PROFILS, type Theme, THEMES } from '../../partage/reglages';
import type { IdProfil } from '../../partage/types';
import { messageErreur } from './api';
import { Message } from './composants';
import { type Ecran, useApplication } from './contexte';
import { EcranAide } from './ecrans/Aide';
import { EcranComparaison } from './ecrans/Comparaison';
import { EcranDocuments } from './ecrans/Documents';
import { EcranRecherche } from './ecrans/Recherche';
import { EcranReglages } from './ecrans/Reglages';

const ONGLETS: Array<{ id: Ecran; libelle: string; aide: string }> = [
  { id: 'documents', libelle: 'Documents', aide: 'Classer et résumer vos fichiers' },
  { id: 'recherche', libelle: 'Recherche', aide: 'Poser une question' },
  { id: 'comparaison', libelle: 'Comparaison', aide: 'Choisir entre local et hybride' },
  { id: 'reglages', libelle: 'Réglages', aide: 'Clés, options, préférences' },
  { id: 'aide', libelle: 'Aide', aide: 'Premiers pas et questions' }
];

/** Où vont les données dans le mode choisi. */
function Confidentialite() {
  const { etat } = useApplication();
  if (!etat) return null;
  const { profil, confidentialite } = etat.reglages;
  if (profil === 'local') return <span className="confidentialite confidentialite-locale">Tout reste sur ce PC</span>;
  if (profil === 'reference') return <span className="confidentialite">Hors ligne, sans IA</span>;
  return confidentialite.masquage ? (
    <span className="confidentialite confidentialite-distante">Extraits envoyés à OpenRouter et Jev · données personnelles masquées</span>
  ) : (
    <span className="confidentialite confidentialite-risque">Extraits envoyés sans masquage</span>
  );
}

function SelecteurMode() {
  const { etat, enregistrerReglages, allerA } = useApplication();
  const [erreur, definirErreur] = useState<string | null>(null);
  if (!etat) return null;
  const changer = async (profil: IdProfil) => {
    definirErreur(null);
    try {
      await enregistrerReglages({ profil });
    } catch (e) {
      definirErreur(messageErreur(e));
    }
  };
  return (
    <div className="mode">
      <div className="segments" role="radiogroup" aria-label="Mode de l’agent">
        {(Object.keys(PROFILS) as IdProfil[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={etat.reglages.profil === id}
            className={etat.reglages.profil === id ? 'segment actif' : 'segment'}
            title={PROFILS[id].description}
            onClick={() => void changer(id)}
          >
            {PROFILS[id].libelle}
          </button>
        ))}
      </div>
      <Confidentialite />
      <button type="button" className="lien" onClick={() => allerA('aide', 'modes')}>
        Quel mode choisir ?
      </button>
      {erreur && <Message type="erreur">{erreur}</Message>}
    </div>
  );
}

/** Thème de l'interface, appliqué tout de suite et mémorisé. */
function SelecteurTheme() {
  const { etat, enregistrerReglages } = useApplication();
  if (!etat) return null;
  const actuel = etat.reglages.apparence.theme;
  return (
    <div className="theme">
      <span className="theme-libelle" id="libelle-theme">
        Thème
      </span>
      <div className="segments segments-compacts" role="radiogroup" aria-labelledby="libelle-theme">
        {(Object.keys(THEMES) as Theme[]).map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={actuel === theme}
            className={actuel === theme ? 'segment actif' : 'segment'}
            onClick={() => void enregistrerReglages({ apparence: { theme } })}
          >
            {THEMES[theme]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const { erreurDemarrage, ecran, allerA } = useApplication();
  const contenu = useRef<HTMLElement>(null);
  // Chaque écran s'ouvre en haut ; l'aide fait ensuite défiler jusqu'à la question demandée.
  useLayoutEffect(() => {
    contenu.current?.scrollTo(0, 0);
  }, [ecran]);
  return (
    <div className="application">
      <aside className="barre-laterale">
        <div className="marque">
          <span className="marque-nom">Blow Rapide Décision</span>
          <span className="marque-sous-titre">Agent de bureau · Jev</span>
        </div>
        <nav aria-label="Écrans">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={ecran === o.id ? 'onglet actif' : 'onglet'}
              aria-current={ecran === o.id ? 'page' : undefined}
              onClick={() => allerA(o.id)}
            >
              <span className="onglet-libelle">{o.libelle}</span>
              <span className="onglet-aide">{o.aide}</span>
            </button>
          ))}
        </nav>
        <SelecteurTheme />
      </aside>
      <div className="zone-principale">
        <header className="entete">
          <SelecteurMode />
        </header>
        <main className="contenu" ref={contenu}>
          {erreurDemarrage && <Message type="erreur">{erreurDemarrage}</Message>}
          {/* Les écrans restent montés : une lecture, une comparaison ou des réglages en cours survivent au changement d'écran. */}
          <div hidden={ecran !== 'documents'}>
            <EcranDocuments />
          </div>
          <div hidden={ecran !== 'recherche'}>
            <EcranRecherche />
          </div>
          <div hidden={ecran !== 'comparaison'}>
            <EcranComparaison />
          </div>
          <div hidden={ecran !== 'reglages'}>
            <EcranReglages />
          </div>
          <div hidden={ecran !== 'aide'}>
            <EcranAide />
          </div>
        </main>
      </div>
    </div>
  );
}
