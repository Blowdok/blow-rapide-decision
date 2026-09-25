import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dossierTemporaire } from './outils/fabriques';

const executer = promisify(execFile);
const RACINE = resolve(import.meta.dirname, '..');

/** Lance la ligne de commande sans clé ni serveur : seule la référence sans IA peut tourner. */
function brd(...args: string[]) {
  const env = { ...process.env, OPENROUTER_API_KEY: '', TYPESAFE_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9' };
  // Node charge tsx lui-même : pas de script .cmd sous Windows.
  return executer(process.execPath, ['--import', 'tsx', join(RACINE, 'src/cli/index.ts'), ...args], { cwd: RACINE, env });
}

let sortie: string;
let nettoyer: () => Promise<void>;
beforeEach(async () => {
  ({ chemin: sortie, nettoyer } = await dossierTemporaire());
});
afterEach(async () => nettoyer());

describe('ligne de commande brd', () => {
  it('compare les modes et écrit le rapport de décision', async () => {
    const { stdout } = await brd('comparer', '--profils', 'reference,hybride', '--sortie', sortie);
    expect(stdout).toContain('Référence sans IA');
    expect(stdout).toContain('Clé OpenRouter manquante');
    const fichiers = (await readdir(sortie)).sort();
    expect(fichiers).toHaveLength(2);
    expect(fichiers[0]).toMatch(/^comparaison-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const rapport = await readFile(join(sortie, fichiers[1] as string), 'utf8');
    expect(rapport).toContain('## Recommandation');
  }, 60_000);

  it('trie un dossier avec la référence sans IA', async () => {
    const { stdout } = await brd('trier', 'jeux-evaluation/demo/documents', '--profil', 'reference');
    expect(stdout).toContain('facture-imprimerie-lumen.txt → facture');
    expect(stdout).toContain('12 document(s) triés en mode Référence sans IA');
  }, 60_000);

  it('refuse un mode inconnu avec un message clair', async () => {
    await expect(brd('trier', 'jeux-evaluation/demo/documents', '--profil', 'cloud')).rejects.toMatchObject({
      stderr: expect.stringContaining('Mode inconnu « cloud »')
    });
  }, 60_000);
});
