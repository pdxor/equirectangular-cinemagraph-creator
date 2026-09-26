import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Normal Git builds already contain the films. Small source-upload deployments
// can omit them and restore the exact approved files from this immutable commit.
const mediaRevision = 'dc6ba757bef22fe1f83cf53ffd38dd4e804e974c';
const base = `https://raw.githubusercontent.com/pdxor/equirectangular-cinemagraph-creator/${mediaRevision}/site/public`;
const stories = JSON.parse(await readFile(new URL('../site/360/stories.json', import.meta.url), 'utf8'));
for (const story of stories) {
  const target = fileURLToPath(new URL('../site/public' + story.video, import.meta.url));
  try { await access(target); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`Restoring published film: ${story.slug}`);
  const response = await fetch(base + story.video, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Could not fetch ${story.slug}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== story.bytes || createHash('sha256').update(bytes).digest('hex') !== story.sha256) {
    throw new Error(`Published media integrity check failed: ${story.slug}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
