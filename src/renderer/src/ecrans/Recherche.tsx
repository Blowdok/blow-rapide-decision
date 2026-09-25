import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { termes } from '../../../coeur/texte/normalisation';
import type { Recherche, ResultatRecherche } from '../../../partage/types';
import { api, messageErreur } from '../api';
import { BilanMesures, Jauge, Message, MessageErreur, Pastille } from '../composants';
import { useApplication } from '../contexte';

/** Questions d'exemple : elles montrent qu'on peut écrire comme à un collègue. */
const EXEMPLES = ['Quelle est la date limite de paiement ?', 'Combien coûte la maintenance du site ?', 'Qui dois-je relancer ?'];

/** Met en évidence les mots du passage qui comptent pour la recherche lexicale (même racine, hors mots vides). */
function surligner(texte: string, requete: string): ReactNode[] {
  const racines = new Set(termes(requete));
  return texte.split(/([\p{L}\p{N}]+)/u).map((morceau, i) => {
    const [racine] = termes(morceau);
    return racine && racines.has(racine) ? <mark key={i}>{morceau}</mark> : morceau;
  });
}

/** Comment l'index a trouvé le passage, en clair ; les rangs exacts restent dans l'infobulle. */
function Provenance({ resultat }: { resultat: ResultatRecherche }) {
  const { rangLexical, rangSemantique } = resultat;
  const libelle =
    rangLexical !== null && rangSemantique !== null
      ? 'Trouvé par les mots et par le sens'
      : rangSemantique !== null
        ? 'Trouvé par le sens'
        : 'Trouvé par les mots';
  const detail = `Rang par les mots : ${rangLexical ?? '–'} ; rang par le sens : ${rangSemantique ?? '–'}`;
  return (
    <span title={detail}>
      <Pastille ton="neutre">{libelle}</Pastille>
    </span>
  );
}

export function EcranRecherche() {
  const { corpus, etat, allerA } = useApplication();
  const [requete, definirRequete] = useState('');
  const [resultat, definirResultat] = useState<Recherche | null>(null);
  const [enCours, definirEnCours] = useState(false);
  const [erreur, definirErreur] = useState<string | null>(null);

  // Un autre dossier : les résultats précédents ne le concernent plus.
  useEffect(() => {
    definirResultat(null);
    definirErreur(null);
  }, [corpus?.dossier]);

  const lancer = async (texte: string) => {
    definirEnCours(true);
    definirErreur(null);
    try {
      definirResultat(await api.rechercher(texte));
    } catch (e) {
      definirErreur(messageErreur(e));
    } finally {
      definirEnCours(false);
    }
  };

  const chercher = (evenement: FormEvent) => {
    evenement.preventDefault();
    void lancer(requete);
  };

  const essayer = (exemple: string) => {
    definirRequete(exemple);
    void lancer(exemple);
  };

  const semantique = etat?.reglages.semantique.active ?? false;

  return (
    <section className="ecran">
      <h1>Recherche</h1>
      {!corpus ? (
        <Message type="info">
          Choisissez d’abord un dossier de documents.{' '}
          <button type="button" className="lien" onClick={() => allerA('documents')}>
            Aller à l’écran Documents
          </button>
        </Message>
      ) : (
        <>
          <p className="consigne">
            Posez une question en français, comme à un collègue : l’agent trouve les passages de vos documents qui y répondent et
            les classe du plus utile au moins utile.
          </p>
          <form className="recherche" onSubmit={chercher}>
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
          {!resultat && !enCours && (
            <div className="exemples">
              <span className="indice">Exemples :</span>
              {EXEMPLES.map((exemple) => (
                <button key={exemple} type="button" className="exemple" onClick={() => essayer(exemple)}>
                  {exemple}
                </button>
              ))}
            </div>
          )}
          <p className="indice">
            {semantique
              ? 'La recherche comprend aussi les mots de sens proche (option activée).'
              : 'La recherche porte sur les mots de la question. Pour trouver aussi les mots de sens proche, activez la recherche par le sens dans Réglages.'}
          </p>
          {erreur && <MessageErreur message={erreur} />}
          {resultat && (
            <>
              {resultat.avis && <Message type="alerte">{resultat.avis}</Message>}
              {resultat.resultats.length === 0 && (
                <Message type="info">Aucun passage ne correspond. Essayez d’autres mots, ou une question plus courte.</Message>
              )}
              <ol className="resultats">
                {resultat.resultats.map((r) => (
                  <li key={r.passage.id} className="resultat">
                    <div className="resultat-entete">
                      <strong>{r.documentNom}</strong>
                      {resultat.modelePlongement !== null && <Provenance resultat={r} />}
                      <button type="button" className="lien" onClick={() => void api.documents.ouvrir(r.passage.documentId)}>
                        Ouvrir le fichier
                      </button>
                    </div>
                    {r.pertinence !== null && <Jauge valeur={r.pertinence} libelle="Répond à la question" />}
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
