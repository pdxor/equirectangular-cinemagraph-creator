import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Aperture, ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Film, Globe2, Image as ImageIcon, KeyRound, Lasso, LoaderCircle, Maximize2, Move, Play, Plus, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Square, Upload, WandSparkles, X } from 'lucide-react';
import * as THREE from 'three';
import { squareFromPoints, clamp, wrap } from '../shared/geometry.js';
import './style.css';
import './movie.css';
import MovieStudio from './MovieStudio.jsx';
import OverlayPanel from './OverlayPanel.jsx';

const asset = (p, file) => '/api/projects/' + p.id + '/assets/' + file;
const isActive = j => ['queued', 'running'].includes(j?.status);
async function api(url, options = {}) {
  const response = await fetch('/api' + url, { ...options, headers: { 'X-Cinemagraph-Client': '1', ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}
function IconButton({ children, title, ...props }) { return <button className="icon-button" title={title} aria-label={title} {...props}>{children}</button>; }
function Field({ label, children, hint }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }

function SettingsDialog({ close, config, saved }) {
  const ref = useRef(null);
  const [values, setValues] = useState({ OPENAI_API_KEY: '', XAI_API_KEY: '', ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: config.voiceId || 'JBFqnCBsd6RMkjVDRZzb', ELEVENLABS_TTS_MODEL: config.ttsModel || 'eleven_multilingual_v2', ELEVENLABS_MUSIC_MODEL: config.musicModel || 'music_v1', OPENAI_IMAGE_MODEL: config.imageModel || 'gpt-image-2', XAI_VIDEO_MODEL: config.videoModel || 'grok-imagine-video-1.5', XAI_EDIT_MODEL: config.editModel || 'grok-imagine-video' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { ref.current.showModal(); }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const body = Object.fromEntries(Object.entries(values).filter(([key, value]) => !key.endsWith('API_KEY') || value.trim()));
      const result = await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      saved(result); close();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <dialog ref={ref} className="settings-dialog" onCancel={close}>
    <div className="dialog-heading"><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>Connect your tools</h2></div><IconButton title="Close settings" onClick={close}><X size={20}/></IconButton></div>
    <p className="muted">Keys are saved in this app’s local .env file. They are used by the server and never returned to the browser.</p>
    <form onSubmit={submit} autoComplete="off">
      <div className="provider-title"><Sparkles size={18}/><strong>OpenAI</strong><span className={config.openaiConfigured ? 'pill good' : 'pill'}>{config.openaiConfigured ? 'Key saved' : 'Needs a key'}</span></div>
      <Field label="API key"><input type="password" aria-label="OpenAI API key" autoComplete="new-password" placeholder={config.openaiConfigured ? 'Leave blank to keep your saved key' : 'Enter your OpenAI key'} value={values.OPENAI_API_KEY} onChange={e => setValues({ ...values, OPENAI_API_KEY: e.target.value })}/></Field>
      <Field label="Image model"><input value={values.OPENAI_IMAGE_MODEL} onChange={e => setValues({ ...values, OPENAI_IMAGE_MODEL: e.target.value })}/></Field>
      <div className="provider-title"><Film size={18}/><strong>Grok / xAI</strong><span className={config.xaiConfigured ? 'pill good' : 'pill'}>{config.xaiConfigured ? 'Key saved' : 'Needs a key'}</span></div>
      <Field label="API key"><input type="password" aria-label="xAI API key" autoComplete="new-password" placeholder={config.xaiConfigured ? 'Leave blank to keep your saved key' : 'Enter your xAI key'} value={values.XAI_API_KEY} onChange={e => setValues({ ...values, XAI_API_KEY: e.target.value })}/></Field>
      <div className="two-fields"><Field label="Video generation model"><input value={values.XAI_VIDEO_MODEL} onChange={e => setValues({ ...values, XAI_VIDEO_MODEL: e.target.value })}/></Field><Field label="Video edit model"><input value={values.XAI_EDIT_MODEL} onChange={e => setValues({ ...values, XAI_EDIT_MODEL: e.target.value })}/></Field></div>
      <div className="provider-title"><Film size={18}/><strong>ElevenLabs</strong><span className={config.elevenlabsConfigured ? 'pill good' : 'pill'}>{config.elevenlabsConfigured ? 'Key saved' : 'Needs a key'}</span></div>
      <Field label="API key"><input type="password" aria-label="ElevenLabs API key" autoComplete="new-password" placeholder={config.elevenlabsConfigured?'Leave blank to keep your saved key':'Enter your ElevenLabs key'} value={values.ELEVENLABS_API_KEY} onChange={e=>setValues({...values,ELEVENLABS_API_KEY:e.target.value})}/></Field>
      <Field label="Default voice ID"><input value={values.ELEVENLABS_VOICE_ID} onChange={e=>setValues({...values,ELEVENLABS_VOICE_ID:e.target.value})}/></Field>
      <div className="two-fields"><Field label="Speech model"><input value={values.ELEVENLABS_TTS_MODEL} onChange={e=>setValues({...values,ELEVENLABS_TTS_MODEL:e.target.value})}/></Field><Field label="Music model"><input value={values.ELEVENLABS_MUSIC_MODEL} onChange={e=>setValues({...values,ELEVENLABS_MUSIC_MODEL:e.target.value})}/></Field></div>
      <p className="small muted">Image and video tools send the selected square or clip. ElevenLabs receives your script or sound description. Generation uses your API accounts and incurs their normal charges.</p>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <KeyRound size={16}/>}Save locally</button>
    </form>
  </dialog>;
}

function PanoramaEditor({ project, region, onRegion, tool, shift, disabled, overlays=[], onOverlays, selectedOverlay, onOverlaySelect }) {
  const canvasRef = useRef(null), imageRef = useRef(null), gesture = useRef(null), svgRef = useRef(null);
  const [points, setPoints] = useState([]);
  const width = project.width, height = project.height, offset = width * shift / 360;
  useEffect(() => {
    const img = new window.Image(); img.src = asset(project, project.preview);
    img.onload = () => { imageRef.current = img; draw(); };
    function draw() {
      const canvas = canvasRef.current; if (!canvas) return;
      canvas.width = Math.min(2048, width); canvas.height = canvas.width / 2;
      const ctx = canvas.getContext('2d'); const x = offset / width * canvas.width;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, -x, 0, canvas.width, canvas.height); ctx.drawImage(img, canvas.width - x, 0, canvas.width, canvas.height);
    }
    return () => { img.onload = null; };
  }, [project.preview, project.id, width, offset]);
  function point(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width * width, 0, width), y: clamp((e.clientY - rect.top) / rect.height * height, 0, height) };
  }
  function begin(e) {
    if (disabled || e.button !== 0) return;
    svgRef.current.focus(); svgRef.current.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === 'overlays') {
      const id=e.target.getAttribute('data-overlay-id'),layer=overlays.find(o=>o.id===id);
      if(!layer)return;
      onOverlaySelect(id);gesture.current={start:p,layer,resize:e.target.getAttribute('data-resize')==='true'};return;
    }
    gesture.current = { start: p, points: [p], region };
    setPoints([p]);
  }
  function drag(e) {
    if (!gesture.current) return;
    const p = point(e), g = gesture.current;
    if(g.layer){
      let next={...g.layer};
      if(g.resize){const source=project.overlays.find(o=>o.file===next.source),ratio=source.height/source.width;next.width=Math.round(clamp(g.layer.width+p.x-g.start.x,1,Math.floor(Math.min(width,(height-next.y)/ratio))));next.height=Math.max(1,Math.round(next.width*ratio));}
      else {next.x=Math.round(wrap(g.layer.x+p.x-g.start.x,width));next.y=Math.round(clamp(g.layer.y+p.y-g.start.y,0,height-next.height));}
      onOverlays(overlays.map(o=>o.id===next.id?next:o));return;
    }
    if (tool === 'move' && g.region) {
      onRegion({ ...g.region, x: Math.round(wrap(g.region.x + p.x - g.start.x, width)), y: Math.round(clamp(g.region.y + p.y - g.start.y, 0, height - g.region.size)) });
    } else {
      g.points = tool === 'square' ? [g.start, p] : [...g.points, p].slice(-5000);
      setPoints(g.points);
    }
  }
  function end(e) {
    const g = gesture.current; if (!g) return;
    if(g.layer){gesture.current=null;if(svgRef.current.hasPointerCapture(e.pointerId))svgRef.current.releasePointerCapture(e.pointerId);return;}
    if (tool !== 'move' || !g.region) {
      const pts = g.points.length > 1 ? g.points : [g.start, { x: g.start.x + height / 5, y: g.start.y + height / 5 }];
      onRegion(squareFromPoints(pts.map(p => ({ x: wrap(p.x + offset, width), y: p.y })), width, height));
    }
    gesture.current = null; setPoints([]);
    if (svgRef.current.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  }
  function key(e) {
    if(tool==='overlays'&&!disabled){const active=overlays.find(o=>o.id===selectedOverlay),step=e.shiftKey?10:1,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(active&&delta){e.preventDefault();onOverlays(overlays.map(o=>o.id===active.id?{...o,x:wrap(o.x+delta[0],width),y:clamp(o.y+delta[1],0,height-o.height)}:o));}return;}
    if (!region || disabled) return;
    const distance = e.shiftKey ? 10 : 1, delta = { ArrowLeft: [-distance, 0], ArrowRight: [distance, 0], ArrowUp: [0, -distance], ArrowDown: [0, distance] }[e.key];
    if (delta) { e.preventDefault(); onRegion({ ...region, x: wrap(region.x + delta[0], width), y: clamp(region.y + delta[1], 0, height - region.size) }); }
    if (e.key === 'Escape') { gesture.current = null; setPoints([]); }
  }
  const preview = points.length > 1 && tool === 'square' ? squareFromPoints(points, width, height) : null;
  return <div className={'panorama-editor tool-' + tool}>
    <canvas ref={canvasRef} aria-label="Panorama image"/>
    <svg ref={svgRef} className="selection-layer" viewBox={'0 0 ' + width + ' ' + height} tabIndex={0} role="application" aria-label="Panorama selection canvas. Draw a lasso or square. Use arrow keys to move the selection; Shift moves ten pixels." onPointerDown={begin} onPointerMove={drag} onPointerUp={end} onPointerCancel={() => { gesture.current = null; setPoints([]); }} onKeyDown={key}>
      <defs><pattern id="pano-grid" width={width / 12} height={height / 6} patternUnits="userSpaceOnUse"><path d={'M ' + width / 12 + ' 0 L 0 0 0 ' + height / 6} fill="none" stroke="white" strokeOpacity=".12" vectorEffect="non-scaling-stroke"/></pattern></defs>
      <rect width={width} height={height} fill="url(#pano-grid)" pointerEvents="none"/>
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="white" strokeOpacity=".25" strokeDasharray="5 8" vectorEffect="non-scaling-stroke"/>
      {region && [-width, 0, width].map(n => <g key={n} pointerEvents="none"><rect x={region.x - offset + n} y={region.y} width={region.size} height={region.size} fill="#c8f56c" fillOpacity=".07" stroke="#d1ff7b" strokeWidth="2" vectorEffect="non-scaling-stroke"/>{[[0,0],[1,0],[0,1],[1,1]].map(([x,y]) => <rect key={x+','+y} x={region.x-offset+n+region.size*x-width/300} y={region.y+region.size*y-width/300} width={width/150} height={width/150} fill="#d1ff7b"/>)}</g>)}
      {preview && <rect x={preview.x} y={preview.y} width={preview.size} height={preview.size} fill="#c8f56c22" stroke="#d1ff7b" vectorEffect="non-scaling-stroke"/>}
      {tool === 'lasso' && points.length > 1 && <polyline points={points.map(p => p.x + ',' + p.y).join(' ')} fill="#c8f56c22" stroke="#d1ff7b" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
      {overlays.map(o=>[-width,0,width].map(dx=><g key={o.id+':'+dx} style={{pointerEvents:tool==='overlays'?'auto':'none'}}><image data-overlay-id={o.id} href={asset(project,o.source)} x={o.x-offset+dx} y={o.y} width={o.width} height={o.height} opacity={o.opacity} style={{cursor:'move'}}/>{tool==='overlays'&&<rect data-overlay-id={o.id} x={o.x-offset+dx} y={o.y} width={o.width} height={o.height} fill="transparent" stroke={selectedOverlay===o.id?'#e3bcff':'#bac7b5'} strokeDasharray={selectedOverlay===o.id?'':'4 4'} vectorEffect="non-scaling-stroke" style={{cursor:'move'}}/>}{tool==='overlays'&&selectedOverlay===o.id&&<rect className="png-handle" data-overlay-id={o.id} data-resize="true" x={o.x-offset+dx+o.width-width/130} y={o.y+o.height-width/130} width={width/65} height={width/65} fill="#e3bcff"/>}</g>))}
    </svg>
    <span className="canvas-label">EQUIRECTANGULAR · 2:1</span>
    <span className="canvas-hint">{disabled ? 'Processing selection' : tool === 'overlays' ? 'Drag PNGs to place · Corner to resize · Arrow keys to nudge' : tool === 'lasso' ? 'Draw around an area. Release to make it square.' : tool === 'move' ? 'Drag to move · Arrow keys for precision' : 'Drag a square around the area to change.'}</span>
  </div>;
}

function CropPreview({ project, region }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!project || !region) return;
    const image = new window.Image(); image.src = asset(project, project.preview);
    image.onload = () => {
      const ctx = ref.current?.getContext('2d'); if (!ctx) return;
      const ratio = image.width / project.width;
      ctx.clearRect(0,0,240,240);
      for (const dx of [0, project.width]) ctx.drawImage(image, (dx - region.x) / region.size * 240, -region.y / region.size * 240, project.width / region.size * 240, project.height / region.size * 240);
    };
    return () => { image.onload = null; };
  }, [project?.id, project?.preview, region?.x, region?.y, region?.size]);
  return <div className="crop-preview">{region ? <canvas width="240" height="240" ref={ref}/> : <Maximize2 size={24}/>}<span>1:1</span></div>;
}

