import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownToLine, ArrowRight, Check, Copy, ExternalLink, Film, Github, Globe2, KeyRound, Lasso, Layers3, Mic, MoveUpRight, Square, WandSparkles } from 'lucide-react';
import { squareFromPoints, clamp } from '../shared/geometry.js';
import './style.css';

const repo = 'https://github.com/pdxor/equirectangular-cinemagraph-creator';
const clone = 'git clone ' + repo + '.git\ncd equirectangular-cinemagraph-creator';
const commands = {
  windows: clone + '\n.\\start.ps1',
  unix: clone + '\n[ -f .env ] || cp .env.example .env\ndocker compose up --build -d',
  native: clone + '\nnpm run setup\nnpm ci\nnpm run build\nnpm start',
};

function Demo() {
  const [tool, setTool] = useState('lasso');
  const [region, setRegion] = useState({x: 640, y: 120, size: 256});
  const [points, setPoints] = useState([]);
  const gesture = useRef(null);
  function point(e) {
    const bounds = e.currentTarget.getBoundingClientRect();
    return {x: clamp((e.clientX - bounds.left) / bounds.width * 1600, 0, 1599), y: clamp((e.clientY - bounds.top) / bounds.height * 800, 0, 799)};
  }
  function begin(e) {
    if(e.button !== 0) return;
    e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = [point(e)]; setPoints(gesture.current);
  }
  function move(e) {
    if(!gesture.current) return;
    gesture.current = tool === 'square' ? [gesture.current[0], point(e)] : [...gesture.current, point(e)].slice(-2000);
    setPoints(gesture.current);
  }
  function end(e) {
    if(!gesture.current) return;
    const p = point(e);
    const selected = gesture.current.length > 1 ? gesture.current : [p, {x:p.x+180,y:p.y+180}];
    setRegion(squareFromPoints(selected,1600,800));
    gesture.current = null; setPoints([]);
    if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function key(e) {
    const step = e.shiftKey ? 10 : 1;
    const delta = {ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
    if(delta){ e.preventDefault(); setRegion({...region,x:clamp(region.x+delta[0],0,1600-region.size),y:clamp(region.y+delta[1],0,800-region.size)}); }
  }
  return <section className="demo" id="demo" aria-labelledby="demo-title">
    <div className="demo-toolbar"><div><span className="status-dot"/><strong id="demo-title">Try the selection</strong><span className="demo-subtitle">No keys needed</span></div><div className="tools" role="group" aria-label="Selection tools"><button aria-pressed={tool==='lasso'} onClick={()=>setTool('lasso')}><Lasso size={16}/> Lasso</button><button aria-pressed={tool==='square'} onClick={()=>setTool('square')}><Square size={15}/> Square</button></div></div>
    <div className="demo-stage">
      <svg viewBox="0 0 1600 800" tabIndex={0} role="application" aria-label="Demo panorama. Draw a lasso or square; arrow keys move the selection." onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{gesture.current=null;setPoints([]);}} onKeyDown={key}>
        <image href="/demo-panorama.svg" width="1600" height="800"/>
        <defs><pattern id="grid" width="133.33" height="133.33" patternUnits="userSpaceOnUse"><path d="M133.33 0H0V133.33" fill="none" stroke="white" strokeOpacity=".08"/></pattern></defs>
        <rect width="1600" height="800" fill="url(#grid)"/>
        {[-1600,0,1600].map(dx=><g key={dx}><rect x={region.x+dx} y={region.y} width={region.size} height={region.size} fill="#cdf780" fillOpacity=".09" stroke="#cdf780" strokeWidth="2" vectorEffect="non-scaling-stroke"/>{[[0,0],[0,1],[1,0],[1,1]].map(([x,y])=><rect key={x+','+y} x={region.x+dx+region.size*x-4} y={region.y+region.size*y-4} width="8" height="8" fill="#cdf780"/>)}</g>)}
        {points.length>1&&<polyline points={points.map(p=>p.x+','+p.y).join(' ')} fill="#cdf78022" stroke="#cdf780" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
      </svg>
      <span className="projection-label">EQUIRECTANGULAR · 2:1</span><span className="demo-caption">Draw around something. We’ll make it square.</span>
    </div>
    <div className="demo-footer"><span><span className="status-dot"/>Selection <strong>{region.size} × {region.size}</strong> px <span className="coordinates">/ X {region.x} · Y {region.y}</span></span><a href="/demo-panorama.png" download="sample-panorama.png"><ArrowDownToLine size={15}/> Sample panorama</a></div>
    <p className="demo-note">This illustration demonstrates selection only. Image generation, animation and export are available in the local studio.</p>
  </section>;
}

function App() {
  const [platform,setPlatform] = useState('windows');
  const [copied,setCopied] = useState(false), [copyError,setCopyError]=useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(commands[platform]); setCopied(true); setCopyError(false); setTimeout(()=>setCopied(false),2000); }
    catch { setCopyError(true); }
  }
  return <div className="site">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="header wrap"><a className="brand" href="#" aria-label="Equirectangular Cinemagraph Creator home"><span className="brand-icon"><Globe2 size={24}/></span><span>Equirectangular<span>Cinemagraph Creator</span></span></a><nav aria-label="Main navigation"><a className="nav-guide" href="#start">Get started</a><a href={repo} target="_blank" rel="noreferrer"><Github size={17}/><span>GitHub</span><MoveUpRight size={12}/></a></nav></header>
    <main id="main" className="wrap">
      <section className="hero"><div className="eyebrow"><span className="status-dot"/> A CREATIVE STUDIO FOR 360°</div><h1>A still world.<br/><span>A little life.</span></h1><p>Turn one small part of a panorama into motion. Remix a detail, build a sequence, and add sound to make the whole world feel alive.</p><div className="hero-actions"><a className="button primary" href="#start">Set up your studio <ArrowRight size={18}/></a><a className="button secondary" href="http://localhost:4317/" target="_blank" rel="noreferrer">Open local studio <ExternalLink size={15}/></a></div><p className="hero-footnote">Runs on your computer with Docker or Node.js + FFmpeg.<br/>Bring your own OpenAI, xAI and ElevenLabs API keys.</p></section>
      <Demo/>
      <section className="workflow" aria-label="What you can create"><article><span className="step-number">01 / REMIX</span><WandSparkles/><h2>Change a detail.</h2><p>Upload or generate transparent PNG characters and drag them into place. Or lasso a detail and remix it with OpenAI.</p></article><article><span className="step-number">02 / DIRECT</span><Layers3/><h2>Build a world in motion.</h2><p>Animate with Grok, layer several moving regions, or join 360° scenes into a longer story.</p></article><article><span className="step-number">03 / SCORE</span><Mic/><h2>Give it a voice.</h2><p>Add ElevenLabs narration, sound effects and music. Mix levels and timing, then export a tagged 360° MP4.</p></article></section>
      <section className="setup" id="start" aria-labelledby="setup-title"><div className="setup-intro"><div className="eyebrow">MAKE YOUR FIRST CINEMAGRAPH</div><h2 id="setup-title">Your studio.<br/>Your computer.</h2><p>The public website is your starting point. The full editor and FFmpeg renderer run locally, with your own keys and storage.</p><a className="text-link" href={repo+'#readme'} target="_blank" rel="noreferrer">Read the complete guide <MoveUpRight size={15}/></a><div className="privacy-note"><KeyRound size={20}/><p>Enter keys in <strong>API settings</strong> inside your local studio. They are saved in your local <code>.env</code>, never on this website.</p></div></div>
        <div className="setup-steps"><div className="setup-step"><span className="step-badge">1</span><div><h3>Install and start</h3><p>Install <a href="https://git-scm.com/downloads" target="_blank" rel="noreferrer">Git</a> and <a href="https://docs.docker.com/get-started/get-docker/" target="_blank" rel="noreferrer">Docker</a>, then open your terminal. Docker must be running.</p><div className="platforms" role="group" aria-label="Installation platform">{[['windows','Windows'],['unix','macOS / Linux'],['native','Without Docker']].map(([value,label])=><button key={value} aria-pressed={platform===value} onClick={()=>{setPlatform(value);setCopied(false);setCopyError(false);}}>{label}</button>)}</div>{platform==='native'&&<p className="native-note">Requires Node.js 22+ and FFmpeg / FFprobe on your PATH.</p>}<div className="command-block"><button className="copy" aria-label="Copy setup commands" onClick={copy}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied':'Copy'}</button><pre><code>{commands[platform]}</code></pre></div>{copyError&&<p role="status">Select and copy the commands above; clipboard access is unavailable.</p>}<p className="small">Windows blocks scripts? Use the <a href={repo+'#windows-powershell'} target="_blank" rel="noreferrer">manual PowerShell commands</a>.</p></div></div>
          <div className="setup-step"><span className="step-badge">2</span><div><h3>Connect your own accounts</h3><p>Open <a href="http://localhost:4317/" target="_blank" rel="noreferrer">localhost:4317</a>, select <strong>API settings</strong>, and save the keys for the tools you want. Importing and stitching your own media needs no keys.</p><span className="provider-list">OpenAI · Grok / xAI · ElevenLabs</span></div></div>
          <div className="setup-step"><span className="step-badge">3</span><div><h3>Start with one square</h3><p>Upload a 2:1 panorama. Select a region, describe the change, and animate it. Use <strong>Scenes & sound</strong> for multiple scenes, moving regions and audio.</p><a className="button primary" href="http://localhost:4317/" target="_blank" rel="noreferrer">Launch local studio <ArrowRight size={16}/></a></div></div>
        </div>
      </section>
      <section className="questions" aria-labelledby="questions-title"><h2 id="questions-title">Before you begin</h2><div><details><summary>Does the studio run on Netlify?</summary><p>Netlify hosts this guide and selection demo. The complete studio runs on your computer so FFmpeg can render long videos and preserve your projects between sessions. Clicking “Open local studio” works after you start Docker or the Node server.</p></details><details><summary>Which keys do I need?</summary><p>OpenAI is for image remixing, xAI is for video generation and editing, and ElevenLabs is for narration, effects and music. Add only the services you use. Each provider bills your account for generation; importing media and local rendering do not call an AI service.</p></details><details><summary>Will the MP4 be recognized as 360° video?</summary><p>Exports include spherical video metadata for monoscopic equirectangular projection. The final film also includes AAC stereo audio. Use a 360-capable player or platform; a normal video player may still show the flat panorama. Spatial or ambisonic audio is not included.</p></details><details><summary>Where do my files and keys go?</summary><p>Projects, media and timelines are in the local data folder. Keys are in your local .env file. The selected square or clip goes to OpenAI or xAI when you generate; scripts and sound descriptions go to ElevenLabs. This public website receives none of your keys or media.</p></details></div></section>
    </main>
    <footer className="footer wrap"><span><Globe2 size={17}/> Equirectangular Cinemagraph Creator</span><div><a href={repo+'#readme'}>Documentation</a><a href={repo+'/issues'}>Report an issue</a><span>Made for living worlds.</span></div></footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
