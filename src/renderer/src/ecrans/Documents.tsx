import { useEffect, useMemo, useState } from 'react';
import {
  CATEGORIE_A_VERIFIER,
  type AffectationRangement,
  type DetailDocument,
  type Progression,
  type ResultatRangement
} from '../../../partage/contrat';
import { formaterEntier, formaterPourcentage } from '../../../partage/format';
import { api, messageErreur } from '../api';
import { BarreProgression, BilanMesures, Jauge, Message, MessageErreur, Pastille, Urgence } from '../composants';
import { useApplication } from '../contexte';
import { EtatPreparation } from '../preparation';

type Operation = 'lecture' | 'classement' | 'resume' | 'rangement' | null;

const nomDossier = (chemin: string): string => chemin.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Documents';

const taille = (octets: number): string =>
  octets < 1024 ? `${octets} o` : octets < 1_048_576 ? `${formaterEntier(octets / 1024)} Ko` : `${(octets / 1_048_576).toFixed(1).replace('.', ',')} Mo`;

/** Avancement de la lecture du dossier : fichiers, pages scannées (OCR), puis recherche par le sens (options). */
function AvancementLecture({ progression, annuler }: { progression: Progression | null; annuler: () => void }) {
  if (progression?.type !== 'indexation') return null;
  const libelle =
    progression.etape === 'plongements'
      ? 'Préparation de la recherche par le sens'
      : progression.ocr
        ? `Lecture OCR de ${progression.fichier} : page ${progression.ocr.page} sur ${progression.ocr.pages}`
        : `Lecture du dossier : ${progression.fichier}`;
  return (
    <div className="avancement">
      <BarreProgression fait={progression.traites} total={progression.total} libelle={libelle} />
      <button type="button" onClick={annuler} data-infobulle="Arrête la lecture du dossier ; le dossier déjà ouvert reste affiché.">
        Annuler
      </button>
    </div>
  );
}