function SphereViewer({ url, video = false }) {
  const hostRef = useRef(null), mediaRef=useRef(null), [error, setError] = useState(''), [muted,setMuted]=useState(true), [playing,setPlaying]=useState(true);
  useEffect(() => {
    const host = hostRef.current; let renderer, media, texture, disposed = false, raf, observer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); host.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 2, 0.1, 1100);
      const geometry = new THREE.SphereGeometry(500, 64, 40); geometry.scale(-1, 1, 1);
      if (video) {
        media = document.createElement('video'); mediaRef.current=media; media.src = url; media.muted = true; media.loop = true; media.playsInline = true; setMuted(true); setPlaying(true);
        media.play().catch(() => {}); texture = new THREE.VideoTexture(media);
      } else texture = new THREE.TextureLoader().load(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture }); scene.add(new THREE.Mesh(geometry, material));
      let lon = 180, lat = 15, pointer;
      const down = e => { if (e.target.closest('button')) return; pointer = { x: e.clientX, y: e.clientY }; host.setPointerCapture(e.pointerId); };
      const move = e => { if (!pointer) return; lon -= (e.clientX - pointer.x) * .18; lat = clamp(lat + (e.clientY - pointer.y) * .18, -85, 85); pointer = { x: e.clientX, y: e.clientY }; };
      const up = () => { pointer = null; };
      const wheel = e => { e.preventDefault(); camera.fov = clamp(camera.fov + e.deltaY * .04, 35, 100); camera.updateProjectionMatrix(); };
      host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up); host.addEventListener('wheel', wheel, { passive: false });
      observer = new ResizeObserver(() => { renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); }); observer.observe(host);
      function render() { if (disposed) return; const phi = THREE.MathUtils.degToRad(90 - lat), theta = THREE.MathUtils.degToRad(lon); camera.lookAt(500*Math.sin(phi)*Math.cos(theta), 500*Math.cos(phi), 500*Math.sin(phi)*Math.sin(theta)); renderer.render(scene, camera); raf = requestAnimationFrame(render); } render();
      return () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); media?.pause(); if (media) { media.removeAttribute('src'); media.load(); } texture.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up); host.removeEventListener('wheel', wheel); };
    } catch { setError('360° preview needs a browser with WebGL. The flat panorama and downloads still work.'); }
  }, [url, video]);
  return <div className="sphere-viewer" ref={hostRef}>{error && <p>{error}</p>}<span className="canvas-label">360° PREVIEW</span>{video&&<div className="sphere-controls" onPointerDown={e=>e.stopPropagation()}><button onClick={()=>{if(playing)mediaRef.current?.pause();else mediaRef.current?.play();setPlaying(!playing);}}>{playing?'Pause':'Play'}</button><button onClick={()=>{if(mediaRef.current)mediaRef.current.muted=!muted;setMuted(!muted);}}>{muted?'Enable sound':'Mute'}</button></div>}<span className="canvas-hint">Drag to look around · Scroll to zoom</span></div>;
}

