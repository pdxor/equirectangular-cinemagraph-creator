import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { normalizeRegion, regionSegments } from '../shared/geometry.js';

sharp.cache({ memory: 128, files: 20, items: 40 });
sharp.concurrency(2);
export function command(binary, args, { signal, onProgress, timeout = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', finished = false;
    const abort = () => { child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); finish(new Error('Operation cancelled.')); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); finish(new Error(binary + ' timed out after ' + Math.round(timeout / 1000) + ' seconds.')); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', b => { stdout = (stdout + b.toString()).slice(-100000); onProgress?.(b.toString()); });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-6000); });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 ? null : new Error(signal?.aborted ? 'Operation cancelled.' : binary + ' failed: ' + stderr.slice(-1800))));
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(stdout);
    }
  });
}
export const ffmpeg = (args, options) => command(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], options);
export async function probe(file) {
  return JSON.parse(await command(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 20000 }));
}
export async function cropSquare(input, region, width) {
  const pieces = await Promise.all(regionSegments(region, width).map(async p => ({
    input: await sharp(input).extract({ left: p.x, top: p.y, width: p.width, height: region.size }).png().toBuffer(), left: p.offset, top: 0
  })));
  return sharp({ create: { width: region.size, height: region.size, channels: 3, background: '#000000' } }).composite(pieces).png().toBuffer();
}
export function maskPixels(size, featherPercent = 8) {
  const pixels = Buffer.alloc(size * size);
  const feather = Math.max(0, size * featherPercent / 100);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.min(x, y, size - 1 - x, size - 1 - y);
    const t = feather ? Math.min(1, distance / feather) : 1;
    pixels[y * size + x] = Math.round(255 * t * t * (3 - 2 * t));
  }
  return pixels;
}
export async function compositeImage(base, patch, region, width, feather, output) {
  const mask = maskPixels(region.size, feather);
  const rgba = await sharp(patch).resize(region.size, region.size, { fit: 'fill' }).removeAlpha()
    .joinChannel(mask, { raw: { width: region.size, height: region.size, channels: 1 } }).png().toBuffer();
  const pieces = await Promise.all(regionSegments(region, width).map(async p => ({
    input: await sharp(rgba).extract({ left: p.offset, top: 0, width: p.width, height: region.size }).png().toBuffer(), left: p.x, top: p.y
  })));
  await sharp(base).composite(pieces).png().toFile(output);
}
export async function previewImage(input, output) {
  await sharp(input).resize({ width: 2048, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(output);
}
// Match low-frequency color at the crop perimeter without sampling its subject.
// Left/right edge differences are smoothed by row and interpolated across x.
// This leaves local detail intact and reduces rectangular sky/exposure seams.
export async function edgeCorrection(baseCrop, firstFrame, size) {
  const a = await sharp(baseCrop).resize(size,size).removeAlpha().raw().toBuffer();
  const b = await sharp(firstFrame).resize(size,size).removeAlpha().raw().toBuffer();
  const band = Math.max(2,Math.floor(size*.08)), rows = new Float32Array(size*6);
  for(let y=0;y<size;y++)for(let edge=0;edge<2;edge++)for(let c=0;c<3;c++){
    let sum=0;
    for(let x=0;x<band;x++){const ix=edge ? size-1-x : x;const i=(y*size+ix)*3+c;sum+=a[i]-b[i];}
    rows[y*6+edge*3+c]=sum/band;
  }
  const output=Buffer.alloc(size*size*3), radius=Math.max(2,Math.floor(size*.025));
  for(let y=0;y<size;y++){
    const smooth=new Float32Array(6);let count=0;
    for(let row=Math.max(0,y-radius);row<=Math.min(size-1,y+radius);row++){for(let k=0;k<6;k++)smooth[k]+=rows[row*6+k];count++;}
    for(let x=0;x<size;x++)for(let c=0;c<3;c++){
      const t=x/(size-1),offset=(smooth[c]*(1-t)+smooth[c+3]*t)/count;
      output[(y*size+x)*3+c]=Math.round(Math.max(0,Math.min(255,128+offset)));
    }
  }
  return sharp(output,{raw:{width:size,height:size,channels:3}}).png().toBuffer();
}
export async function normalizeClip(input, output, { size = 720, fps = 24, duration = 15, signal } = {}) {
  await ffmpeg(['-i', input, '-map', '0:v:0', '-t', String(duration), '-vf', 'scale=' + size + ':' + size + ':force_original_aspect_ratio=increase,crop=' + size + ':' + size + ',setsar=1,fps=' + fps + ',format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', output], { signal });
}

// Appends spherical-video v1 metadata to the video track. The source MP4 must
// have its moov after mdat, so enlarging moov cannot invalidate chunk offsets.
export async function injectSphericalMetadata(file, width, height) {
  const handle = await fs.open(file, 'r+');
  try {
    const stat = await handle.stat();
    let cursor = 0, moovOffset = -1, moovSize = 0;
    while (cursor + 8 <= stat.size) {
      const header = Buffer.alloc(16); await handle.read(header, 0, 16, cursor);
      let size = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      if (size === 1) size = Number(header.readBigUInt64BE(8));
      if (size === 0) size = stat.size - cursor;
      if (size < 8 || cursor + size > stat.size) throw new Error('Invalid MP4 structure.');
      if (type === 'moov') { moovOffset = cursor; moovSize = size; break; }
      cursor += size;
    }
    if (moovOffset < 0 || moovOffset + moovSize !== stat.size) throw new Error('Expected a final moov box for spherical metadata.');
    const moov = Buffer.alloc(moovSize); await handle.read(moov, 0, moovSize, moovOffset);
    let pos = 8, trackOffset = -1, trackSize = 0;
    while (pos + 8 <= moov.length) {
      const size = moov.readUInt32BE(pos), type = moov.toString('ascii', pos + 4, pos + 8);
      if (size < 8) throw new Error('Invalid MP4 child box.');
      if (type === 'trak') { trackOffset = pos; trackSize = size; break; } // Renderers always map video before audio.
      pos += size;
    }
    if (trackOffset < 0) throw new Error('MP4 video track not found.');
    const xml = Buffer.from('<?xml version="1.0"?><rdf:SphericalVideo xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/"><GSpherical:Spherical>true</GSpherical:Spherical><GSpherical:Stitched>true</GSpherical:Stitched><GSpherical:StitchingSoftware>Equirectangular Cinemagraph Creator</GSpherical:StitchingSoftware><GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType><GSpherical:StereoMode>mono</GSpherical:StereoMode><GSpherical:FullPanoWidthPixels>' + width + '</GSpherical:FullPanoWidthPixels><GSpherical:FullPanoHeightPixels>' + height + '</GSpherical:FullPanoHeightPixels></rdf:SphericalVideo>');
    const box = Buffer.alloc(24 + xml.length);
    box.writeUInt32BE(box.length); box.write('uuid', 4);
    Buffer.from('ffcc8263f8554a938814587a02521fdd', 'hex').copy(box, 8); xml.copy(box, 24);
    const end = trackOffset + trackSize;
    const updated = Buffer.concat([moov.subarray(0, end), box, moov.subarray(end)]);
    updated.writeUInt32BE(updated.length, 0); updated.writeUInt32BE(trackSize + box.length, trackOffset);
    await handle.write(updated, 0, updated.length, moovOffset);
    await handle.truncate(moovOffset + updated.length);
  } finally { await handle.close(); }
}
export async function exportVideo({ base, clip, region, width, height, outputWidth = 2048, fps = 24, loopMode = 'crossfade', feather = 8, edgeMatch = true, workDir, output, signal, progress = () => {} }) {
  normalizeRegion(region, width, height);
  const ow = Math.floor(Math.min(outputWidth || width, width, 8192) / 4) * 4, oh = ow / 2;
  const scale = ow / width;
  const side = Math.max(16, Math.round(region.size * scale));
  const cx = Math.round(region.x * scale) % ow, cy = Math.min(Math.round(region.y * scale), oh - side);
  const normalized = path.join(workDir, 'normalized.mp4'), looped = path.join(workDir, 'loop.mp4');
  const workingSide = Math.min(720, Math.ceil(side / 2) * 2);
  progress(60, 'Preparing the square clip');
  await normalizeClip(clip, normalized, { size: workingSide, fps, signal });
  const info = await probe(normalized);
  const duration = Number(info.format.duration);
  if (!Number.isFinite(duration) || duration < 0.4) throw new Error('Video must be at least 0.4 seconds long.');
  let loopDuration = duration;
  if (loopMode === 'pingpong') {
    loopDuration = duration * 2;
    await ffmpeg(['-i', normalized, '-filter_complex_threads', '1', '-filter_complex', '[0:v]split[f][r];[r]reverse,setpts=PTS-STARTPTS[rev];[f][rev]concat=n=2:v=1:a=0[out]', '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', looped], { signal });
  } else if (loopMode === 'crossfade') {
    const fade = Math.min(0.75, duration / 4);
    loopDuration = duration - fade;
    const graph = '[0:v]split=3[b][t][h];[b]trim=start=' + fade + ':end=' + (duration - fade) + ',setpts=PTS-STARTPTS[body];[t]trim=start=' + (duration - fade) + ',setpts=PTS-STARTPTS[tail];[h]trim=end=' + fade + ',setpts=PTS-STARTPTS[head];[tail][head]xfade=transition=fade:duration=' + fade + ':offset=0[mix];[body][mix]concat=n=2:v=1:a=0[out]';
    await ffmpeg(['-i', normalized, '-filter_complex_threads', '1', '-filter_complex', graph, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', looped], { signal });
  } else { await fs.copyFile(normalized, looped); }
  const maskPath = path.join(workDir, 'mask.png'), resizedBase = path.join(workDir, 'export-base.png');
  await sharp(maskPixels(side, feather), { raw: { width: side, height: side, channels: 1 } }).png().toFile(maskPath);
  await sharp(base).resize(ow, oh).png().toFile(resizedBase);
  const correctionPath=path.join(workDir,'edge-correction.png');
  if(edgeMatch){
    const firstFrame=path.join(workDir,'first-frame.png');
    await ffmpeg(['-i',normalized,'-frames:v','1',firstFrame],{signal});
    const baseCrop=await cropSquare(base,region,width);
    await fs.writeFile(correctionPath,await edgeCorrection(baseCrop,firstFrame,side));
  }
  progress(75, 'Stitching the 360° video with FFmpeg');
  let graph = edgeMatch ? '[1:v]scale=' + side + ':' + side + ',format=gbrp[scaled];[3:v]format=gbrp[correction];[scaled][correction]blend=all_expr=clip(A+B-128\\,0\\,255):shortest=1,format=rgba[patch];' : '[1:v]scale=' + side + ':' + side + ',format=rgba[patch];';
  graph+='[2:v]format=gray[mask];[patch][mask]alphamerge[alpha];';
  if (cx + side > ow) graph += '[alpha]split[a][b];[0:v][a]overlay=x=' + cx + ':y=' + cy + ':shortest=1:format=rgb[first];[first][b]overlay=x=' + (cx - ow) + ':y=' + cy + ':shortest=1:format=rgb,format=yuv420p[out]';
  else graph += '[0:v][alpha]overlay=x=' + cx + ':y=' + cy + ':shortest=1:format=rgb,format=yuv420p[out]';
  await ffmpeg(['-loop', '1', '-framerate', String(fps), '-i', resizedBase, '-i', looped, '-loop', '1', '-framerate', String(fps), '-i', maskPath, ...(edgeMatch?['-loop','1','-framerate',String(fps),'-i',correctionPath]:[]), '-filter_complex_threads', '1', '-filter_complex', graph, '-map', '[out]', '-t', String(loopDuration), '-r', String(fps), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4', '-metadata', 'title=Equirectangular Cinemagraph', '-progress', 'pipe:1', output], { signal, onProgress: chunk => { const m = chunk.match(/out_time_us=(\d+)/); if (m) progress(Math.min(97, 75 + 22 * Number(m[1]) / (loopDuration * 1000000)), 'Rendering panorama'); } });
  progress(98, 'Embedding 360° video metadata');
  await injectSphericalMetadata(output, ow, oh);
  return { width: ow, height: oh, duration: loopDuration, fps };
}
