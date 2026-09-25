import { useState } from 'react';
import { PROFILS } from '../../partage/reglages';
import type { IdProfil } from '../../partage/types';
import { messageErreur } from './api';
import { Message } from './composants';
import { useApplication } from './contexte';
import { EcranComparaison } from './ecrans/Comparaison';
import { EcranDocuments } from './ecrans/Documents';
import { EcranRecherche } from './ecrans/Recherche';
import { EcranReglages } from './ecrans/Reglages';

type Onglet = 'documents' | 'recherche' | 'comparaison' | 'reglages';

const ONGLETS: Array<{ id: Onglet; libelle: string; aide: string }> = [
  { id: 'documents', libelle: 'Documents', aide: 'Indexer, trier et résumer' },
  { id: 'recherche', libelle: 'Recherche', aide: 'Trouver le bon passage' },
  { id: 'comparaison', libelle: 'Comparaison', aide: 'Local ou hybride ?' },
  { id: 'reglages', libelle: 'Réglages', aide: 'Modèles, clés, catégories' }
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
  const { etat, enregistrerReglages } = useApplication();
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
      {erreur && <Message type="erreur">{erreur}</Message>}
    </div>
  );
}

export function App() {
  const [onglet, definirOnglet] = useState<Onglet>('documents');
  const { erreurDemarrage } = useApplication();
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
              className={onglet === o.id ? 'onglet actif' : 'onglet'}
              aria-current={onglet === o.id ? 'page' : undefined}
              onClick={() => definirOnglet(o.id)}
            >
              <span className="onglet-libelle">{o.libelle}</span>
              <span className="onglet-aide">{o.aide}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="zone-principale">
        <header className="entete">
          <SelecteurMode />
        </header>
        <main className="contenu">
          {erreurDemarrage && <Message type="erreur">{erreurDemarrage}</Message>}
          {onglet === 'documents' && <EcranDocuments />}
          {onglet === 'recherche' && <EcranRecherche />}
          {onglet === 'comparaison' && <EcranComparaison />}
          {onglet === 'reglages' && <EcranReglages />}
        </main>
      </div>
    </div>
  );
}
