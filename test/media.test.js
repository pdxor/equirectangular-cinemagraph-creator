import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeRegion, squareFromPoints, regionSegments } from '../shared/geometry.js';
import { cropSquare, compositeImage, ffmpeg, probe, exportVideo, maskPixels } from '../server/media.js';

test('lasso becomes a square, including a selection over longitude seam', () => {
  assert.deepEqual(squareFromPoints([{ x: 480, y: 80 }, { x: 8, y: 110 }], 512, 256), { x: 480, y: 75, size: 40 });
  assert.deepEqual(normalizeRegion({ x: -16, y: 50, size: 64 }, 512, 256), { x: 496, y: 50, size: 64 });
  assert.throws(() => normalizeRegion({ x: 0, y: 230, size: 64 }, 512, 256));
  assert.equal(regionSegments({ x: 490, y: 20, size: 64 }, 512).reduce((n,p) => n+p.width, 0), 64);
});
test('mask keeps outermost pixel static and smoothly feathers to opacity', () => {
  const mask = maskPixels(100, 10);
  assert.equal(mask[50], 0); assert.equal(mask[5 * 100 + 50], 128); assert.equal(mask[50 * 100 + 50], 255);
});
test('wrapped image composite only modifies the selected square', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinemagraph-image-'));
  const base = path.join(dir,'base.png'), output = path.join(dir,'out.png');
  await sharp({create:{width:512,height:256,channels:3,background:'#102030'}}).png().toFile(base);
  const patch = await sharp({create:{width:64,height:64,channels:3,background:'#e03040'}}).png().toBuffer();
  const r = {x:490,y:64,size:64};
  const cropped = await cropSquare(base,r,512); assert.equal((await sharp(cropped).metadata()).width,64);
  await compositeImage(base,patch,r,512,8,output);
  const before = await sharp(base).removeAlpha().raw().toBuffer(), after = await sharp(output).removeAlpha().raw().toBuffer();
  let outsideDifferences=0, insideDifferences=0;
  for(let y=0;y<256;y++)for(let x=0;x<512;x++){
    const inside=y>=64&&y<128&&(x>=490||x<42); const i=(y*512+x)*3;
    if(!before.subarray(i,i+3).equals(after.subarray(i,i+3))) {if(inside)insideDifferences++;else outsideDifferences++;}
  }
  assert.equal(outsideDifferences,0); assert.ok(insideDifferences>3000);
});
for (const loopMode of ['crossfade','pingpong','none']) test('real FFmpeg ' + loopMode + ' export with wrapped patch and spherical metadata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-video-'));
  const base=path.join(dir,'base.png'),clip=path.join(dir,'clip.mp4'),out=path.join(dir,'out.mp4');
  await sharp({create:{width:512,height:256,channels:3,background:'#102030'}}).png().toFile(base);
  await ffmpeg(['-f','lavfi','-i','testsrc2=size=64x64:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p',clip]);
  const result = await exportVideo({base,clip,region:{x:490,y:64,size:64},width:512,height:256,outputWidth:512,loopMode,feather:8,workDir:dir,output:out});
  const info=await probe(out),video=info.streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,512); assert.equal(video.height,256); assert.equal(video.codec_name,'h264');
  assert.equal(video.pix_fmt,'yuv420p'); assert.ok(Math.abs(Number(info.format.duration)-result.duration)<.12);
  assert.ok(video.side_data_list?.some(s=>s.side_data_type==='Spherical Mapping' && s.projection==='equirectangular'), JSON.stringify(video.side_data_list));
  const raw=path.join(dir,'frame.rgb');
  await ffmpeg(['-ss','0.5','-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',raw]);
  const pixels=await fs.readFile(raw),i=(180*512+250)*3;
  assert.ok(Math.abs(pixels[i]-16)<8&&Math.abs(pixels[i+1]-32)<8&&Math.abs(pixels[i+2]-48)<8,'Unselected region remains still within codec tolerance');
});