function App() {
  const [projects, setProjects] = useState([]), [project, setProject] = useState(null), [config, setConfig] = useState({});
  const [settings, setSettings] = useState(false), [region, setRegion] = useState(null), [tool, setTool] = useState('lasso'), [shift, setShift] = useState(0);
  const [tab, setTab] = useState('image'), [view, setView] = useState('edit'), [output, setOutput] = useState(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [imagePrompt, setImagePrompt] = useState(''), [videoPrompt, setVideoPrompt] = useState('');
  const [feather, setFeather] = useState(8), [duration, setDuration] = useState(5), [loopMode, setLoopMode] = useState('crossfade'), [resolution, setResolution] = useState('480p'), [outputWidth, setOutputWidth] = useState(2048), [fps, setFps] = useState(24);
  const [edgeMatch,setEdgeMatch]=useState(true);
  const [overlayDraft,setOverlayDraft]=useState([]),[selectedOverlay,setSelectedOverlay]=useState(null);
  const uploadRef = useRef(null), clipRef = useRef(null), patchRef = useRef(null), lastJob = useRef(null);
  const activeJob = project?.jobs?.find(isActive), latestJob = project?.jobs?.[0], locked = busy || !!activeJob;
  useEffect(()=>{if(!overlayDraft.length)return;const warn=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[overlayDraft.length]);
  useEffect(() => {
    api('/health').then(setConfig).catch(e => setError(e.message));
    api('/projects').then(async ps => {
      setProjects(ps);
      const saved = localStorage.getItem('cinemagraph-project');
      if (ps.length) await selectProject(ps.find(p => p.id === saved)?.id || ps[0].id);
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    const timer = setInterval(() => api('/settings').then(c => setConfig(old => ({ ...old, ...c }))).catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!project?.id || !activeJob) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await api('/projects/' + project.id);
        if (stopped) return;
        setProject(next);
        const completed = next.jobs.find(j => j.id === activeJob.id);
        if (completed?.status === 'done') {
          const result = next.exports.findLast(e => e.id.startsWith(completed.id));
          if (result) { setOutput(result); setView('result'); }
          if(completed.options.type==='overlay'){const item=next.overlays.find(o=>o.id===completed.id);if(item)placeOverlay(item);}
          if(completed.options.type==='composite-overlays'){setOverlayDraft([]);setSelectedOverlay(null);setTool('lasso');setView('edit');}
          setNotice(completed.options.type==='overlay'?'Transparent PNG ready. Drag it over the panorama, then merge.':completed.options.type==='composite-overlays'?'PNGs merged. Select an area to animate, or use this revision in a region scene.':completed.options.type==='audio'?'Audio is ready in the sound library.':'Your ' + (result?.kind === 'video' ? '360° video' : 'remixed panorama') + ' is ready.');
          api('/projects').then(setProjects);
        }
      } catch (e) { if (!stopped) setError(e.message); }
    }, 1800);
    return () => { stopped = true; clearInterval(timer); };
  }, [project?.id, activeJob?.id]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  async function selectProject(id) {
    setError(''); setBusy(true);
    try {
      const next = await api('/projects/' + id); setProject(next);setOverlayDraft([]);setSelectedOverlay(null);
      const previous = next.jobs?.find(j=>j.options.region)?.options;
      setRegion(previous?.region || null); setOutput(null); setView('edit'); setShift(0);
      if (previous) { setFeather(previous.feather); setEdgeMatch(previous.edgeMatch ?? true); setDuration(previous.duration); setLoopMode(previous.loopMode); setResolution(previous.resolution); setOutputWidth(previous.outputWidth); setFps(previous.fps); }
      setImagePrompt(next.jobs?.find(j => j.options.imagePrompt)?.options.imagePrompt || '');
      setVideoPrompt(next.jobs?.find(j => j.options.videoPrompt)?.options.videoPrompt || '');
      localStorage.setItem('cinemagraph-project', id);
    }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function uploadPanorama(file) {
    if (!file || locked) return; setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('panorama', file);
      const p = await api('/projects', { method: 'POST', body: form });
      setProject({ ...p, jobs: [] }); setProjects(await api('/projects')); setRegion(null); setOverlayDraft([]);setSelectedOverlay(null);setOutput(null); setView('edit'); setShift(0); localStorage.setItem('cinemagraph-project', p.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); if (uploadRef.current) uploadRef.current.value = ''; }
  }
  async function uploadPart(file, kind) {
    if (!file || !project) return; setBusy(true); setError('');
    try {
      const data = new FormData(); data.append(kind, file);
      const p = await api('/projects/' + project.id + '/' + kind, { method: 'POST', body: data });
      setProject(old => ({ ...p, jobs: old.jobs })); setNotice(kind === 'clip' ? 'Clip imported. Stitch it directly or remix it with Grok.' : 'Patch imported. Ready to stitch into the selected square.');
    } catch (e) { setError(e.message); } finally { setBusy(false); if (clipRef.current) clipRef.current.value = ''; if (patchRef.current) patchRef.current.value = ''; }
  }
  async function start(type) {
    if (!project || !region || locked) return;
    if(overlayDraft.length){setError('Merge or remove the placed PNG layers before generating or stitching a region.');return;}
    setBusy(true); setError('');
    try {
      const options = { type, region, feather, edgeMatch, duration, loopMode, resolution, outputWidth, fps, imagePrompt, videoPrompt };
      const job = await api('/projects/' + project.id + '/jobs', { method: 'POST', body: JSON.stringify(options) });
      setProject(old => ({ ...old, jobs: [job, ...(old.jobs || [])] })); setView('edit');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function jobAction(action) {
    setError('');
    try { await api('/jobs/' + latestJob.id + '/' + action, { method: 'POST' }); setProject(await api('/projects/' + project.id)); } catch (e) { setError(e.message); }
  }
  async function restore(file) {
    setError('');
    try { const next = await api('/projects/' + project.id + '/restore', { method: 'POST', body: JSON.stringify({ file }) }); setProject(old => ({ ...next, jobs: old.jobs }));setOverlayDraft([]);setSelectedOverlay(null); setView('edit'); setOutput(null); }
    catch (e) { setError(e.message); }
  }
  function changeRegion(key, value) {
    if (!region || !project) return;
    const n = Number(value); if (!Number.isFinite(n)) return;
    const next = { ...region, [key]: Math.round(n) };
    next.size = clamp(next.size, 16, project.height); next.y = clamp(next.y, 0, project.height - next.size); next.x = wrap(next.x, project.width); setRegion(next);
  }
  function placeOverlay(item) {
    const width=Math.max(1,Math.round(Math.min(region?.size||project.height*.3,project.height*item.width/item.height))),height=Math.max(1,Math.round(width*item.height/item.width));
    const placed={id:crypto.randomUUID(),source:item.file,name:item.name,width,height,x:region?.x??Math.round((project.width-width)/2),y:clamp(region?.y??Math.round((project.height-height)/2),0,project.height-height),opacity:1};
    setOverlayDraft(old=>old.length<32?[...old,placed]:old);setSelectedOverlay(placed.id);setTool('overlays');setView('edit');
    document.querySelector('.editor-shell')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  async function composeOverlays() {
    setBusy(true);setError('');
    try {const job=await api('/projects/'+project.id+'/overlays/compose',{method:'POST',body:JSON.stringify({overlays:overlayDraft})});setProject(old=>({...old,jobs:[job,...(old.jobs||[])]}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const canImage = !!region && !!config.openaiConfigured && !!imagePrompt.trim() && !locked && !overlayDraft.length;
  const canVideo = !!region && !!config.xaiConfigured && !!videoPrompt.trim() && !locked && !overlayDraft.length;
  const selectedOutput = output || project?.exports?.at(-1);
  const sphereUrl = project && (selectedOutput && view === 'sphere-output' ? asset(project, selectedOutput.file) : asset(project, project.preview));
  return <div className="app">
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><Aperture size={27}/></div><div><h1>Equirectangular <span>Cinemagraph Creator</span></h1><p>A little motion. A whole world.</p></div><span className="local-badge">LOCAL STUDIO</span></div>
      <div className="header-actions"><button className="subtle" aria-label="API settings" onClick={() => setSettings(true)}><Settings2 size={17}/><span>API settings</span><i className={'status-dot ' + (config.openaiConfigured && config.xaiConfigured ? 'ready' : '')}/></button><button className="primary" disabled={locked} onClick={() => uploadRef.current.click()}><Plus size={18}/>Open panorama</button></div>
    </header>
    <input className="file-input" ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,image/tiff" onChange={e => uploadPanorama(e.target.files[0])}/>
    <input className="file-input" ref={clipRef} type="file" accept="video/*" onChange={e => uploadPart(e.target.files[0], 'clip')}/>
    <input className="file-input" ref={patchRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadPart(e.target.files[0], 'patch')}/>
    <main className="workspace">
      <section className="editor-column">
        <div className="project-heading"><div><span className="eyebrow">YOUR WORKSPACE</span>{projects.length ? <select className="project-select" aria-label="Current panorama" value={project?.id || ''} disabled={locked} onChange={e => selectProject(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <h2>Untitled panorama</h2>}</div><div className="metadata">{project ? <><span>{project.width.toLocaleString()} × {project.height.toLocaleString()}</span><span className="pill">360°</span></> : <span>2:1 equirectangular image</span>}</div></div>
        <div className="editor-shell" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!locked) uploadPanorama(e.dataTransfer.files[0]); }}>
          <div className="editor-toolbar">
            <div className="segmented" aria-label="Editor tools">{[['lasso', Lasso, 'Lasso'], ['square', Square, 'Square'], ['move', Move, 'Move'],['overlays',ImageIcon,'PNGs']].map(([name, Icon, label]) => <button key={name} className={tool === name ? 'selected' : ''} aria-pressed={tool === name} title={label} disabled={locked || !project || view !== 'edit'||(name==='overlays'&&!overlayDraft.length)} onClick={() => setTool(name)}><Icon size={17}/><span>{label}</span></button>)}</div>
            <div className="view-buttons"><button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}><ImageIcon size={15}/>Edit</button><button disabled={!project} className={view === 'sphere' ? 'active' : ''} onClick={() => setView('sphere')}><Globe2 size={16}/>360°</button>{selectedOutput && <button className={['result','sphere-output'].includes(view) ? 'active' : ''} onClick={() => setView('result')}><Play size={15}/>Result</button>}</div>
          </div>
          {!project ? <div className="empty-canvas">
            <div className="empty-globe"><Globe2 size={70} strokeWidth={.8}/><span><Lasso size={22}/></span></div>
            <h2>Give your panorama a moment of motion.</h2><p>Drop in an equirectangular image, then draw around the area you want to remix.</p>
            <button className="primary" disabled={busy} onClick={() => uploadRef.current.click()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Upload size={17}/>}Choose a panorama</button>
            <small>JPG, PNG, WebP or TIFF · 2:1 ratio · up to 16K</small>
          </div> : view === 'edit' ? <PanoramaEditor project={project} region={region} onRegion={setRegion} tool={tool} shift={shift} disabled={locked} overlays={overlayDraft} onOverlays={setOverlayDraft} selectedOverlay={selectedOverlay} onOverlaySelect={setSelectedOverlay}/> : ['sphere', 'sphere-output'].includes(view) ? <SphereViewer url={sphereUrl} video={view === 'sphere-output' && selectedOutput?.kind === 'video'}/> : selectedOutput ? <div className="result-view">{selectedOutput.kind === 'video' ? <video key={selectedOutput.file} src={asset(project, selectedOutput.file)} controls autoPlay muted loop playsInline/> : <img src={asset(project, selectedOutput.preview || selectedOutput.file)} alt="Remixed equirectangular panorama"/>}<span className="canvas-label">{selectedOutput.kind === 'video' ? (selectedOutput.role==='movie'?'FINAL 360° FILM':'360° MP4') : 'REMIXED PANORAMA'}</span></div> : null}
          <div className="canvas-footer"><div className="canvas-status"><i className={'status-dot ' + (project ? 'ready' : '')}/><span>{activeJob ? activeJob.message : region ? 'Square selected · ' + region.size + ' × ' + region.size + ' px' : project ? 'Draw a lasso to select your region' : 'Waiting for your panorama'}</span></div>{project && view === 'edit' ? <label className="seam-control" title="Rotate the flat panorama so the seam is easy to select">Seam <input type="range" min="0" max="359" value={shift} onChange={e => setShift(+e.target.value)} disabled={locked}/><span>{shift}°</span></label> : <span className="small muted">MONOSCOPIC · 2:1</span>}</div>
        </div>
        {error && <div className="error banner" role="alert"><span>{error}</span><IconButton title="Dismiss error" onClick={() => setError('')}><X size={16}/></IconButton></div>}
        {notice && <div className="notice" role="status"><CheckCircle2 size={18}/>{notice}</div>}
        {latestJob && <div className={'job-card ' + latestJob.status} aria-live="polite"><div className="job-icon">{isActive(latestJob) ? <LoaderCircle className="spin" size={21}/> : latestJob.status === 'done' ? <Check size={21}/> : <Circle size={21}/>}</div><div className="job-description"><strong>{latestJob.status === 'done' ? 'Export complete' : isActive(latestJob) ? 'Creating your cinemagraph' : 'Operation stopped'}</strong><span>{latestJob.message}</span>{isActive(latestJob) && <progress value={latestJob.progress} max="100" aria-label="Export progress"/>}</div>{isActive(latestJob) ? <button className="subtle small" onClick={() => jobAction('cancel')}>Stop</button> : ['failed','cancelled'].includes(latestJob.status) ? <button className="subtle" disabled={locked} onClick={() => jobAction('resume')}>Resume</button> : (latestJob.output || selectedOutput) && <a className="primary small" href={asset(project, latestJob.output || selectedOutput.file) + '?download=1'}><ArrowDownToLine size={16}/>{latestJob.options.type==='audio'?'Download audio':'Download'}</a>}</div>}
        {project&&<OverlayPanel key={'overlays-'+project.id} project={project} draft={overlayDraft} onDraft={setOverlayDraft} selected={selectedOverlay} onSelected={id=>{setSelectedOverlay(id);setTool('overlays');setView('edit');}} onPlace={placeOverlay} onCompose={composeOverlays} locked={locked} config={config} api={api} asset={asset} onProject={p=>setProject(old=>({...p,jobs:old.jobs}))} onJob={job=>setProject(old=>({...old,jobs:[job,...(old.jobs||[])]}))} onBusy={setBusy} onError={setError} onSettings={()=>setSettings(true)}/>}
        <div className="workflow-strip">{[[Lasso,'01','Select a square','Draw around the detail.'],[WandSparkles,'02','Remix the image','Add an object or worldspace UI.'],[Film,'03','Give it motion','Animate the square with Grok.'],[Globe2,'04','Bring it together','Export the full 360° scene.']].map(([Icon,number,title,copy]) => <div key={number}><span className="step-number">{number}</span><Icon size={19}/><strong>{title}</strong><p>{copy}</p></div>)}</div>
        {project&&<MovieStudio key={'movie-'+project.id} project={project} region={region} config={config} locked={locked||!!overlayDraft.length} api={api} asset={asset} onBusy={setBusy} onSettings={()=>setSettings(true)} onProject={p=>setProject(old=>({...p,jobs:old.jobs}))} onJob={job=>setProject(old=>({...old,jobs:[job,...(old.jobs||[])]}))} onPreview={item=>{if(item){setOutput({...item,kind:'video'});setView('result');document.querySelector('.editor-shell')?.scrollIntoView({behavior:'smooth',block:'center'});}}}/>}
        <section className="exports-section"><div className="section-heading"><h3>Exports <span>{project?.exports?.length || 0}</span></h3>{project && <button className="subtle small" disabled={locked} onClick={() => restore('original.png')}><RotateCcw size={14}/>Restore original</button>}</div>{project?.exports?.length ? <div className="exports-grid">{[...project.exports].reverse().map(item => <article className={'export-item ' + (output?.id === item.id ? 'chosen' : '')} key={item.id}><button className="export-thumb" onClick={() => { setOutput(item); setView('result'); }}>{item.kind === 'image' ? <img src={asset(project, item.preview)} alt="Remixed panorama"/> : <><Film size={25}/><span>{item.duration.toFixed(1)}s</span></>}<span className="export-type">{item.role==='movie'?'FINAL 360° FILM':item.kind === 'video' ? '360° MP4' : 'PANORAMA PNG'}</span></button><div className="export-details"><span>{item.name&&<strong className="export-name">{item.name}</strong>}{item.width} × {item.height}</span><a href={asset(project,item.file)+'?download=1'} aria-label={'Download '+item.kind}><ArrowDownToLine size={17}/></a></div><div className="export-actions"><button onClick={() => { setOutput(item); setView('sphere-output'); }}>View in 360°</button>{item.kind === 'image' && <button disabled={locked} onClick={() => restore(item.file)}>Use image</button>}</div></article>)}</div> : <div className="exports-empty"><ArrowDownToLine size={18}/><span>Your remixed panoramas and looping videos will appear here.</span></div>}</section>
        <footer className="app-footer"><span>Made for the moments inside the panorama.</span><span>OpenAI · Grok · ElevenLabs · FFmpeg</span></footer>
      </section>
      <aside className="inspector">
        <section className="selection-section"><div className="section-heading"><h3><SlidersHorizontal size={16}/>Selected region</h3><span className="pill">SQUARE</span></div><div className="selection-summary"><CropPreview project={project} region={region}/><div>{region ? <><strong>{region.size} × {region.size}</strong><span>pixels in the source</span><a className="text-link" href={'/api/projects/'+project.id+'/crop?x='+region.x+'&y='+region.y+'&size='+region.size} download="selected-square.png">Download crop <ArrowDownToLine size={13}/></a></> : <><strong>A small change,<br/>all around you.</strong><span>Your selected square will appear here.</span></>}</div></div>
          <div className="coordinates">{[['x','X position'],['y','Y position'],['size','Size']].map(([key,label]) => <Field key={key} label={label}><input type="number" aria-label={label} disabled={!region || locked} value={region?.[key] ?? ''} placeholder="—" min="0" onChange={e => changeRegion(key,e.target.value)}/></Field>)}</div>
          <Field label={<><span>Edge feather</span><span className="value">{feather}%</span></>} hint="Softens the join between the patch and panorama."><input type="range" min="0" max="30" value={feather} onChange={e => setFeather(+e.target.value)} disabled={locked}/></Field>
        </section>
        <div className="inspector-tabs" role="tablist" aria-label="Creation mode"><button role="tab" aria-selected={tab==='image'} className={tab==='image'?'selected':''} onClick={() => setTab('image')}><Sparkles size={16}/>Image remix</button><button role="tab" aria-selected={tab==='video'} className={tab==='video'?'selected':''} onClick={() => setTab('video')}><Film size={16}/>Video loop</button></div>
        <section className="creation-panel">
          {!!overlayDraft.length&&<div className="pending-overlays">Merge or remove your placed PNG layers before generating a region or rendering the film.</div>}
          {tab === 'image' ? <>
            <div className="panel-intro"><h3>Reimagine the detail.</h3><p>Describe what belongs in this part of the world.</p></div>
            <Field label="Image prompt"><textarea rows={5} placeholder="Add a floating worldspace interface anchored to the scene, with glowing labels and subtle depth…" value={imagePrompt} disabled={locked} onChange={e=>setImagePrompt(e.target.value)}/></Field>
            <button className="prompt-preset" disabled={locked} onClick={()=>setImagePrompt('Add an elegant worldspace user interface anchored in the scene: a translucent glass information panel with the title WORLDSPACE, thin luminous cyan outlines, two readable location labels and subtle depth. Match the scene perspective and lighting. Keep all existing architecture and the outer border unchanged.')}><Plus size={13}/>Worldspace UI</button>
            {!config.openaiConfigured && <button className="connection-note" onClick={()=>setSettings(true)}><KeyRound size={15}/>Connect OpenAI to remix images<ArrowRight size={14}/></button>}
            <button className="primary full" disabled={!canImage} onClick={()=>start('image')}><WandSparkles size={17}/>Remix & export panorama<ArrowRight size={16}/></button>
            <p className="small muted">Exports a full-resolution PNG. Image edits build on your current panorama.</p>
            <div className="divider"/><h4>Have a square patch already?</h4><p className="small muted">Import an edited square and stitch it in directly.</p>
            <button className="secondary full" disabled={!project||locked} onClick={()=>patchRef.current.click()}><Upload size={16}/>{project?.patch?'Replace image patch':'Import image patch'}</button>
            {project?.patch && <button className="secondary full" disabled={!region||locked} onClick={()=>start('stitch-image')}><ImageIcon size={16}/>Stitch imported patch</button>}
          </> : <>
            <div className="panel-intro"><h3>Bring one moment to life.</h3><p>The rest of the panorama stays still.</p></div>
            <Field label="Motion prompt"><textarea rows={4} placeholder="The interface gently pulses with light. Small particles drift upward. Keep the camera and surroundings still." disabled={locked} value={videoPrompt} onChange={e=>setVideoPrompt(e.target.value)}/></Field>
            <div className="two-fields"><Field label="Clip duration"><select disabled={locked} value={duration} onChange={e=>setDuration(+e.target.value)}>{[3,5,8,10,15].map(n=><option key={n} value={n}>{n} seconds</option>)}</select></Field><Field label="Grok quality"><select disabled={locked} value={resolution} onChange={e=>setResolution(e.target.value)}><option value="480p">480p · Standard</option><option value="720p">720p · High</option></select></Field></div>
            {!config.xaiConfigured && <button className="connection-note" onClick={()=>setSettings(true)}><KeyRound size={15}/>Connect Grok to generate video<ArrowRight size={14}/></button>}
            <button className="primary full" disabled={!canVideo} onClick={()=>start('video')}><Play size={16}/>Animate & export 360° MP4</button>
            <button className="secondary full" disabled={!canVideo||!canImage} onClick={()=>start('both')}><Sparkles size={16}/>Remix image, then animate</button>
            <p className="small muted">Uses the current square, including your image edits. The combined option uses both prompts.</p>
            <div className="divider"/><h4>Use your own clip</h4><p className="small muted">Import a clip up to 15s. Non-square clips are cropped to fill the square. Grok remix accepts up to 8.7s.</p>
            <button className="secondary full" disabled={!project||locked} onClick={()=>clipRef.current.click()}><Upload size={16}/>{project?.clip?'Replace video clip':'Import video clip'}</button>
            {project?.clip && <><div className="imported-clip"><Film size={16}/><span>{project.clip.name}</span><small>{project.clip.duration.toFixed(1)}s</small></div><button className="secondary full" disabled={!region||locked} onClick={()=>start('stitch-video')}>Stitch clip without AI</button><button className="secondary full" disabled={!canVideo||project.clip.duration>8.7} onClick={()=>start('video-edit')}>Remix clip with Grok & stitch</button></>}
          </>}
        </section>
        <section className="export-settings"><h3><Film size={16}/>Video export</h3>
          <label className="check-field"><input type="checkbox" checked={edgeMatch} disabled={locked} onChange={e=>setEdgeMatch(e.target.checked)}/><span>Match video edge colors</span></label>
          <Field label="Loop transition"><select disabled={locked} value={loopMode} onChange={e=>setLoopMode(e.target.value)}><option value="crossfade">Crossfade · smooth wrap</option><option value="pingpong">Ping-pong · forward & reverse</option><option value="none">Original · no loop correction</option></select></Field>
          <p className="small muted">{loopMode==='crossfade'?'Blends the end into the beginning; shortens the clip by up to 0.75s.':loopMode==='pingpong'?'Plays forward, then backward; doubles the clip duration.':'Keeps the clip as-is. The start and end may differ.'}</p>
          <div className="two-fields"><Field label="Panorama size"><select disabled={locked} value={outputWidth} onChange={e=>setOutputWidth(+e.target.value)}><option value="2048">2K · 2048 × 1024</option><option value="4096">4K · 4096 × 2048</option><option value="8192">8K · 8192 × 4096</option><option value="0">Source · up to 8K</option></select></Field><Field label="Frame rate"><select disabled={locked} value={fps} onChange={e=>setFps(+e.target.value)}><option value="24">24 fps</option><option value="30">30 fps</option></select></Field></div>
          <div className="format-note"><CheckCircle2 size={15}/><span>H.264 MP4 · 360° metadata</span></div><p className="small muted">This exports one silent region. Use Scenes & sound to combine regions and clips, and add narration or music.</p><a className="text-link" href="#final-video">Open Scenes & sound <ArrowRight size={14}/></a>
        </section>
      </aside>
    </main>
    {settings && <SettingsDialog config={config} close={()=>setSettings(false)} saved={c=>{setConfig(old=>({...old,...c}));setNotice('API settings saved locally.');}}/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
