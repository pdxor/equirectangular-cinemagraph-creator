import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { normalizeRegion } from '../shared/geometry.js';
import { ffmpeg, probe, cropSquare, maskPixels, edgeCorrection, injectSphericalMetadata } from './media.js';

const number = z.number().finite();
const file = z.string().regex(/^[a-zA-Z0-9-]+\.(png|mp4|mp3|m4a)$/);
const id = z.string().min(1).max(100);
const region = z.object({ x: number, y: number, size: number });
const layer = z.object({ id, source: file, region, start: number.min(0).max(120).default(0), trim: number.min(0).max(120).default(0), duration: number.min(.1).max(120), playback: z.enum(['hold', 'loop']).default('hold'), feather: number.min(0).max(30).default(12), edgeMatch: z.boolean().default(true) });
const scene = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('video'), name: z.string().max(100), source: file, trim: number.min(0).max(600).default(0), duration: number.min(.4).max(120), volume: number.min(0).max(2).default(1) }),
  z.object({ id, type: z.literal('regions'), name: z.string().max(100), base: file, duration: number.min(.4).max(120), layers: z.array(layer).max(8) })
]);
const track = z.object({ id, source: file, name: z.string().max(100), kind: z.enum(['narration', 'sfx', 'music', 'import']), start: number.min(0).max(600).default(0), trim: number.min(0).max(600).default(0), duration: number.min(.1).max(600), volume: number.min(0).max(2).default(1), loop: z.boolean().default(false), fadeIn: number.min(0).max(10).default(0), fadeOut: number.min(0).max(10).default(0) });
export const movieSchema = z.object({ title: z.string().trim().min(1).max(100).default('My 360 film'), scenes: z.array(scene).max(24), tracks: z.array(track).max(16), outputWidth: z.union([z.literal(0),z.literal(2048),z.literal(4096),z.literal(8192)]).default(0), fps: z.union([z.literal(24),z.literal(30)]).default(24), audioDrafts: z.object({ narration: z.string().max(4000).optional(), sfx: z.string().max(4000).optional(), music: z.string().max(4000).optional() }).default({}) });
export const audioSchema = z.object({ kind: z.enum(['narration','sfx','music']), text: z.string().trim().min(1).max(4000), name: z.string().trim().max(100).default(''), voiceId: z.string().regex(/^[A-Za-z0-9_-]{0,100}$/).default(''), duration: number.min(.5).max(120).default(6), loop: z.boolean().default(false) }).superRefine((v, ctx) => {
  if (v.kind === 'sfx' && v.duration > 30) ctx.addIssue({ code:'custom', message:'Sound effects can be at most 30 seconds.' });
  if (v.kind === 'music' && v.duration < 3) ctx.addIssue({ code:'custom', message:'Music must be at least 3 seconds.' });
});

// Sources must belong to this project; client filenames never become arbitrary paths.
export function validateMovie(project, input, { render = false } = {}) {
  const movie = movieSchema.parse(input);
  const images = new Set(['original.png', ...project.exports.filter(e => e.kind === 'image').map(e => e.file)]);
  const videos = new Set([...project.exports.filter(e => e.kind === 'video').map(e => e.file), ...(project.media || []).filter(e => e.kind === 'scene').map(e => e.file)]);
  const clips = new Set([...project.exports.map(e => e.clip).filter(Boolean), ...(project.clips || []).map(e => e.file), project.clip?.file].filter(Boolean));
  const audio = new Set((project.audio || []).map(e => e.file));
  const duration = movie.scenes.reduce((n, s) => n + s.duration, 0);
  if (duration > 600) throw new Error('Keep the final video within 10 minutes.');
  if (render && !movie.scenes.length) throw new Error('Add at least one scene to your film.');
  for (const s of movie.scenes) {
    if (s.type === 'video' && !videos.has(s.source)) throw new Error('A scene video is not in this project.');
    if (s.type === 'regions') {
      if (!images.has(s.base)) throw new Error('The scene panorama is not in this project.');
      for (const l of s.layers) {
        if (!clips.has(l.source)) throw new Error('A region clip is not in this project.');
        l.region = normalizeRegion(l.region, project.width, project.height);
        if (l.start >= s.duration || l.start + l.duration > s.duration + .05) throw new Error('Each region must fit within its scene duration.');
      }
    }
  }
  for (const t of movie.tracks) {
    if (!audio.has(t.source)) throw new Error('An audio track is not in this project.');
    if (render && t.start >= duration) throw new Error('An audio track starts after the film ends.');
    if (t.fadeIn + t.fadeOut > t.duration) throw new Error('Audio fades must fit within the track duration.');
  }
  return movie;
}

