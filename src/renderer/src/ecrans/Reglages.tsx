import { useCallback, useEffect, useState } from 'react';
import { sansAccents } from '../../../coeur/texte/normalisation';
import { type EntreeJournal, LIBELLES_OPERATION, type NomCle } from '../../../partage/contrat';
import { formaterEntier, formaterUsd } from '../../../partage/format';
import type { Reglages } from '../../../partage/reglages';
import type { Categorie } from '../../../partage/types';
import { api, messageErreur } from '../api';
import { Message, Pastille } from '../composants';
import { useApplication } from '../contexte';
import { EtatPreparation } from '../preparation';

const identifiant = (libelle: string): string =>
  sansAccents(libelle.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function Cle({ nom, libelle, aide }: { nom: NomCle; libelle: string; aide: string }) {
  const { etat, definirEtat } = useApplication();
  const [valeur, definirValeur] = useState('');
  const [erreur, definirErreur] = useState<string | null>(null);
  if (!etat) return null;
  const enregistree = etat.cles[nom];
  const environnement = etat.clesEnvironnement[nom];
  const definir = async (nouvelle: string) => {
    definirErreur(null);
    try {
      definirEtat(await api.reglages.definirCle(nom, nouvelle));
      definirValeur('');
    } catch (e) {
      definirErreur(messageErreur(e));
    }
  };
  return (
    <div className="champ">
      <span data-infobulle={aide}>
        {libelle}{' '}
        {enregistree ? (
          <Pastille ton="succes" infobulle="La clé est chiffrée par le système de ce PC ; elle ne s’affiche plus jamais.">
            enregistrée, chiffrée par le système
          </Pastille>
        ) : environnement ? (
          <Pastille ton="accent" infobulle="La clé vient d’une variable d’environnement ; une clé enregistrée ici passe devant.">
            fournie par une variable d’environnement
          </Pastille>
        ) : (
          <Pastille ton="alerte" infobulle="Aucune clé : le mode Hybride ne peut pas fonctionner.">
            absente
          </Pastille>
        )}
      </span>
      <span className="ligne">
        <input
          type="password"
          autoComplete="off"
          value={valeur}
          onChange={(e) => definirValeur(e.target.value)}
          placeholder={enregistree ? 'Nouvelle clé pour remplacer l’actuelle' : 'Collez la clé ici'}
          aria-label={libelle}
          disabled={!etat.chiffrementDisponible}
          data-infobulle={aide}
        />
        <button
          type="button"
          disabled={!valeur.trim()}
          onClick={() => void definir(valeur)}
          data-infobulle={
            valeur.trim() ? 'Chiffre la clé et la garde sur ce PC ; elle ne s’affichera plus.' : 'Collez d’abord une clé dans le champ.'
          }
        >
          Enregistrer la clé
        </button>
        {enregistree && (
          <button type="button" onClick={() => void definir('')} data-infobulle="Efface la clé de ce PC.">
            Supprimer
          </button>
        )}
      </span>
      {erreur && <Message type="erreur">{erreur}</Message>}
    </div>
  );
}

/** Alerte si le modèle d'une option active manque dans Ollama (liste connue seulement). */
function ModeleAbsent({ modele, actif, modeles }: { modele: string; actif: boolean; modeles: string[] }) {
  const nom = modele.trim();
  if (!actif || !nom || modeles.length === 0 || modeles.includes(nom) || modeles.includes(`${nom}:latest`)) return null;
  return (
    <Message type="alerte">
      Modèle absent d’Ollama : tapez « ollama pull {nom} » dans un terminal (voir l’Aide, « Installer Ollama »).
    </Message>
  );
}

/** Clé de mémorisation de l'affichage des réglages avancés. */
const CLE_AVANCES = 'brd:reglages-avances';

function lireAvances(): boolean {
  try {
    return localStorage.getItem(CLE_AVANCES) === '1';
  } catch {
    return false;
  }
}

function EditeurCategories({ categories, changer }: { categories: Categorie[]; changer: (c: Categorie[]) => void }) {
  const modifier = (i: number, champ: 'libelle' | 'description', valeur: string) =>
    changer(categories.map((c, j) => (j === i ? { ...c, [champ]: valeur } : c)));
  const [nouvelle, definirNouvelle] = useState('');
  const ajouter = () => {
    const id = identifiant(nouvelle);
    if (!id || categories.some((c) => c.id === id)) return;
    changer([...categories, { id, libelle: nouvelle.trim(), description: '' }]);
    definirNouvelle('');
  };
  return (
    <div className="categories">
      {categories.map((c, i) => (
        <div key={c.id} className="categorie">
          <code data-infobulle="Identifiant technique de la catégorie, utilisé par les jeux d’examen.">{c.id}</code>
          <input
            value={c.libelle}
            onChange={(e) => modifier(i, 'libelle', e.target.value)}
            aria-label={`Libellé de ${c.id}`}
            data-infobulle="Nom affiché de la catégorie."
          />
          <input
            value={c.description}
            onChange={(e) => modifier(i, 'description', e.target.value)}
            aria-label={`Description de ${c.id}`}
            placeholder="Ce qui caractérise cette catégorie"
            data-infobulle="Ce qui caractérise la catégorie : l’agent s’en sert pour décider."
          />
          <button
            type="button"
            onClick={() => changer(categories.filter((_, j) => j !== i))}
            disabled={categories.length <= 2}
            data-infobulle={categories.length <= 2 ? 'Il faut au moins deux catégories.' : 'Supprime cette catégorie ; il en faut au moins deux.'}
          >
            Retirer
          </button>
        </div>
      ))}
      <div className="ligne">
        <input
          value={nouvelle}
          onChange={(e) => definirNouvelle(e.target.value)}
          placeholder="Nouvelle catégorie"
          aria-label="Nouvelle catégorie"
          data-infobulle="Nom de la catégorie à ajouter."
        />
        <button
          type="button"
          onClick={ajouter}
          disabled={!identifiant(nouvelle)}
          data-infobulle={
            identifiant(nouvelle)
              ? 'Ajoute la catégorie ; écrivez-lui ensuite une description pour guider l’agent.'
              : 'Tapez d’abord le nom de la catégorie à ajouter.'
          }
        >
          Ajouter
        </button>
      </div>
      <p className="indice">
        Les descriptions guident la décision. Les catégories attendues par un jeu d’évaluation doivent exister ici.
      </p>
    </div>
  );
}

export function EcranReglages() {
  const { etat, enregistrerReglages, allerA, ecran } = useApplication();
  const [brouillon, definirBrouillon] = useState<Reglages | null>(null);
  const [modeles, definirModeles] = useState<string[]>([]);
  const [journal, definirJournal] = useState<EntreeJournal[]>([]);
  const [message, definirMessage] = useState<{ type: 'succes' | 'erreur'; texte: string } | null>(null);
  const [avances, definirAvances] = useState(lireAvances);

  // Mode (en-tête) et thème (barre latérale) se règlent ailleurs : les suivre sans
  // effacer les modifications en cours.
  useEffect(() => {
    if (!etat) return;
    definirBrouillon((actuel) =>
      actuel ? { ...actuel, profil: etat.reglages.profil, apparence: etat.reglages.apparence } : etat.reglages
    );
  }, [etat]);

  // Le journal est relu à chaque retour sur l'écran : de nouveaux envois ont pu avoir lieu.
  useEffect(() => {
    if (ecran === 'reglages') void api.journal().then(definirJournal);
  }, [ecran]);

  const lireModeles = useCallback(() => {
    api.services.modelesOllama().then(definirModeles, () => definirModeles([]));
  }, []);

  if (!etat || !brouillon) return null;

  const modifie = JSON.stringify(brouillon) !== JSON.stringify(etat.reglages);
  const section = <S extends keyof Reglages>(nom: S, partiel: Partial<Reglages[S]>) =>
    definirBrouillon({ ...brouillon, [nom]: { ...(brouillon[nom] as object), ...partiel } });
  const nombre = (valeur: string): number => Number(valeur.replace(',', '.'));

  const basculerAvances = (valeur: boolean) => {
    definirAvances(valeur);
    try {
      localStorage.setItem(CLE_AVANCES, valeur ? '1' : '0');
    } catch {
      // Stockage indisponible : le choix vaut pour cette session seulement.
    }
  };

  const enregistrer = async () => {
    definirMessage(null);
    try {
      const { profil: _profil, apparence: _apparence, ...sections } = brouillon;
      // Les valeurs hors limites reviennent bornées : le brouillon reprend l'état enregistré.
      definirBrouillon((await enregistrerReglages(sections)).reglages);
      definirMessage({ type: 'succes', texte: 'Réglages enregistrés.' });
    } catch (e) {
      definirMessage({ type: 'erreur', texte: messageErreur(e) });
    }
  };

  return (
    <section className="ecran ecran-reglages">
      <div className={`titre-ecran barre-enregistrement${modifie ? ' modifiee' : ''}`}>
        <h1>Réglages</h1>
        <div className="actions">
          {modifie && (
            <span className="a-enregistrer" data-infobulle="Des réglages ont changé : cliquez sur « Enregistrer » pour les garder.">
              Modifications à enregistrer
            </span>
          )}
          <button
            type="button"
            onClick={() => definirBrouillon(etat.reglages)}
            disabled={!modifie}
            data-infobulle={modifie ? 'Revient aux réglages enregistrés, sans rien changer.' : 'Aucune modification à annuler.'}
          >
            Annuler les modifications
          </button>
          <button
            type="button"
            className="principal"
            onClick={() => void enregistrer()}
            disabled={!modifie}
            data-infobulle={
              modifie
                ? 'Enregistre les modifications. Les options s’appliquent à la prochaine lecture du dossier (« Actualiser »).'
                : 'Rien à enregistrer : modifiez d’abord un réglage.'
            }
          >
            Enregistrer
          </button>
        </div>
      </div>
      {message && <Message type={message.type}>{message.texte}</Message>}

      <section className="carte">
        <h2>L’agent est-il prêt ?</h2>
        <EtatPreparation actif={ecran === 'reglages'} apresVerification={lireModeles} />
      </section>

      <section className="carte">
        <h2>Mode hybride : clé OpenRouter</h2>
        <p className="indice">
          Seulement pour le mode Hybride : la même clé donne accès à Jev et aux résumés en ligne.{' '}
          <button
            type="button"
            className="lien"
            onClick={() => allerA('aide', 'openrouter')}
            data-infobulle="Ouvre l’aide pas à pas pour créer une clé OpenRouter."
          >
            Comment obtenir une clé ?
          </button>
        </p>
        {!etat.chiffrementDisponible && (
          <Message type="alerte">
            Le chiffrement du système est indisponible : les clés ne peuvent pas être enregistrées ici. Utilisez les variables
            d’environnement OPENROUTER_API_KEY et TYPESAFE_API_KEY.
          </Message>
        )}
        <Cle
          nom="cleOpenRouter"
          libelle="Clé OpenRouter"
          aide="Collez la clé créée sur openrouter.ai : elle sert à Jev et aux résumés en ligne du mode Hybride."
        />
      </section>

      <section className="carte">
        <h2>Confidentialité</h2>
        <label
          className="case"
          data-infobulle="Avant chaque envoi, ces données sont remplacées par des marqueurs, puis remises à leur place à la réception."
        >
          <input type="checkbox" checked={brouillon.confidentialite.masquage} onChange={(e) => section('confidentialite', { masquage: e.target.checked })} />
          Masquer courriels, téléphones, IBAN, cartes bancaires et numéros de sécurité sociale avant tout envoi
        </label>
        <p className="indice">Recommandé. Les noms de personnes et les adresses postales ne sont pas masqués.</p>
        <h3 data-infobulle="Chaque envoi sur Internet depuis le lancement : quand, quoi, à qui, combien de texte, pour quel coût.">
          Journal des envois sur Internet
        </h3>
        {journal.length === 0 ? (
          <p className="indice">Aucun envoi depuis le lancement de l’application.</p>
        ) : (
          <div className="table-defilante">
            <table>
              <thead>
                <tr>
                  <th>Heure</th>
                  <th data-infobulle="Décision, rédaction, plongement (recherche par le sens) ou lecture OCR.">Opération</th>
                  <th data-infobulle="Service et modèle qui ont reçu le texte.">Destinataire</th>
                  <th data-infobulle="Quantité de texte envoyée.">Caractères</th>
                  <th data-infobulle="Données personnelles remplacées avant l’envoi.">Masqués</th>
                  <th data-infobulle="Montant facturé pour cet envoi.">Coût</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((e, i) => (
                  <tr key={`${e.date}-${i}`}>
                    <td>{new Date(e.date).toLocaleTimeString('fr-FR')}</td>
                    <td>{LIBELLES_OPERATION[e.operation]}</td>
                    <td>
                      {e.moteur} ({e.modele})
                    </td>
                    <td>{formaterEntier(e.caracteres)}</td>
                    <td>{formaterEntier(e.masques)}</td>
                    <td>{formaterUsd(e.coutUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="carte" aria-labelledby="titre-options">
        <h2 id="titre-options">Options locales facultatives</h2>
        <p className="indice">
          Désactivées par défaut : l’agent fonctionne sans elles. Elles utilisent Ollama sur ce PC, dans tous les modes. Après les
          avoir cochées, cliquez sur « Enregistrer », puis sur « Actualiser » dans l’écran Documents.{' '}
          <button
            type="button"
            className="lien"
            onClick={() => allerA('aide', 'options')}
            data-infobulle="Ouvre l’aide sur les options : à quoi elles servent, quels modèles installer."
          >
            En savoir plus
          </button>
        </p>
        <label
          className="case"
          data-infobulle={`Trouve aussi les passages qui disent la même chose avec d’autres mots. Demande le modèle ${brouillon.semantique.modele} dans Ollama.`}
        >
          <input type="checkbox" checked={brouillon.semantique.active} onChange={(e) => section('semantique', { active: e.target.checked })} />
          Recherche par le sens (sémantique) : trouver aussi les passages qui disent la même chose avec d’autres mots
        </label>
        {avances && (
          <label className="champ" data-infobulle="Modèle d’Ollama qui compare les textes par le sens.">
            <span>Modèle de plongement</span>
            <input list="modeles-ollama" value={brouillon.semantique.modele} onChange={(e) => section('semantique', { modele: e.target.value })} />
          </label>
        )}
        <ModeleAbsent modele={brouillon.semantique.modele} actif={brouillon.semantique.active} modeles={modeles} />
        <label
          className="case"
          data-infobulle={`Lit le texte des pages qui ne sont que des images (scans, photos). Demande le modèle ${brouillon.ocr.modele} dans Ollama.`}
        >
          <input type="checkbox" checked={brouillon.ocr.active} onChange={(e) => section('ocr', { active: e.target.checked })} />
          Lecture des PDF scannés : lire les pages qui ne sont que des images (plusieurs secondes par page)
        </label>
        {avances && (
          <>
            <label className="champ" data-infobulle="Modèle d’Ollama qui lit le texte dans les images des pages scannées.">
              <span>Modèle de vision</span>
              <input list="modeles-ollama" value={brouillon.ocr.modele} onChange={(e) => section('ocr', { modele: e.target.value })} />
            </label>
            <label className="champ" data-infobulle="Nombre maximal de pages scannées lues par document ; les pages blanches ne comptent pas.">
              <span>Pages lues au plus par document</span>
              <input type="number" min={1} max={200} value={brouillon.ocr.pagesMax} onChange={(e) => section('ocr', { pagesMax: nombre(e.target.value) })} />
            </label>
            <p className="indice">
              Le texte lu est gardé dans le dossier de données de l’application, pour ne pas relire les mêmes pages.
            </p>
          </>
        )}
        <ModeleAbsent modele={brouillon.ocr.modele} actif={brouillon.ocr.active} modeles={modeles} />
      </section>

      <label
        className="case bascule-avances"
        data-infobulle="Affiche les modèles, les seuils, les catégories et les paramètres techniques. Les valeurs par défaut conviennent pour commencer."
      >
        <input type="checkbox" checked={avances} onChange={(e) => basculerAvances(e.target.checked)} />
        Afficher les réglages avancés
      </label>
      <p className="indice">Modèles, seuils, catégories… Les valeurs par défaut conviennent pour commencer.</p>

      <datalist id="modeles-ollama">
        {modeles.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {avances && (
        <>
          <section className="carte">
            <h2>Mode local : Ollama</h2>
            <label className="champ" data-infobulle="Adresse d’Ollama. Par défaut, sur ce PC : http://127.0.0.1:11434.">
              <span>Adresse du serveur</span>
              <input value={brouillon.ollama.url} onChange={(e) => section('ollama', { url: e.target.value })} />
            </label>
            <label className="champ" data-infobulle="Modèle d’Ollama qui classe les documents et juge la pertinence, en mode Local.">
              <span>Modèle de décision (classement, pertinence)</span>
              <input list="modeles-ollama" value={brouillon.ollama.modeleDecision} onChange={(e) => section('ollama', { modeleDecision: e.target.value })} />
            </label>
            <label className="champ" data-infobulle="Modèle d’Ollama qui écrit les résumés, en mode Local.">
              <span>Modèle de rédaction (résumés)</span>
              <input list="modeles-ollama" value={brouillon.ollama.modeleResume} onChange={(e) => section('ollama', { modeleResume: e.target.value })} />
            </label>
            <label className="champ" data-infobulle="Quantité de texte que le modèle lit d’un coup. Plus grand : plus de mémoire utilisée.">
              <span>Contexte (jetons)</span>
              <input type="number" min={2048} step={1024} value={brouillon.ollama.contexte} onChange={(e) => section('ollama', { contexte: nombre(e.target.value) })} />
            </label>
            <p className="indice">
              Ollama 0.12.11 ou plus récent fournit les probabilités des décisions.{' '}
              {modeles.length ? `Modèles installés : ${modeles.join(', ')}.` : 'Aucun modèle détecté pour l’instant.'}
            </p>
          </section>

          <section className="carte">
            <h2>Mode hybride : Jev et OpenRouter</h2>
            <label className="champ" data-infobulle="Modèle en ligne qui écrit les résumés, en mode Hybride.">
              <span>Modèle de rédaction OpenRouter (résumés)</span>
              <input value={brouillon.openrouter.modeleResume} onChange={(e) => section('openrouter', { modeleResume: e.target.value })} />
            </label>
            <label
              className="case"
              data-infobulle="Refuse les fournisseurs qui gardent vos textes ou s’en servent pour entraîner leurs modèles. Recommandé."
            >
              <input type="checkbox" checked={brouillon.openrouter.refuserCollecte} onChange={(e) => section('openrouter', { refuserCollecte: e.target.checked })} />
              Exclure les fournisseurs qui conservent ou réutilisent les données
            </label>
            <label
              className="case"
              data-infobulle="Rétention nulle : le fournisseur n’enregistre rien. Plus sûr, mais moins de modèles disponibles."
            >
              <input type="checkbox" checked={brouillon.openrouter.exigerZdr} onChange={(e) => section('openrouter', { exigerZdr: e.target.checked })} />
              N’accepter que les fournisseurs à rétention nulle (ZDR)
            </label>
            <fieldset className="champ">
              <legend>Accès à Jev</legend>
              <label className="case" data-infobulle="Le plus simple : la clé OpenRouter suffit.">
                <input type="radio" name="acces-jev" checked={brouillon.jev.acces === 'openrouter'} onChange={() => section('jev', { acces: 'openrouter' })} />
                Par OpenRouter, avec la même clé
              </label>
              <label className="case" data-infobulle="Demande une clé TypeSafe à part, à saisir ci-dessous.">
                <input type="radio" name="acces-jev" checked={brouillon.jev.acces === 'typesafe'} onChange={() => section('jev', { acces: 'typesafe' })} />
                En direct chez TypeSafe
              </label>
            </fieldset>
            <label className="champ" data-infobulle="Version de Jev ; « jev-latest » suit toujours la dernière.">
              <span>Modèle Jev</span>
              <input value={brouillon.jev.modele} onChange={(e) => section('jev', { modele: e.target.value })} />
            </label>
            {brouillon.jev.acces === 'typesafe' && (
              <Cle nom="cleTypeSafe" libelle="Clé TypeSafe" aide="Clé créée chez TypeSafe, seulement pour l’accès direct à Jev." />
            )}
          </section>

          <section className="carte">
            <h2>Classement des documents</h2>
            <label className="champ" data-infobulle="Sous ce pourcentage de certitude, un document est marqué « à vérifier ».">
              <span>Seuil de confiance : {Math.round(brouillon.classement.seuilConfiance * 100)} %</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={brouillon.classement.seuilConfiance}
                onChange={(e) => section('classement', { seuilConfiance: nombre(e.target.value) })}
              />
            </label>
            <p className="indice">Sous ce seuil, le document est marqué « à vérifier ».</p>
            <label className="champ" data-infobulle="Longueur du début du document lue pour le classer. Plus long : plus juste, mais plus lent, et plus cher en mode Hybride.">
              <span>Caractères du document soumis à la décision</span>
              <input type="number" min={500} step={500} value={brouillon.classement.caracteresMax} onChange={(e) => section('classement', { caracteresMax: nombre(e.target.value) })} />
            </label>
            <h3 data-infobulle="Les catégories proposées à l’agent ; leur description l’aide à choisir.">Catégories</h3>
            <EditeurCategories categories={brouillon.classement.categories} changer={(categories) => section('classement', { categories })} />
          </section>

          <section className="carte">
            <h2>Recherche et résumés</h2>
            <label className="champ" data-infobulle="Nombre de passages que l’agent examine pour chaque question. Plus : plus juste, mais plus lent.">
              <span>Passages soumis à la décision de pertinence</span>
              <input type="number" min={1} max={50} value={brouillon.recherche.candidats} onChange={(e) => section('recherche', { candidats: nombre(e.target.value) })} />
            </label>
            <label className="champ" data-infobulle="Nombre de passages montrés pour chaque question.">
              <span>Résultats affichés</span>
              <input type="number" min={1} max={50} value={brouillon.recherche.resultats} onChange={(e) => section('recherche', { resultats: nombre(e.target.value) })} />
            </label>
            <label className="champ" data-infobulle="Au-delà de cette longueur, le document est résumé morceau par morceau, puis synthétisé.">
              <span>Taille d’une partie résumée séparément (caractères)</span>
              <input type="number" min={1000} step={1000} value={brouillon.resume.caracteresParPartie} onChange={(e) => section('resume', { caracteresParPartie: nombre(e.target.value) })} />
            </label>
            <label className="champ" data-infobulle="Longueur maximale d’un résumé. Un jeton vaut environ trois quarts de mot.">
              <span>Longueur maximale d’un résumé (jetons)</span>
              <input type="number" min={100} step={100} value={brouillon.resume.maxJetons} onChange={(e) => section('resume', { maxJetons: nombre(e.target.value) })} />
            </label>
          </section>
        </>
      )}
    </section>
  );
}
