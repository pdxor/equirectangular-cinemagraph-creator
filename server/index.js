import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { readConfig, publicConfig, saveConfig, dataDir, root, safeError } from './config.js';
import { initializeStorage, projectDir, getProject, saveProject, listProjects, idPattern } from './store.js';
import { loadJobs, jobs, projectJobs, createJob, resumeJob, cancelJob, isBusy } from './jobs.js';
import { previewImage, probe, command, cropSquare, ffmpeg } from './media.js';
import { normalizeRegion } from '../shared/geometry.js';
import { validateMovie, audioSchema } from './movie.js';
import { listVoices } from './audio.js';
import { inspectOverlay, validateOverlays } from './overlays.js';

export async function createApp({ dev = false } = {}) {
  await initializeStorage(); await loadJobs();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostname = req.hostname;
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return res.status(403).json({ error: 'This app only accepts localhost requests.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin');
      if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin writes are blocked.' });
      if (req.get('X-Cinemagraph-Client') !== '1') return res.status(403).json({ error: 'Missing local app request header.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const upload = multer({ dest: path.join(dataDir, 'uploads'), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  app.get('/api/health', async (req, res) => {
    const available = await command(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { timeout: 5000 }).then(() => true, () => false);
    res.json({ ok: true, ffmpeg: available, ...await publicConfig() });
  });
  app.get('/api/settings', async (req, res) => res.json(await publicConfig()));
  app.put('/api/settings', async (req, res) => res.json(await saveConfig(req.body)));
  app.get('/api/voices', async (req,res) => res.json(await listVoices(await readConfig(), {search:String(req.query.search||''),cursor:String(req.query.cursor||'')})));
  app.get('/api/projects', async (req, res) => res.json(await listProjects()));
  app.get('/api/projects/:id', async (req, res) => res.json({ ...await getProject(req.params.id), jobs: projectJobs(req.params.id) }));
  app.get('/api/projects/:id/assets/:file', async (req, res) => {
    if (!/^[a-zA-Z0-9-]+\.(png|jpg|mp4|mp3|m4a)$/.test(req.params.file)) return res.status(400).json({ error: 'Invalid asset.' });
    const file = path.join(projectDir(req.params.id), req.params.file);
    if (req.query.download) res.download(file); else res.sendFile(file);
  });
  app.get('/api/projects/:id/crop', async (req, res) => {
    const p = await getProject(req.params.id);
    const r = normalizeRegion({ x: Number(req.query.x), y: Number(req.query.y), size: Number(req.query.size) }, p.width, p.height);
    res.type('png').send(await cropSquare(path.join(projectDir(p.id), p.image), r, p.width));
  });
  app.post('/api/projects', upload.single('panorama'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a panorama image.' });
    try {
      const meta = await sharp(req.file.path, { limitInputPixels: 135000000 }).metadata();
      if (!['jpeg', 'png', 'webp', 'tiff'].includes(meta.format)) throw new Error('Use a JPG, PNG, WebP or TIFF panorama.');
      if (meta.width !== meta.height * 2 || meta.width < 128 || meta.width > 16384) throw new Error('Use a full 2:1 equirectangular panorama, between 128 and 16384 pixels wide.');
      const id = randomUUID(), dir = projectDir(id); await fs.mkdir(dir);
      await sharp(req.file.path, { limitInputPixels: 135000000 }).removeAlpha().toColourspace('srgb').png().toFile(path.join(dir, 'original.png'));
      await previewImage(path.join(dir, 'original.png'), path.join(dir, 'original-preview.jpg'));
      const p = { id, name: path.basename(req.file.originalname).slice(0, 120), width: meta.width, height: meta.height, image: 'original.png', preview: 'original-preview.jpg', exports: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await saveProject(p); res.status(201).json(p);
    } finally { await fs.unlink(req.file.path).catch(() => {}); }
  });
  app.post('/api/projects/:id/clip', upload.single('clip'), async (req, res) => {
    if (!req.file) throw new Error('Choose a video clip.');
    try {
      const p = await getProject(req.params.id);
      if (isBusy(p.id)) throw new Error('Wait for the current operation to finish.');
      const info = await probe(req.file.path), stream = info.streams.find(s => s.codec_type === 'video');
      const duration = Number(info.format.duration);
      if (!stream || !Number.isFinite(duration) || duration < 0.4 || duration > 15.1 || stream.width > 4096 || stream.height > 4096) throw new Error('Use a video from 0.4 to 15 seconds, at most 4096 pixels per side.');
      const file = randomUUID() + '.mp4';
      await fs.rename(req.file.path, path.join(projectDir(p.id), file));
      p.clip = { file, duration, name: path.basename(req.file.originalname), width: stream.width, height: stream.height };
      p.clips=[...(p.clips||[]),p.clip];
      await saveProject(p); res.json(p);
    } finally { await fs.unlink(req.file.path).catch(() => {}); }
  });
  app.post('/api/projects/:id/overlays', upload.single('overlay'), async (req,res) => {
    if(!req.file) throw new Error('Choose a transparent PNG.');
    try {
      const p=await getProject(req.params.id);if(isBusy(p.id))throw new Error('Wait for the current operation to finish.');
      const dimensions=await inspectOverlay(req.file.path),id=randomUUID(),file=id+'-overlay.png';
      await sharp(req.file.path).toColourspace('srgb').png().toFile(path.join(projectDir(p.id),file));
      p.overlays=[...(p.overlays||[]),{id,file,...dimensions,name:path.basename(req.file.originalname).slice(0,100),provider:'Imported'}];
      await saveProject(p);res.status(201).json(p);
    } finally {await fs.unlink(req.file.path).catch(()=>{});}
  });
  app.post('/api/projects/:id/overlays/generate', async (req,res) => {
    const p=await getProject(req.params.id), {prompt}=z.object({prompt:z.string().trim().min(3).max(4000)}).parse(req.body);
    if(!(await readConfig()).OPENAI_API_KEY)throw new Error('Add an OpenAI key in API settings.');
    res.status(202).json(await createJob(p,{type:'overlay',prompt}));
  });
  app.post('/api/projects/:id/overlays/compose', async (req,res) => {
    const p=await getProject(req.params.id),overlays=validateOverlays(p,req.body.overlays);
    res.status(202).json(await createJob(p,{type:'composite-overlays',overlays}));
  });
  app.post('/api/projects/:id/patch', upload.single('patch'), async (req, res) => {
    if (!req.file) throw new Error('Choose a square image patch.');
    try {
      const p = await getProject(req.params.id);
      if (isBusy(p.id)) throw new Error('Wait for the current operation to finish.');
      const meta = await sharp(req.file.path).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.width !== meta.height || meta.width > 8192) throw new Error('Use a square PNG, JPG or WebP image up to 8192 pixels.');
      p.patch = randomUUID() + '.png';
      await sharp(req.file.path).png().toFile(path.join(projectDir(p.id), p.patch));
      await saveProject(p); res.json(p);
    } finally { await fs.unlink(req.file.path).catch(() => {}); }
  });
  app.post('/api/projects/:id/restore', async (req, res) => {
    const p = await getProject(req.params.id);
    if (isBusy(p.id)) throw new Error('Wait for the current operation to finish.');
    const file = req.body.file;
    const item = p.exports.find(e => e.kind === 'image' && e.file === file);
    if (file !== 'original.png' && !item) throw new Error('Image revision not found.');
    p.image = file; p.preview = item?.preview || 'original-preview.jpg';
    await saveProject(p); res.json(p);
  });
  app.post('/api/projects/:id/media', upload.single('media'), async (req,res) => {
    if(!req.file)throw new Error('Choose an audio file or a full 360 video.');
    try {
      const p=await getProject(req.params.id);if(isBusy(p.id))throw new Error('Wait for the current operation to finish.');
      const info=await probe(req.file.path),duration=Number(info.format.duration),v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
      if(!Number.isFinite(duration)||duration<.1||duration>600.1)throw new Error('Import media between 0.1 seconds and 10 minutes.');
      const id=randomUUID(),name=path.basename(req.file.originalname).slice(0,100);
      if(req.body.kind==='scene') {
        if(!v||v.width!==v.height*2||v.width>8192||duration<.4)throw new Error('Use a full 2:1 panorama video, up to 8K.');
        const file=id+'.mp4';
        await ffmpeg(['-i',req.file.path,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','fast','-crf','18','-threads','4','-pix_fmt','yuv420p','-vf','setsar=1','-c:a','aac','-ar','48000','-ac','2','-map_metadata','-1',path.join(projectDir(p.id),file)]);
        p.media=[...(p.media||[]),{id,file,name,kind:'scene',duration,width:v.width,height:v.height}];
      } else {
        if(!a)throw new Error('The imported file contains no audio.');
        const file=id+'.mp3';
        await ffmpeg(['-i',req.file.path,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k','-ar','48000','-ac','2',path.join(projectDir(p.id),file)]);
        p.audio=[...(p.audio||[]),{id,file,name,kind:'import',duration,provider:'Imported'}];
      }
      await saveProject(p);res.json(p);
    } finally {await fs.unlink(req.file.path).catch(()=>{});}
  });
  app.put('/api/projects/:id/movie',async(req,res)=>{
    const p=await getProject(req.params.id);
    if(isBusy(p.id))throw new Error('Wait for the current operation to finish.');
    p.movie=validateMovie(p,req.body);await saveProject(p);res.json(p);
  });
  app.post('/api/projects/:id/movie/render',async(req,res)=>{
    const p=await getProject(req.params.id);
    if(isBusy(p.id))throw new Error('Wait for the current operation to finish.');
    const movie=validateMovie(p,req.body,{render:true});p.movie=movie;await saveProject(p);
    res.status(202).json(await createJob(p,{type:'movie',movie}));
  });
  app.post('/api/projects/:id/audio',async(req,res)=>{
    const p=await getProject(req.params.id),audio=audioSchema.parse(req.body),config=await readConfig();
    if(!config.ELEVENLABS_API_KEY)throw new Error('Add your ElevenLabs key in API settings or .env.');
    res.status(202).json(await createJob(p,{type:'audio',audio}));
  });
  const optionsSchema = z.object({
    type: z.enum(['image', 'video', 'both', 'video-edit', 'stitch-video', 'stitch-image']),
    region: z.object({ x: z.number().finite(), y: z.number().finite(), size: z.number().finite() }),
    imagePrompt: z.string().max(4000).default(''), videoPrompt: z.string().max(4000).default(''),
    feather: z.number().min(0).max(30).default(8), duration: z.number().int().min(1).max(15).default(5),
    edgeMatch: z.boolean().default(true),
    resolution: z.enum(['480p', '720p']).default('480p'),
    loopMode: z.enum(['crossfade', 'pingpong', 'none']).default('crossfade'),
    outputWidth: z.union([z.literal(0), z.literal(2048), z.literal(4096), z.literal(8192)]).default(2048),
    fps: z.union([z.literal(24), z.literal(30)]).default(24)
  });
  app.post('/api/projects/:id/jobs', async (req, res) => {
    const p = await getProject(req.params.id), options = optionsSchema.parse(req.body);
    options.region = normalizeRegion(options.region, p.width, p.height);
    const config = await readConfig();
    if (['image', 'both'].includes(options.type) && (!options.imagePrompt.trim() || !config.OPENAI_API_KEY)) throw new Error('Add an image prompt and an OpenAI key first.');
    if (['video', 'both', 'video-edit'].includes(options.type) && (!options.videoPrompt.trim() || !config.XAI_API_KEY)) throw new Error('Add a motion prompt and an xAI / Grok key first.');
    if (options.type === 'video-edit' && (!p.clip || p.clip.duration > 8.7)) throw new Error('Import a clip no longer than 8.7 seconds for a Grok video remix.');
    res.status(202).json(await createJob(p, options));
  });
  app.get('/api/jobs/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found.' }); res.json(job); });
  app.post('/api/jobs/:id/cancel', async (req, res) => res.json(await cancelJob(req.params.id)));
  app.post('/api/jobs/:id/resume', async (req, res) => res.json(await resumeJob(req.params.id)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(root, 'dist'), { dotfiles: 'deny' }));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || (error instanceof z.ZodError ? 400 : 400)).json({ error: error instanceof z.ZodError ? 'Check your selection and export settings.' : safeError(error) });
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await readConfig(), port = Number(process.env.PORT || config.PORT || 4317);
  const app = await createApp({ dev: process.argv.includes('--dev') });
  app.listen(port, process.env.HOST || '127.0.0.1', () => console.log('Equirectangular Cinemagraph Creator: http://localhost:' + port));
}
