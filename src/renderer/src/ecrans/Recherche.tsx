import { type FormEvent, type ReactNode, useState } from 'react';
import { termes } from '../../../coeur/texte/normalisation';
import type { Recherche, ResultatRecherche } from '../../../partage/types';
import { api, messageErreur } from '../api';
import { BilanMesures, Jauge, Message } from '../composants';
import { useApplication } from '../contexte';

/** Met en évidence les mots du passage qui comptent pour la recherche lexicale (même racine, hors mots vides). */
function surligner(texte: string, requete: string): ReactNode[] {
  const racines = new Set(termes(requete));
  return texte.split(/([\p{L}\p{N}]+)/u).map((morceau, i) => {
    const [racine] = termes(morceau);
    return racine && racines.has(racine) ? <mark key={i}>{morceau}</mark> : morceau;
  });
}

/** Rangs d'un passage dans les classements de l'index : mots-clés, et sens (option). */
function rangs(resultat: ResultatRecherche, semantique: boolean): string {
  const lexical = `rang lexical ${resultat.rangLexical ?? '–'}`;
  return semantique ? `${lexical} · rang sémantique ${resultat.rangSemantique ?? '–'}` : lexical;
}

export function EcranRecherche() {
  const { corpus, etat } = useApplication();
  const [requete, definirRequete] = useState('');
  const [resultat, definirResultat] = useState<Recherche | null>(null);
  const [enCours, definirEnCours] = useState(false);
  const [erreur, definirErreur] = useState<string | null>(null);

  const chercher = async (evenement: FormEvent) => {
    evenement.preventDefault();
    definirEnCours(true);
    definirErreur(null);
    try {
      definirResultat(await api.rechercher(requete));
    } catch (e) {
      definirErreur(messageErreur(e));
    } finally {
      definirEnCours(false);
    }
  };

  return (
    <section className="ecran">
      <h1>Recherche</h1>
      {!corpus ? (
        <Message type="info">Indexez d’abord un dossier dans l’écran Documents.</Message>
      ) : (
        <>
          <form className="recherche" onSubmit={(e) => void chercher(e)}>
            <input
              type="search"
              value={requete}
              onChange={(e) => definirRequete(e.target.value)}
              placeholder="Par exemple : quand dois-je payer la taxe foncière ?"
              aria-label="Requête"
            />
            <button type="submit" className="principal" disabled={enCours || !requete.trim()}>
              {enCours ? 'Recherche…' : 'Chercher'}
            </button>
          </form>
          <p className="indice">
            L’index local propose des passages
            {etat?.reglages.semantique.active ? ', par les mots-clés et par le sens,' : ','} puis le moteur de décision du mode actif
            juge la pertinence de chacun.
          </p>
          {erreur && <Message type="erreur">{erreur}</Message>}
          {resultat && (
            <>
              {resultat.avis && <Message type="alerte">{resultat.avis}</Message>}
              {resultat.resultats.length === 0 && <Message type="info">Aucun passage ne contient les mots de la requête.</Message>}
              <ol className="resultats">
                {resultat.resultats.map((r) => (
                  <li key={r.passage.id} className="resultat">
                    <div className="resultat-entete">
                      <strong>{r.documentNom}</strong>
                      <span className="indice">{rangs(r, resultat.modelePlongement !== null)}</span>
                      <button type="button" className="lien" onClick={() => void api.documents.ouvrir(r.passage.documentId)}>
                        Ouvrir
                      </button>
                    </div>
                    {r.pertinence !== null && <Jauge valeur={r.pertinence} libelle="Pertinence" />}
                    <p className="passage">{surligner(r.passage.texte.slice(0, 600), resultat.requete)}</p>
                  </li>
                ))}
              </ol>
              {resultat.mesures.length > 0 && <BilanMesures mesures={resultat.mesures} />}
            </>
          )}
        </>
      )}
    </section>
  );
}