const encoding = ['-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-threads','4'];
const soundEncoding = ['-c:a','aac','-b:a','192k','-ar','48000','-ac','2'];
const cleanMetadata = ['-map_metadata','-1','-map_chapters','-1'];
async function renderRegionScene({ project, scene, dir, workDir, output, width, height, fps, signal }) {
  const base = path.join(dir, scene.base), baseImage = path.join(workDir,'base.png');
  await sharp(base).resize(width,height).png().toFile(baseImage);
  const args = ['-loop','1','-framerate',String(fps),'-i',baseImage];
  const graph = []; let input = 1, previous = '0:v';
  for (const [i, l] of scene.layers.entries()) {
    const scale=width/project.width, size=Math.max(2,Math.round(l.region.size*scale/2)*2);
    const x=Math.round(l.region.x*scale)%width, y=Math.min(Math.round(l.region.y*scale),height-size);
    const source=path.join(dir,l.source), info=await probe(source);
    if (l.trim >= Number(info.format.duration) - .05) throw new Error('Region trim starts after its clip ends.');
    const normalized=path.join(workDir,'region-'+i+'.mp4'), mask=path.join(workDir,'mask-'+i+'.png');
    const workingSize=Math.min(720,size);
    // Trim once before repeating, so a loop never reintroduces discarded frames.
    await ffmpeg(['-ss',String(l.trim),'-i',source,'-t',String(Math.min(l.duration,Number(info.format.duration)-l.trim)),'-vf',`scale=${workingSize}:${workingSize}:force_original_aspect_ratio=increase,crop=${workingSize}:${workingSize},setsar=1,fps=${fps}`,'-an',...encoding,normalized],{signal});
    if (l.playback === 'loop') args.push('-stream_loop','-1');
    args.push('-i',normalized); const clipIndex=input++;
    await sharp(maskPixels(size,l.feather),{raw:{width:size,height:size,channels:1}}).png().toFile(mask);
    args.push('-loop','1','-framerate',String(fps),'-i',mask); const maskIndex=input++;
    const timing=`tpad=stop_mode=clone:stop_duration=${l.duration},trim=duration=${l.duration},setpts=PTS-STARTPTS`;
    graph.push(`[${clipIndex}:v]scale=${size}:${size},${timing},format=gbrp[p${i}]`);
    let patch='p'+i;
    if (l.edgeMatch) {
      const first=path.join(workDir,'frame-'+i+'.png'), correction=path.join(workDir,'correction-'+i+'.png');
      await ffmpeg(['-i',normalized,'-frames:v','1',first],{signal});
      await fs.writeFile(correction,await edgeCorrection(await cropSquare(base,l.region,project.width),first,size));
      args.push('-loop','1','-framerate',String(fps),'-i',correction); const correctionIndex=input++;
      graph.push(`[${correctionIndex}:v]format=gbrp[c${i}]`);
      graph.push(`[p${i}][c${i}]blend=all_expr=clip(A+B-128\\,0\\,255):shortest=1[matched${i}]`);patch='matched'+i;
    }
    graph.push(`[${patch}]format=rgba[rgb${i}]`);
    graph.push(`[${maskIndex}:v]format=gray[m${i}]`);
    graph.push(`[rgb${i}][m${i}]alphamerge=shortest=1,setpts=PTS+${l.start}/TB[a${i}]`);
    const overlay=`:shortest=0:eof_action=pass:repeatlast=0:format=rgb:enable='gte(t,${l.start})*lt(t,${l.start+l.duration})'`;
    if (x+size>width) {
      graph.push(`[a${i}]split[a${i}r][a${i}l]`);
      graph.push(`[${previous}][a${i}r]overlay=x=${x}:y=${y}${overlay}[wrap${i}]`);
      graph.push(`[wrap${i}][a${i}l]overlay=x=${x-width}:y=${y}${overlay}[v${i}]`);
    } else graph.push(`[${previous}][a${i}]overlay=x=${x}:y=${y}${overlay}[v${i}]`);
    previous='v'+i;
  }
  graph.push(`[${previous}]format=yuv420p[out]`);
  args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
  await ffmpeg([...args,'-filter_complex_threads','1','-filter_complex',graph.join(';'),'-map','[out]','-map',`${input}:a`,'-t',String(scene.duration),'-r',String(fps),...encoding,...soundEncoding,...cleanMetadata,output],{signal});
}

