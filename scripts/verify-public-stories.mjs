import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const stories = JSON.parse(await readFile(new URL('../site/360/stories.json', import.meta.url), 'utf8'));
assert.equal(stories.length, 10, 'The public collection must contain ten stories');
assert.equal(new Set(stories.map(story => story.slug)).size, 10, 'Story IDs must be unique');
for (const story of stories) {
  assert.equal(story.width, story.height * 2, `${story.slug}: full equirectangular dimensions`);
  assert.equal(story.duration, 30);
  const file = fileURLToPath(new URL('../site/public' + story.video, import.meta.url));
  const bytes = await readFile(file);
  assert.equal(bytes.length, story.bytes, `${story.slug}: file size changed`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), story.sha256, `${story.slug}: original tagged MP4 changed`);
  const boxes = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size32 = bytes.readUInt32BE(offset);
    const size = size32 === 1 ? Number(bytes.readBigUInt64BE(offset + 8)) : size32 || bytes.length - offset;
    assert.ok(size >= 8 && offset + size <= bytes.length, 'Invalid MP4 box');
    boxes.push({ type: bytes.toString('ascii', offset + 4, offset + 8), offset, size });
    offset += size;
  }
  const moov = boxes.find(box => box.type === 'moov');
  const mdat = boxes.find(box => box.type === 'mdat');
  assert.ok(moov && mdat && moov.offset < mdat.offset, `${story.slug}: needs fast-start MP4`);
  const metadata = bytes.subarray(moov.offset, moov.offset + moov.size);
  assert.ok(metadata.includes(Buffer.from('equirectangular')), 'Missing spherical XML projection');
  assert.ok(metadata.includes(Buffer.from('sv3d')) && metadata.includes(Buffer.from('equi')), 'Missing spherical v2 boxes');
  for (const image of [story.poster, story.cover]) await readFile(new URL('../site/public' + image, import.meta.url));
  console.log(`${story.slug}: original SHA-256, 2:1, fast-start, spherical v1 + v2 verified`);
}
