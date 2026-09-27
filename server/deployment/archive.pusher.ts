import fs from 'node:fs';
import JSZip from 'jszip';
import { db } from '../database/db.js';
import { decryptSecret } from '../security/vault.js';
import { getProviderAdapter } from '../providers/index.js';

const MAX_FILES = 1000;
const MAX_TOTAL = 50 * 1024 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED = 100 * 1024 * 1024;
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vite']);

export async function pushProjectArchiveToGitHub(archivePath: string, connectionId: string, owner: string, repo: string, branch = 'main') {
  const buffer = fs.readFileSync(archivePath);
  if (buffer.length > MAX_TOTAL) throw new Error('Project archive exceeds the 50MB push limit.');
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  if (names.length > MAX_FILES) throw new Error(`Project contains ${names.length} files; maximum is ${MAX_FILES}.`);
  const declaredUncompressed = names.reduce((sum, name) => {
    const size = Number((zip.files[name] as any)?._data?.uncompressedSize || 0);
    return sum + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
  if (declaredUncompressed > MAX_UNCOMPRESSED) throw new Error('Project archive uncompressed size exceeds the 100MB safety limit.');

  const secret = decryptSecret(db.getEncryptedSecret(connectionId) || '');
  const adapter = getProviderAdapter('github');
  const pushed: string[] = [];

  for (const rawName of names) {
    const normalized = rawName.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || /^[A-Za-z]:\//.test(normalized)) {
      throw new Error(`Unsafe archive path: ${rawName}`);
    }
    if (normalized.split('/').some((part) => IGNORED.has(part))) continue;
    if (/^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i.test(normalized.split('/').pop() || '')) continue;

    const content = await zip.files[rawName].async('nodebuffer');
    if (content.length > MAX_FILE) throw new Error(`File ${normalized} exceeds the 10MB per-file push limit.`);

    let sha: string | undefined;
    try {
      const existing = await adapter.getResource(secret, 'file', `${owner}/${repo}/contents/${normalized}`);
      sha = existing?.sha;
    } catch {
      // New file; no SHA required.
    }

    await adapter.performAction(secret, 'create_or_update_file', {
      owner,
      repo,
      path: normalized,
      contentBase64: content.toString('base64'),
      message: `${sha ? 'Update' : 'Add'} ${normalized}`,
      branch,
      sha,
    });
    pushed.push(normalized);
  }

  try { fs.unlinkSync(archivePath); } catch {}
  return { pushedFiles: pushed.length, files: pushed };
}
