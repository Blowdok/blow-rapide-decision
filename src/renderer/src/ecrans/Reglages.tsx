import { useEffect, useState } from 'react';
import { sansAccents } from '../../../coeur/texte/normalisation';
import type { EntreeJournal, EtatService, NomCle } from '../../../partage/contrat';
import { formaterEntier, formaterUsd } from '../../../partage/format';
import type { Reglages } from '../../../partage/reglages';
import type { Categorie } from '../../../partage/types';
import { api, messageErreur } from '../api';
import { Message, Pastille } from '../composants';
import { useApplication } from '../contexte';

const identifiant = (libelle: string): string =>
  sansAccents(libelle.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function Cle({ nom, libelle }: { nom: NomCle; libelle: string }) {
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
      <span>
        {libelle}{' '}
        {enregistree ? (
          <Pastille ton="succes">enregistrée, chiffrée par le système</Pastille>
        ) : environnement ? (
          <Pastille ton="accent">fournie par une variable d’environnement</Pastille>
        ) : (
          <Pastille ton="alerte">absente</Pastille>
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
        />
        <button type="button" disabled={!valeur.trim()} onClick={() => void definir(valeur)}>
          Enregistrer
        </button>
        {enregistree && (
          <button type="button" onClick={() => void definir('')}>
            Supprimer
          </button>
        )}
      </span>
      {erreur && <Message type="erreur">{erreur}</Message>}
    </div>
  );
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
          <code>{c.id}</code>
          <input value={c.libelle} onChange={(e) => modifier(i, 'libelle', e.target.value)} aria-label={`Libellé de ${c.id}`} />
          <input
            value={c.description}
            onChange={(e) => modifier(i, 'description', e.target.value)}
            aria-label={`Description de ${c.id}`}
            placeholder="Ce qui caractérise cette catégorie"
          />
          <button type="button" onClick={() => changer(categories.filter((_, j) => j !== i))} disabled={categories.length <= 2}>
            Retirer
          </button>
        </div>
      ))}
      <div className="ligne">
        <input value={nouvelle} onChange={(e) => definirNouvelle(e.target.value)} placeholder="Nouvelle catégorie" aria-label="Nouvelle catégorie" />
        <button type="button" onClick={ajouter} disabled={!identifiant(nouvelle)}>
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
  const { etat, enregistrerReglages } = useApplication();
  const [brouillon, definirBrouillon] = useState<Reglages | null>(null);
  const [modeles, definirModeles] = useState<string[]>([]);
  const [diagnostic, definirDiagnostic] = useState<EtatService[] | null>(null);
  const [journal, definirJournal] = useState<EntreeJournal[]>([]);
  const [message, definirMessage] = useState<{ type: 'succes' | 'erreur'; texte: string } | null>(null);

  // Mode (en-tête) et thème (barre latérale) se règlent ailleurs : les suivre sans
  // effacer les modifications en cours.
  useEffect(() => {
    if (!etat) return;
    definirBrouillon((actuel) =>
      actuel ? { ...actuel, profil: etat.reglages.profil, apparence: etat.reglages.apparence } : etat.reglages
    );
  }, [etat]);

  useEffect(() => {
    api.services.modelesOllama().then(definirModeles, () => definirModeles([]));
    void api.journal().then(definirJournal);
  }, []);

  if (!etat || !brouillon) return null;

  const modifie = JSON.stringify(brouillon) !== JSON.stringify(etat.reglages);
  const section = <S extends keyof Reglages>(nom: S, partiel: Partial<Reglages[S]>) =>
    definirBrouillon({ ...brouillon, [nom]: { ...(brouillon[nom] as object), ...partiel } });
  const nombre = (valeur: string): number => Number(valeur.replace(',', '.'));

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

  const verifier = async () => {
    definirDiagnostic(null);
    try {
      definirDiagnostic(await api.services.diagnostic());
      definirModeles(await api.services.modelesOllama().catch(() => []));
    } catch (e) {
      definirMessage({ type: 'erreur', texte: messageErreur(e) });
    }
  };

  return (
    <section className="ecran ecran-reglages">
      <div className="titre-ecran">
        <h1>Réglages</h1>
        <div className="actions">
          {modifie && <span className="indice">Modifications non enregistrées</span>}
          <button type="button" onClick={() => definirBrouillon(etat.reglages)} disabled={!modifie}>
            Annuler les modifications
          </button>
          <button type="button" className="principal" onClick={() => void enregistrer()} disabled={!modifie}>
            Enregistrer
          </button>
        </div>
      </div>
      {message && <Message type={message.type}>{message.texte}</Message>}

      <section className="carte">
        <h2>Services</h2>
        <button type="button" onClick={() => void verifier()}>
          Vérifier Ollama, OpenRouter et Jev
        </button>
        {diagnostic && (
          <ul className="diagnostic">
            {diagnostic.map((d) => (
              <li key={d.service}>
                <Pastille ton={d.ok ? 'succes' : 'danger'}>{d.ok ? 'prêt' : 'à corriger'}</Pastille> <strong>{d.service}</strong> :{' '}
                {d.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="carte">
        <h2>Mode local : Ollama</h2>
        <datalist id="modeles-ollama">
          {modeles.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <label className="champ">
          <span>Adresse du serveur</span>
          <input value={brouillon.ollama.url} onChange={(e) => section('ollama', { url: e.target.value })} />
        </label>
        <label className="champ">
          <span>Modèle de décision (tri, pertinence)</span>
          <input list="modeles-ollama" value={brouillon.ollama.modeleDecision} onChange={(e) => section('ollama', { modeleDecision: e.target.value })} />
        </label>
        <label className="champ">
          <span>Modèle de rédaction (résumés)</span>
          <input list="modeles-ollama" value={brouillon.ollama.modeleResume} onChange={(e) => section('ollama', { modeleResume: e.target.value })} />
        </label>
        <label className="champ">
          <span>Contexte (jetons)</span>
          <input type="number" min={2048} step={1024} value={brouillon.ollama.contexte} onChange={(e) => section('ollama', { contexte: nombre(e.target.value) })} />
        </label>
        <p className="indice">
          Ollama 0.12.11 ou plus récent fournit les probabilités des décisions. {modeles.length ? `Modèles installés : ${modeles.join(', ')}.` : 'Aucun modèle détecté pour l’instant.'}
        </p>
      </section>

      <section className="carte">
        <h2>Mode hybride : Jev et OpenRouter</h2>
        {!etat.chiffrementDisponible && (
          <Message type="alerte">
            Le chiffrement du système est indisponible : les clés ne peuvent pas être enregistrées ici. Utilisez les variables
            d’environnement OPENROUTER_API_KEY et TYPESAFE_API_KEY.
          </Message>
        )}
        <Cle nom="cleOpenRouter" libelle="Clé OpenRouter" />
        <label className="champ">
          <span>Modèle de rédaction OpenRouter (résumés)</span>
          <input value={brouillon.openrouter.modeleResume} onChange={(e) => section('openrouter', { modeleResume: e.target.value })} />
        </label>
        <label className="case">
          <input type="checkbox" checked={brouillon.openrouter.refuserCollecte} onChange={(e) => section('openrouter', { refuserCollecte: e.target.checked })} />
          Exclure les fournisseurs qui conservent ou réutilisent les données
        </label>
        <label className="case">
          <input type="checkbox" checked={brouillon.openrouter.exigerZdr} onChange={(e) => section('openrouter', { exigerZdr: e.target.checked })} />
          N’accepter que les fournisseurs à rétention nulle (ZDR)
        </label>
        <fieldset className="champ">
          <legend>Accès à Jev</legend>
          <label className="case">
            <input type="radio" name="acces-jev" checked={brouillon.jev.acces === 'openrouter'} onChange={() => section('jev', { acces: 'openrouter' })} />
            Par OpenRouter, avec la même clé
          </label>
          <label className="case">
            <input type="radio" name="acces-jev" checked={brouillon.jev.acces === 'typesafe'} onChange={() => section('jev', { acces: 'typesafe' })} />
            En direct chez TypeSafe
          </label>
        </fieldset>
        <label className="champ">
          <span>Modèle Jev</span>
          <input value={brouillon.jev.modele} onChange={(e) => section('jev', { modele: e.target.value })} />
        </label>
        {brouillon.jev.acces === 'typesafe' && <Cle nom="cleTypeSafe" libelle="Clé TypeSafe" />}
      </section>

      <section className="carte">
        <h2>Confidentialité</h2>
        <label className="case">
          <input type="checkbox" checked={brouillon.confidentialite.masquage} onChange={(e) => section('confidentialite', { masquage: e.target.checked })} />
          Masquer courriels, téléphones, IBAN, cartes bancaires et numéros de sécurité sociale avant tout envoi
        </label>
        <p className="indice">Les noms de personnes et les adresses postales ne sont pas masqués.</p>
        <h3>Journal des envois hors de la machine</h3>
        {journal.length === 0 ? (
          <p className="indice">Aucun envoi depuis le lancement de l’application.</p>
        ) : (
          <div className="table-defilante">
            <table>
              <thead>
                <tr>
                  <th>Heure</th>
                  <th>Opération</th>
                  <th>Destinataire</th>
                  <th>Caractères</th>
                  <th>Masqués</th>
                  <th>Coût</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((e, i) => (
                  <tr key={`${e.date}-${i}`}>
                    <td>{new Date(e.date).toLocaleTimeString('fr-FR')}</td>
                    <td>{e.operation === 'decision' ? 'Décision' : 'Rédaction'}</td>
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

      <section className="carte">
        <h2>Tri des documents</h2>
        <label className="champ">
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
        <label className="champ">
          <span>Caractères du document soumis à la décision</span>
          <input type="number" min={500} step={500} value={brouillon.classement.caracteresMax} onChange={(e) => section('classement', { caracteresMax: nombre(e.target.value) })} />
        </label>
        <h3>Catégories</h3>
        <EditeurCategories categories={brouillon.classement.categories} changer={(categories) => section('classement', { categories })} />
      </section>

      <section className="carte">
        <h2>Recherche et résumés</h2>
        <label className="champ">
          <span>Passages soumis à la décision de pertinence</span>
          <input type="number" min={1} max={50} value={brouillon.recherche.candidats} onChange={(e) => section('recherche', { candidats: nombre(e.target.value) })} />
        </label>
        <label className="champ">
          <span>Résultats affichés</span>
          <input type="number" min={1} max={50} value={brouillon.recherche.resultats} onChange={(e) => section('recherche', { resultats: nombre(e.target.value) })} />
        </label>
        <label className="champ">
          <span>Taille d’une partie résumée séparément (caractères)</span>
          <input type="number" min={1000} step={1000} value={brouillon.resume.caracteresParPartie} onChange={(e) => section('resume', { caracteresParPartie: nombre(e.target.value) })} />
        </label>
        <label className="champ">
          <span>Longueur maximale d’un résumé (jetons)</span>
          <input type="number" min={100} step={100} value={brouillon.resume.maxJetons} onChange={(e) => section('resume', { maxJetons: nombre(e.target.value) })} />
        </label>
      </section>
    </section>
  );
}
