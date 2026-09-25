import { useEffect, useMemo, useState } from 'react';
import type { DetailDocument, Progression } from '../../../partage/contrat';
import { formaterEntier, formaterPourcentage } from '../../../partage/format';
import { api, messageErreur } from '../api';
import { BarreProgression, BilanMesures, Jauge, Message, MessageErreur, Pastille, Urgence } from '../composants';
import { useApplication } from '../contexte';
import { EtatPreparation } from '../preparation';

type Operation = 'lecture' | 'classement' | 'resume' | null;

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
    if (profil) void rafraichirCorpus();
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
      definirCorpus(nouveau);
    });
  const annulerLecture = () => void api.dossier.annuler();

  const choisirDossier = async () => {
    const chemin = await api.dossier.choisir();
    if (chemin) await lireDossier(chemin);
  };

  const classer = (ids?: string[]) =>
    executer('classement', async () => {
      try {
        await api.documents.trier(ids);
      } finally {
        // Les documents classés avant une éventuelle erreur restent affichés.
        await rafraichirCorpus();
      }
    });

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
