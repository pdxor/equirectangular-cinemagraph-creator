import sharp from 'sharp';
import path from 'node:path';
import { normalizeOverlay } from '../shared/geometry.js';

export async function inspectOverlay(input) {
  const image = sharp(input, { limitInputPixels: 16777216 });
  const meta = await image.metadata();
  if (meta.format !== 'png' || meta.width > 4096 || meta.height > 4096) throw new Error('Use a transparent PNG up to 4096 pixels on each side.');
  if (!meta.hasAlpha) throw new Error('This PNG has no transparency. Upload a PNG cutout with an alpha channel.');
  const { channels } = await image.ensureAlpha().toColourspace('srgb').stats();
  const alpha = channels.at(-1);
  if (alpha.min === 255) throw new Error('This PNG has no transparent pixels. Use a cutout with a transparent background.');
  if (alpha.max === 0) throw new Error('The PNG is completely transparent. Choose an image with a visible subject.');
  return { width: meta.width, height: meta.height };
}

export function validateOverlays(project, placements) {
  if (!Array.isArray(placements) || !placements.length || placements.length > 32) throw new Error('Place between 1 and 32 PNG overlays.');
  return placements.map(p => {
    const asset = (project.overlays || []).find(a => a.file === p.source);
    if (!asset) throw new Error('Overlay not found in this project.');
    return normalizeOverlay(p, asset, project.width, project.height);
  });
}

export async function compositeOverlays({ base, placements, width, dir, output }) {
  const pieces = [];
  for (const p of placements) {
    // Preserve the original alpha; never replace it with a square feather mask.
    let image = sharp(path.join(dir, p.source)).resize(p.width, p.height, { fit: 'fill' }).toColourspace('srgb').ensureAlpha();
    if (p.opacity !== 1) image = image.linear([1, 1, 1, p.opacity], [0, 0, 0, 0]);
    const rgba = await image.png().toBuffer();
    const first = Math.min(p.width, width - p.x);
    pieces.push({input:await sharp(rgba).extract({left:0,top:0,width:first,height:p.height}).png().toBuffer(),left:p.x,top:p.y});
    if(first < p.width) pieces.push({input:await sharp(rgba).extract({left:first,top:0,width:p.width-first,height:p.height}).png().toBuffer(),left:0,top:p.y});
  }
  await sharp(base).composite(pieces).png().toFile(output);
}
