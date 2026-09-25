import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copierFichiersClasses, type FichierClasse } from '../../src/main/rangement';

let racine: string;

async function preparer(): Promise<{ source: string; parent: string }> {
  racine = await mkdtemp(join(tmpdir(), 'brd-rangement-test-'));
  const source = join(racine, 'Dossier à trier');
  const parent = join(racine, 'Sorties');
  await mkdir(join(source, 'Sous-dossier'), { recursive: true });
  await mkdir(parent);
  return { source, parent };
}

async function fichierClasse(chemin: string, cheminRelatif: string, categorie: string): Promise<FichierClasse> {
  const infos = await stat(chemin);
  return {
    cheminSource: chemin,
    cheminRelatif,
    categorie,
    taille: infos.size,
    modifieLe: infos.mtime.toISOString()
  };
}

afterEach(async () => {
  if (racine) await rm(racine, { recursive: true, force: true });
});

describe('copie rangée des documents', () => {
  it('copie dans les catégories en conservant les sous-dossiers et les originaux', async () => {
    const { source, parent } = await preparer();
    const facture = join(source, 'Sous-dossier', 'facture.txt');
    const douteux = join(source, 'courrier.txt');
    await writeFile(facture, 'Montant : 120 euros', 'utf8');
    await writeFile(douteux, 'Document à relire', 'utf8');

    const resultat = await copierFichiersClasses({
      dossierSource: source,
      parentDestination: parent,
      fichiers: [
        await fichierClasse(facture, 'Sous-dossier/facture.txt', 'Factures'),
        await fichierClasse(douteux, 'courrier.txt', 'À vérifier')
      ]
    });

    const racineSortie = join(parent, `${basename(source)} - classé`);
    expect(resultat).toEqual({ dossierDestination: racineSortie, fichiersCopies: 2 });
    expect(await readFile(join(racineSortie, 'Factures', 'Sous-dossier', 'facture.txt'), 'utf8')).toBe('Montant : 120 euros');
    expect(await readFile(join(racineSortie, 'À vérifier', 'courrier.txt'), 'utf8')).toBe('Document à relire');
    expect(await readFile(facture, 'utf8')).toBe('Montant : 120 euros');
    expect(await readFile(douteux, 'utf8')).toBe('Document à relire');
  });

  it('refuse une destination dans le dossier source', async () => {
    const { source } = await preparer();
    const facture = join(source, 'facture.txt');
    await writeFile(facture, 'Facture', 'utf8');

    await expect(
      copierFichiersClasses({
        dossierSource: source,
        parentDestination: source,
        fichiers: [await fichierClasse(facture, 'facture.txt', 'Factures')]
      })
    ).rejects.toThrow(/extérieur|source/i);
    expect(await readFile(facture, 'utf8')).toBe('Facture');
  });

  it('refuse d’écraser un dossier de sortie déjà présent', async () => {
    const { source, parent } = await preparer();
    const facture = join(source, 'facture.txt');
    await writeFile(facture, 'Facture', 'utf8');
    const sortieExistante = join(parent, `${basename(source)} - classé`);
    await mkdir(sortieExistante);
    await writeFile(join(sortieExistante, 'garder.txt'), 'À conserver', 'utf8');

    await expect(
      copierFichiersClasses({
        dossierSource: source,
        parentDestination: parent,
        fichiers: [await fichierClasse(facture, 'facture.txt', 'Factures')]
      })
    ).rejects.toThrow(/existe|déjà/i);
    expect(await readFile(join(sortieExistante, 'garder.txt'), 'utf8')).toBe('À conserver');
  });

  it('refuse une source modifiée depuis son classement', async () => {
    const { source, parent } = await preparer();
    const facture = join(source, 'facture.txt');
    await writeFile(facture, 'Ancienne facture', 'utf8');
    const classee = await fichierClasse(facture, 'facture.txt', 'Factures');
    await writeFile(facture, 'Nouvelle version différente', 'utf8');

    await expect(copierFichiersClasses({ dossierSource: source, parentDestination: parent, fichiers: [classee] })).rejects.toThrow(
      /modifié|actualisez/i
    );
    expect(await readFile(facture, 'utf8')).toBe('Nouvelle version différente');
    await expect(stat(join(parent, `${basename(source)} - classé`))).rejects.toThrow();
  });

  it('refuse un fichier remplacé par un lien vers un fichier extérieur', async () => {
    const { source, parent } = await preparer();
    const fichier = join(source, 'facture.txt');
    const exterieur = join(racine, 'secret.txt');
    await writeFile(fichier, 'Facture', 'utf8');
    await writeFile(exterieur, 'Donnée extérieure', 'utf8');
    const classee = await fichierClasse(fichier, 'facture.txt', 'Factures');
    await rm(fichier);
    await symlink(exterieur, fichier);

    await expect(copierFichiersClasses({ dossierSource: source, parentDestination: parent, fichiers: [classee] })).rejects.toThrow(
      /lien|extérieur|source/i
    );
    expect(await readFile(exterieur, 'utf8')).toBe('Donnée extérieure');
  });
});