export function EcranDocuments() {
  const { etat, corpus, definirCorpus, rafraichirCorpus, progression, allerA, ecran } = useApplication();
  const [operation, definirOperation] = useState<Operation>(null);
  const [erreur, definirErreur] = useState<string | null>(null);
  const [selection, definirSelection] = useState<string | null>(null);
  const [detail, definirDetail] = useState<DetailDocument | null>(null);
  const [filtre, definirFiltre] = useState('');
  const [seulementAVerifier, definirSeulementAVerifier] = useState(false);
  const [apercuRangement, definirApercuRangement] = useState(false);
  const [parentRangement, definirParentRangement] = useState<string | null>(null);
  const [affectationsRangement, definirAffectationsRangement] = useState<Record<string, string>>({});
  const [resultatRangement, definirResultatRangement] = useState<ResultatRangement | null>(null);

  const profil = etat?.reglages.profil;
  const categories = useMemo(
    () => new Map((etat?.reglages.classement.categories ?? []).map((c) => [c.id, c.libelle])),
    [etat?.reglages.classement.categories]
  );
  // Définition de chaque catégorie, montrée au survol de sa pastille.
  const definitions = useMemo(
    () => new Map((etat?.reglages.classement.categories ?? []).map((c) => [c.id, `${c.libelle} : ${c.description}`])),
    [etat?.reglages.classement.categories]
  );

  // Les classements et résumés dépendent du mode : on recharge quand il change.
  useEffect(() => {
    if (profil) {
      definirApercuRangement(false);
      void rafraichirCorpus();
    }
  }, [profil, rafraichirCorpus]);

  useEffect(() => {
    if (!selection) {
      definirDetail(null);
      return;
    }
    api.documents.lire(selection).then(definirDetail, (e: unknown) => definirErreur(messageErreur(e)));
  }, [selection, corpus]);

  const executer = async (nom: Operation, action: () => Promise<void>) => {
    definirOperation(nom);
    definirErreur(null);
    try {
      await action();
    } catch (e) {
      definirErreur(messageErreur(e));
    } finally {
      definirOperation(null);
    }
  };

  const lireDossier = (chemin: string) =>
    executer('lecture', async () => {
      const nouveau = await api.dossier.indexer(chemin);
      definirSelection(null);
      definirApercuRangement(false);
      definirParentRangement(null);
      definirResultatRangement(null);
      definirCorpus(nouveau);
    });
  const annulerLecture = () => void api.dossier.annuler();

  const choisirDossier = async () => {
    const chemin = await api.dossier.choisir();
    if (chemin) await lireDossier(chemin);
  };

  const classer = (ids?: string[]) => {
    definirApercuRangement(false);
    return executer('classement', async () => {
      try {
        await api.documents.trier(ids);
      } finally {
        // Les documents classés avant une éventuelle erreur restent affichés.
        await rafraichirCorpus();
      }
    });
  };

  const resumer = (id: string) =>
    executer('resume', async () => {
      await api.documents.resumer(id);
      definirDetail(await api.documents.lire(id));
    });

  /** Bulle d'un bouton : pendant une opération, tous attendent, et la bulle dit pourquoi. */
  const bulle = (texte: string): string => (operation !== null ? 'Patientez : une opération est en cours.' : texte);

  const documents = corpus?.documents ?? [];
  const restants = documents.filter((d) => !d.triage).length;
  const aVerifier = documents.filter((d) => d.triage?.aVerifier).length;
  const visibles = documents.filter(
    (d) => (!filtre || d.triage?.categorie === filtre) && (!seulementAVerifier || d.triage?.aVerifier)
  );
  const moteurDecision = profil === 'hybride' ? 'Jev via OpenRouter' : profil === 'local' ? 'Ollama en local' : 'Référence sans IA';
  const nomSortie = `${nomDossier(corpus?.dossier ?? '')} - classé`;
  const aVerifierDansApercu = documents.filter(
    (document) => (affectationsRangement[document.id] ?? (document.triage?.aVerifier ? CATEGORIE_A_VERIFIER : document.triage?.categorie)) === CATEGORIE_A_VERIFIER
  ).length;

  const ouvrirApercuRangement = () => {
    definirErreur(null);
    definirParentRangement(null);
    definirResultatRangement(null);
    definirAffectationsRangement(
      Object.fromEntries(
        documents.map((document) => [
          document.id,
          document.triage?.aVerifier ? CATEGORIE_A_VERIFIER : (document.triage?.categorie ?? CATEGORIE_A_VERIFIER)
        ])
      )
    );
    definirApercuRangement(true);
  };

  const choisirParentRangement = async () => {
    definirErreur(null);
    try {
      const parent = await api.rangement.choisirDestination();
      if (parent) definirParentRangement(parent);
    } catch (e) {
      definirErreur(messageErreur(e));
    }
  };

  const copierRangement = () => {
    if (!parentRangement) {
      definirErreur('Choisissez d’abord le dossier où créer la copie rangée.');
      return;
    }
    void executer('rangement', async () => {
      const affectations: AffectationRangement[] = documents.map((document) => ({
        documentId: document.id,
        categorie:
          affectationsRangement[document.id] ??
          (document.triage?.aVerifier ? CATEGORIE_A_VERIFIER : (document.triage?.categorie ?? CATEGORIE_A_VERIFIER))
      }));
      const resultat = await api.rangement.copier(parentRangement, affectations);
      definirResultatRangement(resultat);
      definirApercuRangement(false);
    });
  };

  const ouvrirDernierRangement = () =>
    void api.rangement.ouvrirDernier().catch((e: unknown) => definirErreur(messageErreur(e)));

  if (!corpus) {
    return (
      <section className="ecran">
        <h1>Documents</h1>
        <div className="accueil">
          <h2>Bienvenue ! Trois étapes pour commencer</h2>
          <ol className="etapes">
            <li>
              <h3>Vérifiez que l’agent est prêt</h3>
              <EtatPreparation actif={ecran === 'documents'} />
            </li>
            <li>
              <h3>Choisissez un dossier de documents</h3>
              <p>
                Factures, devis, contrats, courriers… en PDF, Word, TXT ou Markdown, sous-dossiers compris. L’agent lit les fichiers
                sur ce PC : rien n’est envoyé à cette étape.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="principal"
                  disabled={operation !== null}
                  onClick={() => void choisirDossier()}
                  data-infobulle={bulle('Ouvre l’explorateur pour choisir le dossier de vos documents. Les fichiers sont lus sur ce PC.')}
                >
                  Choisir un dossier…
                </button>
                {etat?.dernierDossier && (
                  <button
                    type="button"
                    disabled={operation !== null}
                    onClick={() => void lireDossier(etat.dernierDossier as string)}
                    data-infobulle={bulle('Relit le dernier dossier ouvert, fichiers ajoutés depuis compris.')}
                  >
                    Rouvrir {etat.dernierDossier}
                  </button>
                )}
              </div>
              {operation === 'lecture' && <AvancementLecture progression={progression} annuler={annulerLecture} />}
              {erreur && <MessageErreur message={erreur} />}
            </li>
            <li>
              <h3>Classez, cherchez, résumez</h3>
              <p>
                L’agent donne à chaque document une catégorie, dit s’il demande une action et s’il est urgent. Posez ensuite vos
                questions dans l’écran Recherche, ou résumez un document en un clic.
              </p>
              <p className="indice">Astuce : survolez un bouton avec la souris, une bulle explique à quoi il sert.</p>
              <button
                type="button"
                className="lien"
                onClick={() => allerA('aide')}
                data-infobulle="Ouvre l’écran Aide : premiers pas, choix du mode, installation d’Ollama."
              >
                Lire l’aide pour débuter
              </button>
            </li>
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section className="ecran ecran-documents">
      <div className="titre-ecran">
        <h1>Documents</h1>
        <span className="chemin" data-infobulle={`Dossier ouvert : ${corpus.dossier}`}>
          {corpus.dossier}
        </span>
      </div>

      <div className="barre-outils">
        <button
          type="button"
          disabled={operation !== null}
          onClick={() => void choisirDossier()}
          data-infobulle={bulle('Choisir un autre dossier de documents.')}
        >
          Changer de dossier…
        </button>
        <button
          type="button"
          disabled={operation !== null}
          onClick={() => void lireDossier(corpus.dossier)}
          data-infobulle={bulle('Relit le dossier : fichiers ajoutés ou modifiés, options activées dans Réglages.')}
        >
          Actualiser
        </button>
        <button
          type="button"
          className="principal"
          disabled={operation !== null || restants === 0}
          onClick={() => void classer()}
          data-infobulle={bulle(
            restants === 0
              ? 'Chaque document a sa catégorie. Pour en reclasser un, cliquez dessus puis sur « Reclasser ».'
              : 'Donne à chaque document une catégorie, dit s’il demande une action et s’il est urgent. La durée dépend du mode choisi.'
          )}
        >
          {restants === 0
            ? 'Tous les documents sont classés'
            : restants === documents.length
              ? `Classer les ${restants} documents`
              : `Classer les ${restants} restants`}
        </button>
        {restants === 0 && documents.length > 0 && (
          <button
            type="button"
            className="principal"
            disabled={operation !== null}
            onClick={ouvrirApercuRangement}
            data-infobulle={bulle('Vérifie les dossiers proposés, corrige-les si besoin, puis crée une copie rangée sans toucher aux originaux.')}
          >
            Préparer une copie rangée…
          </button>
        )}
        <span className="separateur" />
        <label data-infobulle="N’afficher que les documents d’une catégorie.">
          Catégorie{' '}
          <select value={filtre} onChange={(e) => definirFiltre(e.target.value)}>
            <option value="">Toutes</option>
            {[...categories].map(([id, libelle]) => (
              <option key={id} value={id}>
                {libelle}
              </option>
            ))}
          </select>
        </label>
        <label className="case" data-infobulle="N’afficher que les documents dont la catégorie est incertaine (⚠).">
          <input type="checkbox" checked={seulementAVerifier} onChange={(e) => definirSeulementAVerifier(e.target.checked)} />À
          vérifier seulement
        </label>
      </div>

      {apercuRangement && (
        <section className="bloc apercu-rangement" aria-label="Aperçu du rangement">
          <div className="rangement-entete">
            <div>
              <h2>Vérifier le rangement</h2>
              <p className="indice">Les propositions viennent de {moteurDecision}. Jev n’est utilisé qu’en mode Hybride.</p>
            </div>
            <button type="button" className="lien" disabled={operation !== null} onClick={() => definirApercuRangement(false)} data-infobulle="Ferme l’aperçu sans copier ni modifier les fichiers.">
              Fermer
            </button>
          </div>

          <p>
            Choisis le dossier où créer « <strong>{nomSortie}</strong> ». Les originaux ne seront ni déplacés ni modifiés.
            Le rangement porte sur tous les documents lus, même si le tableau principal est filtré.
          </p>
          <p className="indice">La copie inclura un bilan CSV avec la catégorie proposée et retenue, l’action, l’urgence, la confiance, le moteur et son coût.</p>
          {corpus.erreurs.length > 0 && (
            <p className="indice">Les {corpus.erreurs.length} fichier(s) non lus sont exclus de la copie.</p>
          )}
          {aVerifierDansApercu > 0 && (
            <Message type="alerte">
              {aVerifierDansApercu} document(s) iront dans « À vérifier » tant que tu ne choisis pas une autre destination.
            </Message>
          )}

          <div className="table-defilante rangement-table">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Dossier d’arrivée</th>
                  <th>Action détectée</th>
                  <th>Urgence</th>
                  <th>Confiance</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => {
                  const categorie =
                    affectationsRangement[document.id] ??
                    (document.triage?.aVerifier ? CATEGORIE_A_VERIFIER : (document.triage?.categorie ?? CATEGORIE_A_VERIFIER));
                  return (
                    <tr key={document.id}>
                      <td>
                        <span className="nom-document">{document.nom}</span>
                        {document.id !== document.nom && <span className="dossier-document">{document.id.slice(0, -document.nom.length)}</span>}
                      </td>
                      <td>
                        <select
                          aria-label={`Dossier d’arrivée pour ${document.nom}`}
                          disabled={operation !== null}
                          value={categorie}
                          data-infobulle="Choisis le sous-dossier de destination; les cas incertains restent dans « À vérifier » par défaut."
                          onChange={(evenement) => {
                            definirErreur(null);
                            definirAffectationsRangement((actuelles) => ({ ...actuelles, [document.id]: evenement.target.value }));
                          }}
                        >
                          <option value={CATEGORIE_A_VERIFIER}>À vérifier</option>
                          {[...categories].map(([id, libelle]) => (
                            <option key={id} value={id}>
                              {libelle}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{document.triage?.actionRequise ? 'Oui' : 'Non détectée'}</td>
                      <td>{document.triage ? <Urgence note={document.triage.urgence} /> : '–'}</td>
                      <td>{document.triage ? formaterPourcentage(document.triage.confiance) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="rangement-emplacement">
            {parentRangement ? (
              <>
                Nouveau dossier : <strong>{nomSortie}</strong> dans <span>{parentRangement}</span>
              </>
            ) : (
              'Aucun emplacement choisi.'
            )}
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={operation !== null}
              onClick={() => void choisirParentRangement()}
              data-infobulle="Choisis le dossier parent; l’application y créera un nouveau dossier de copie."
            >
              {parentRangement ? 'Changer l’emplacement…' : 'Choisir l’emplacement…'}
            </button>
            <button
              type="button"
              className="principal"
              disabled={operation !== null || !parentRangement}
              onClick={copierRangement}
              data-infobulle="Crée une nouvelle copie dans les sous-dossiers choisis; ne déplace et ne remplace aucun original."
            >
              {operation === 'rangement' ? 'Copie en cours…' : 'Créer la copie rangée'}
            </button>
            <button
              type="button"
              disabled={operation !== null}
              onClick={() => definirApercuRangement(false)}
              data-infobulle="Ferme l’aperçu; aucun fichier ne sera copié ni modifié."
            >
              Annuler
            </button>
          </div>
        </section>
      )}

      {resultatRangement && (
        <div className="message message-succes rangement-resultat" role="status">
          <div>
            <strong>Copie rangée créée.</strong> {formaterEntier(resultatRangement.fichiersCopies)} document(s) copiés; les originaux sont restés intacts.
            <p>{resultatRangement.dossierDestination}</p>
          </div>
          <button type="button" onClick={ouvrirDernierRangement} data-infobulle="Ouvre le dossier créé dans le gestionnaire de fichiers.">
            Ouvrir le dossier rangé
          </button>
        </div>
      )}

      {operation === null && documents.length > 0 && restants === documents.length && (
        <p className="indice etape-suivante">
          Étape suivante : cliquez sur « Classer les {restants} documents ». L’agent indique pour chacun sa catégorie, s’il demande
          une action (payer, répondre, signer…) et son urgence.
        </p>
      )}
      {operation === null && restants === 0 && aVerifier > 0 && (
        <p className="indice etape-suivante">
          {aVerifier} document(s) « à vérifier » : l’agent hésite sur leur catégorie. Cochez « À vérifier seulement » pour les
          revoir.
        </p>
      )}
      {operation === 'lecture' && <AvancementLecture progression={progression} annuler={annulerLecture} />}
      {operation === 'classement' && progression?.type === 'triage' && (
        <BarreProgression fait={progression.fait} total={progression.total} libelle="Classement des documents" />
      )}
      {erreur && <MessageErreur message={erreur} />}
      {corpus.avis.map((avis) => (
        <Message key={avis} type="alerte">
          {avis}
        </Message>
      ))}
      {corpus.semantique && (
        <p className="indice">
          Recherche par le sens prête : {formaterEntier(corpus.semantique.passages)} passages, modèle {corpus.semantique.modele}.
        </p>
      )}
      {corpus.erreurs.length > 0 && (
        <details className="erreurs-lecture">
          <summary data-infobulle="Fichiers que l’agent n’a pas pu lire, et pourquoi.">{corpus.erreurs.length} fichier(s) non lu(s)</summary>
          <ul>
            {corpus.erreurs.map((e) => (
              <li key={e.chemin}>
                <strong>{e.chemin}</strong> : {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="documents">
        <div className="table-defilante">
          <table>
            <thead>
              <tr>
                <th data-infobulle="Nom du fichier. Cliquez sur une ligne pour classer le document, le résumer ou lire son texte.">
                  Document
                </th>
                <th data-infobulle="Type du document selon l’agent : facture, devis, contrat… Survolez une catégorie pour sa définition.">
                  Catégorie
                </th>
                <th data-infobulle="Certitude de l’agent sur la catégorie. Sous le seuil, le document est marqué « à vérifier » (⚠).">
                  Confiance
                </th>
                <th data-infobulle="Le document demande-t-il une action : payer, répondre, signer ?">Action à faire</th>
                <th data-infobulle="Aucune, bientôt, ou urgente : échéance proche, relance, pénalités.">Urgence</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => (
                <tr
                  key={d.id}
                  className={selection === d.id ? 'selectionnee' : undefined}
                  onClick={() => definirSelection(d.id)}
                  onKeyDown={(e) => e.key === 'Enter' && definirSelection(d.id)}
                  tabIndex={0}
                  aria-selected={selection === d.id}
                >
                  <td>
                    <span className="nom-document">{d.nom}</span>
                    {d.pagesOcr ? (
                      <>
                        {' '}
                        <Pastille ton="neutre" infobulle={`${d.pagesOcr} page(s) scannée(s) : leur texte a été lu dans l’image (OCR).`}>
                          OCR
                        </Pastille>
                      </>
                    ) : null}
                    {d.id !== d.nom && <span className="dossier-document">{d.id.slice(0, -d.nom.length)}</span>}
                  </td>
                  <td>
                    {d.triage ? (
                      <Pastille
                        ton={d.triage.aVerifier ? 'alerte' : 'accent'}
                        infobulle={definitions.get(d.triage.categorie) ?? d.triage.categorie}
                      >
                        {categories.get(d.triage.categorie) ?? d.triage.categorie}
                      </Pastille>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td
                    className={d.triage?.aVerifier ? 'a-verifier' : undefined}
                    {...(d.triage?.aVerifier ? { 'data-infobulle': 'À vérifier : l’agent hésite sur la catégorie.' } : {})}
                  >
                    {d.triage ? `${formaterPourcentage(d.triage.confiance)}${d.triage.aVerifier ? ' ⚠' : ''}` : '–'}
                  </td>
                  <td>{d.triage ? (d.triage.actionRequise ? 'Oui' : 'Non') : '–'}</td>
                  <td>{d.triage ? <Urgence note={d.triage.urgence} /> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibles.length === 0 && <p className="vide-table">Aucun document ne correspond au filtre.</p>}
        </div>

        <aside className="fiche" aria-label="Fiche du document">
          {!detail ? (
            <p className="indice">Cliquez sur un document pour voir son classement, le résumer ou lire son texte.</p>
          ) : (
            <>
              <h2>{detail.nom}</h2>
              <p className="meta">
                {detail.format.toUpperCase()} · {taille(detail.taille)} · {formaterEntier(detail.caracteres)} caractères · modifié le{' '}
                {new Date(detail.modifieLe).toLocaleDateString('fr-FR')}
                {detail.pagesOcr ? ` · ${detail.pagesOcr} page(s) lue(s) par OCR` : ''}
              </p>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => void api.documents.ouvrir(detail.id).catch((e: unknown) => definirErreur(messageErreur(e)))}
                  data-infobulle="Ouvre le document avec le logiciel habituel de ce PC."
                >
                  Ouvrir le fichier
                </button>
                <button
                  type="button"
                  disabled={operation !== null}
                  onClick={() => void classer([detail.id])}
                  data-infobulle={bulle('Classe ce document seul : catégorie, action à faire, urgence.')}
                >
                  {detail.triage ? 'Reclasser' : 'Classer'}
                </button>
                <button
                  type="button"
                  className="principal"
                  disabled={operation !== null}
                  onClick={() => void resumer(detail.id)}
                  data-infobulle={bulle(
                    detail.resume
                      ? 'Écrit un nouveau résumé, par exemple après un changement de mode.'
                      : 'Écrit un résumé factuel du document avec le mode choisi en haut de la fenêtre.'
                  )}
                >
                  {operation === 'resume' ? 'Résumé en cours…' : detail.resume ? 'Refaire le résumé' : 'Résumer'}
                </button>
              </div>

              {detail.triage && (
                <section className="bloc">
                  <h3>Classement</h3>
                  <p className="indice">Ce que l’agent pense de ce document, et avec quelle certitude.</p>
                  {Object.entries(detail.triage.probabilites)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([id, p]) => (
                      <Jauge
                        key={id}
                        valeur={p}
                        libelle={categories.get(id) ?? id}
                        aide={`Probabilité que ce document soit de catégorie « ${categories.get(id) ?? id} »`}
                      />
                    ))}
                  <Jauge
                    valeur={detail.triage.probabiliteAction}
                    libelle="Action à faire"
                    aide="Probabilité que le document demande une action : payer, répondre, signer"
                  />
                  <p>
                    Urgence : <Urgence note={detail.triage.urgence} />{' '}
                    {detail.triage.aVerifier && (
                      <Pastille ton="alerte" infobulle="L’agent hésite sur la catégorie : vérifiez-la d’un coup d’œil.">
                        À vérifier
                      </Pastille>
                    )}
                  </p>
                  <BilanMesures mesures={detail.triage.mesures} />
                </section>
              )}

              {detail.resume && (
                <section className="bloc">
                  <h3>Résumé</h3>
                  <div className="texte-resume">{detail.resume.texte}</div>
                  <BilanMesures mesures={detail.resume.mesures} />
                </section>
              )}

              <details className="bloc">
                <summary data-infobulle="Le début du texte extrait du fichier, tel que l’agent le lit.">Texte lu par l’agent</summary>
                <pre className="apercu">{detail.apercu}</pre>
              </details>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