export async function renderMovie({ project, movie, dir, workDir, output, signal, progress = () => {} }) {
  const width=Math.floor(Math.min(movie.outputWidth || project.width,project.width,8192)/4)*4,height=width/2,fps=movie.fps;
  const sceneFiles=[]; let duration=0;
  for (const [i, original] of movie.scenes.entries()) {
    signal?.throwIfAborted();
    const s={...original,duration:Math.round(original.duration*fps)/fps}; duration+=s.duration;
    const sceneDir=path.join(workDir,'scene-'+i);await fs.mkdir(sceneDir,{recursive:true});
    const rendered=path.join(sceneDir,'scene.mp4');
    progress(5+60*i/movie.scenes.length,`Rendering scene ${i+1} of ${movie.scenes.length}: ${s.name}`);
    if (s.type === 'regions') await renderRegionScene({project,scene:s,dir,workDir:sceneDir,output:rendered,width,height,fps,signal});
    else {
      const source=path.join(dir,s.source),info=await probe(source),v=info.streams.find(s=>s.codec_type==='video');
      if (!v || v.width !== v.height*2) throw new Error('Scene video must be a full 2:1 panorama.');
      if (s.trim+s.duration > Number(info.format.duration)+.08) throw new Error(`Scene ${i+1} extends past the source clip. Shorten its duration or trim.`);
      const audio=info.streams.some(s=>s.codec_type==='audio');
      await ffmpeg(['-ss',String(s.trim),'-i',source,...(audio?[]:['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']),'-map','0:v:0','-map',audio?'0:a:0':'1:a:0','-t',String(s.duration),'-vf',`scale=${width}:${height},setsar=1,fps=${fps},setpts=PTS-STARTPTS`,'-af',`aresample=48000,asetpts=PTS-STARTPTS,volume=${s.volume},apad`,...encoding,...soundEncoding,...cleanMetadata,rendered],{signal});
    }
    sceneFiles.push(rendered);
  }
  const concatFile=path.join(workDir,'scenes.txt'),joined=path.join(workDir,'joined.mp4');
  // All paths below are generated locally and use only fixed names and indices.
  await fs.writeFile(concatFile,sceneFiles.map((_,i)=>`file 'scene-${i}/scene.mp4'`).join('\n'));
  progress(70,'Stitching scenes in timeline order');
  await ffmpeg(['-f','concat','-safe','1','-i',concatFile,'-c','copy',...cleanMetadata,joined],{signal});
  const args=['-i',joined],filters=['[0:a]aresample=48000,asetpts=PTS-STARTPTS[original]'],labels=['[original]'];
  for (const [i,t] of movie.tracks.entries()) {
    const source=path.join(dir,t.source),info=await probe(source),available=Number(info.format.duration)-t.trim;
    if (available<.05) throw new Error('Audio trim starts after the clip ends.');
    if (!t.loop && t.duration>available+.1) throw new Error('An audio track is longer than its source. Shorten it or enable Repeat.');
    const trimmed=path.join(workDir,'audio-'+i+'.wav');
    await ffmpeg(['-ss',String(t.trim),'-i',source,'-t',String(Math.min(t.duration,available)),'-vn','-ar','48000','-ac','2','-c:a','pcm_s16le',trimmed],{signal});
    if(t.loop)args.push('-stream_loop','-1');
    args.push('-i',trimmed);
    const active=Math.min(t.duration,duration-t.start),fadeIn=Math.min(t.fadeIn,active/2),fadeOut=Math.min(t.fadeOut,active/2);
    let filter=`[${i+1}:a]atrim=duration=${active},asetpts=PTS-STARTPTS,volume=${t.volume}`;
    if(fadeIn)filter+=`,afade=t=in:st=0:d=${fadeIn}`;
    if(fadeOut)filter+=`,afade=t=out:st=${active-fadeOut}:d=${fadeOut}`;
    filter+=`,adelay=${Math.round(t.start*1000)}:all=1[a${i}]`;filters.push(filter);labels.push(`[a${i}]`);
  }
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0:latency=1,apad,atrim=duration=${duration}[sound]`);
  progress(85,'Mixing narration, effects and music');
  await ffmpeg([...args,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','0:v:0','-map','[sound]','-c:v','copy',...soundEncoding,'-t',String(duration),...cleanMetadata,'-metadata','title='+movie.title,output],{signal});
  progress(97,'Embedding and verifying 360° metadata after the audio mix');
  await injectSphericalMetadata(output,width,height);
  const checked=await probe(output),video=checked.streams.find(s=>s.codec_type==='video');
  const spherical=video?.side_data_list?.some(s=>s.side_data_type==='Spherical Mapping' && s.projection==='equirectangular');
  if (!spherical || !checked.streams.some(s=>s.codec_type==='audio'&&s.codec_name==='aac')) throw new Error('Final video verification failed: missing spherical metadata or AAC audio.');
  return { width,height,fps,duration:Number(checked.format.duration),sceneCount:movie.scenes.length,audioTracks:movie.tracks.length,spherical:true };
}
