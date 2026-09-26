import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, readConfig, safeError } from './config.js';
import { projectDir, getProject, saveProject, writeJson, idPattern } from './store.js';
import { cropSquare, compositeImage, previewImage, normalizeClip, exportVideo, probe } from './media.js';
import { remixImage, generateVideo, generateOverlay } from './providers.js';
import { inspectOverlay, compositeOverlays } from './overlays.js';
import { generateAudio } from './audio.js';
import { renderMovie } from './movie.js';

export const jobs = new Map();
const controllers = new Map();
let queue = Promise.resolve();
const jobFile = id => path.join(dataDir, 'jobs', id + '.json');
const saveJob = job => writeJson(jobFile(job.id), job);
export async function loadJobs() {
  const files = await fs.readdir(path.join(dataDir, 'jobs'));
  for (const file of files.filter(name => name.endsWith('.json'))) {
    try {
      const job = JSON.parse(await fs.readFile(path.join(dataDir, 'jobs', file), 'utf8'));
      if (['queued', 'running'].includes(job.status)) { job.status = 'failed'; job.message = 'App restarted. Resume this job to continue from saved results.'; await saveJob(job); }
      jobs.set(job.id, job);
    } catch { /* Ignore incomplete temporary records. */ }
  }
}
export function projectJobs(id) { return [...jobs.values()].filter(j => j.projectId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function isBusy(id) { return projectJobs(id).some(j => ['queued', 'running'].includes(j.status)); }
export async function createJob(project, options) {
  if (isBusy(project.id)) throw new Error('Wait for the current operation to finish.');
  const job = { id: randomUUID(), projectId: project.id, baseImage: project.image, clip: project.clip, patch: project.patch, options, status: 'queued', progress: 0, message: 'Waiting for the renderer', createdAt: new Date().toISOString() };
  jobs.set(job.id, job); await saveJob(job); enqueue(job); return job;
}
export async function resumeJob(id) {
  const job = jobs.get(id);
  if (!job || !idPattern.test(id)) throw new Error('Job not found.');
  if (!['failed', 'cancelled'].includes(job.status)) throw new Error('This job cannot be resumed.');
  if (isBusy(job.projectId)) throw new Error('Wait for the current operation to finish.');
  const project = await getProject(job.projectId);
  if (!['movie','audio','overlay'].includes(job.options.type) && ![job.baseImage, job.remixedImage].includes(project.image)) throw new Error('The panorama has changed since this job. Start a new operation on the current image.');
  job.status = 'queued'; job.message = 'Resuming saved job'; delete job.error;
  await saveJob(job); enqueue(job); return job;
}
export async function cancelJob(id) {
  const job = jobs.get(id);
  if (!job || !['queued', 'running'].includes(job.status)) throw new Error('No active job to cancel.');
  job.status = 'cancelled'; job.message = 'Stopped locally. A submitted provider request may still finish and be billed.';
  controllers.get(id)?.abort(); await saveJob(job); return job;
}
function enqueue(job) { queue = queue.catch(() => {}).then(() => runJob(job)); }
async function runJob(job) {
  if (job.status === 'cancelled') return;
  const controller = new AbortController(); controllers.set(job.id, controller);
  const signal = controller.signal;
  job.status = 'running'; job.error = null;
  let previousMessage = '', lastSaved = 0;
  function progress(value, message) {
    job.progress = Math.round(value); job.message = message;
    if (message !== previousMessage || Date.now() - lastSaved > 1000) { previousMessage = message; lastSaved = Date.now(); void saveJob(job).catch(() => {}); }
  }
  try {
    await saveJob(job);
    const project = await getProject(job.projectId), config = await readConfig();
    const dir = projectDir(project.id), workDir = path.join(dataDir, 'jobs', job.id);
    await fs.mkdir(workDir, { recursive: true });
    const { type, region, feather, edgeMatch, imagePrompt, videoPrompt, duration, resolution, loopMode, outputWidth, fps } = job.options;
    if (type === 'overlay') {
      const file = job.id + '-overlay.png', destination = path.join(dir, file);
      if (!job.generatedOverlay) {
        progress(15, 'OpenAI is creating a transparent PNG');
        const buffer = await generateOverlay({prompt:job.options.prompt, config, signal});
        await fs.writeFile(destination,buffer); job.generatedOverlay=file; await saveJob(job);
      }
      signal.throwIfAborted();
      const dimensions=await inspectOverlay(destination), latest=await getProject(project.id);
      latest.overlays=(latest.overlays||[]).filter(a=>a.id!==job.id);
      latest.overlays.push({id:job.id,file,...dimensions,name:job.options.prompt.slice(0,65),prompt:job.options.prompt,provider:'OpenAI'});
      await saveProject(latest); job.output=file;
    } else if (type === 'composite-overlays') {
      const file=job.id+'-image.png',preview=job.id+'-preview.jpg';
      progress(30,'Compositing transparent PNG layers');
      await compositeOverlays({base:path.join(dir,job.baseImage),placements:job.options.overlays,width:project.width,dir,output:path.join(dir,file)});
      signal.throwIfAborted();
      await previewImage(path.join(dir,file),path.join(dir,preview));
      const latest=await getProject(project.id);latest.image=file;latest.preview=preview;latest.updatedAt=new Date().toISOString();
      latest.exports=latest.exports.filter(e=>e.id!==job.id+'-image');
      latest.exports.push({id:job.id+'-image',kind:'image',name:'Panorama with PNG overlays',file,preview,width:project.width,height:project.height,createdAt:latest.updatedAt});
      await saveProject(latest);job.remixedImage=file;job.output=file;
    } else if (type === 'movie') {
      const file = job.id + '-film-360.mp4';
      const result = await renderMovie({ project, movie: job.options.movie, dir, workDir, output: path.join(dir,file), signal, progress });
      const latest=await getProject(project.id);latest.updatedAt=new Date().toISOString();
      latest.exports=latest.exports.filter(e=>e.id!==job.id+'-movie');
      latest.exports.push({ id:job.id+'-movie', kind:'video', role:'movie', name:job.options.movie.title, file, createdAt:latest.updatedAt, ...result });
      await saveProject(latest);job.output=file;
    } else if (type === 'audio') {
      const file=job.id+'-audio.mp3', destination=path.join(dir,file);
      if (!job.generatedAudio) {
        progress(15,'ElevenLabs is creating your '+job.options.audio.kind);
        const result=await generateAudio({...job.options.audio,config,signal});
        await fs.writeFile(destination,result.buffer);job.generatedAudio=file;job.audioRequestId=result.requestId;await saveJob(job);
      }
      signal.throwIfAborted();
      const info=await probe(destination),seconds=Number(info.format.duration);
      if (!info.streams.some(s=>s.codec_type==='audio') || !Number.isFinite(seconds) || seconds<=0) throw new Error('ElevenLabs did not return a playable audio file.');
      const latest=await getProject(project.id);latest.audio=(latest.audio||[]).filter(a=>a.id!==job.id);
      latest.audio.push({id:job.id,file,kind:job.options.audio.kind,name:job.options.audio.name||job.options.audio.text.slice(0,65),duration:seconds,prompt:job.options.audio.text,createdAt:new Date().toISOString(),provider:'ElevenLabs'});
      await saveProject(latest);job.output=file;
    } else {
    let base = path.join(dir, job.remixedImage || job.baseImage);
    let crop = await cropSquare(base, region, project.width);
    progress(5, 'Extracting the square region');
    if (['image', 'both', 'stitch-image'].includes(type) && !job.remixedImage) {
      let patch;
      if (type === 'stitch-image') {
        if (!job.patch) throw new Error('Import a square image patch first.');
        patch = await fs.readFile(path.join(dir, job.patch));
      } else {
        progress(12, 'OpenAI is remixing the selected area');
        patch = await remixImage({ crop, prompt: imagePrompt, config, signal });
      }
      signal.throwIfAborted();
      const name = job.id + '-image.png';
      await fs.writeFile(path.join(dir, job.id + '-patch.png'), patch);
      await compositeImage(base, patch, region, project.width, feather, path.join(dir, name));
      await previewImage(path.join(dir, name), path.join(dir, job.id + '-preview.jpg'));
      project.image = name; project.preview = job.id + '-preview.jpg'; project.updatedAt = new Date().toISOString();
      project.exports.push({ id: job.id + '-image', kind: 'image', file: name, preview: project.preview, createdAt: project.updatedAt, width: project.width, height: project.height, region });
      await saveProject(project);
      job.remixedImage = name; await saveJob(job);
      base = path.join(dir, name); crop = await cropSquare(base, region, project.width);
    }
    if (['video', 'both', 'video-edit', 'stitch-video'].includes(type)) {
      let clipPath;
      if (type === 'stitch-video') {
        if (!job.clip) throw new Error('Import a video clip first.');
        clipPath = path.join(dir, job.clip.file);
      } else if (job.generatedClip) {
        clipPath = path.join(dir, job.generatedClip);
      } else {
        let editClip;
        if (type === 'video-edit') {
          if (!job.clip) throw new Error('Import a video clip first.');
          if (job.clip.duration > 8.7) throw new Error('Grok video edits require clips no longer than 8.7 seconds.');
          editClip = path.join(workDir, 'edit-input.mp4');
          await normalizeClip(path.join(dir, job.clip.file), editClip, { duration: 8.7, signal });
        }
        progress(28, type === 'video-edit' ? 'Grok is remixing the clip' : 'Sending the square to Grok');
        const video = await generateVideo({ crop, clip: editClip, prompt: videoPrompt, duration, resolution, config, signal, progress, requestId: job.requestId, onRequestId: async id => { job.requestId = id; await saveJob(job); } });
        job.generatedClip = job.id + '-clip.mp4';
        clipPath = path.join(dir, job.generatedClip); await fs.writeFile(clipPath, video); await saveJob(job);
      }
      signal.throwIfAborted();
      const outputName = job.id + '-360.mp4';
      const result = await exportVideo({ base, clip: clipPath, region, width: project.width, height: project.height, outputWidth, fps, loopMode, feather, edgeMatch, workDir, output: path.join(dir, outputName), signal, progress });
      const latest = await getProject(project.id);
      latest.updatedAt = new Date().toISOString();
      latest.exports = latest.exports.filter(e => e.id !== job.id + '-video');
      latest.exports.push({ id: job.id + '-video', kind: 'video', file: outputName, clip: job.generatedClip || job.clip?.file, createdAt: latest.updatedAt, region, ...result });
      await saveProject(latest);
      job.output = outputName;
    }
    }
    job.status = 'done'; job.progress = 100; job.message = 'Ready to download';
  } catch (error) {
    job.status = signal.aborted ? 'cancelled' : 'failed';
    job.error = safeError(error);
    job.message = signal.aborted ? 'Stopped locally. Submitted AI jobs may still be billed.' : job.error;
  } finally { controllers.delete(job.id); await saveJob(job); }
}
