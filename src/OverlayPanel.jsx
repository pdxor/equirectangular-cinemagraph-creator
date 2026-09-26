import React, { useRef, useState } from 'react';
import { ArrowDownToLine, ImagePlus, Layers3, Sparkles, Upload, X } from 'lucide-react';
import { clamp, wrap } from '../shared/geometry.js';
import './overlays.css';

export default function OverlayPanel({project,draft,onDraft,selected,onSelected,onPlace,onCompose,locked,config,api,asset,onProject,onJob,onBusy,onError,onSettings}) {
  const fileRef=useRef(null),[prompt,setPrompt]=useState('');
  const active=draft.find(o=>o.id===selected),library=project.overlays||[];
  function update(values) {
    if(!active)return;
    const source=library.find(a=>a.file===active.source),maxWidth=Math.max(1,Math.floor(Math.min(project.width,project.height*source.width/source.height)));
    const width=clamp(Math.round(values.width??active.width),1,maxWidth),height=Math.max(1,Math.round(width*source.height/source.width));
    onDraft(draft.map(o=>o.id===selected?{...o,...values,width,height,x:Math.round(wrap(values.x??active.x,project.width)),y:Math.round(clamp(values.y??active.y,0,project.height-height))}:o));
  }
  async function upload(file) {
    if(!file)return;onBusy(true);onError('');
    try {const form=new FormData();form.append('overlay',file);const next=await api('/projects/'+project.id+'/overlays',{method:'POST',body:form});onProject(next);onPlace(next.overlays.at(-1));}
    catch(e){onError(e.message);}finally{onBusy(false);fileRef.current.value='';}
  }
  async function generate() {
    onBusy(true);onError('');
    try {onJob(await api('/projects/'+project.id+'/overlays/generate',{method:'POST',body:JSON.stringify({prompt})}));}
    catch(e){onError(e.message);}finally{onBusy(false);}
  }
  return <section className="overlay-panel" aria-labelledby="overlay-title">
    <div className="section-heading"><div><span className="eyebrow">CHARACTERS & OBJECTS</span><h3 id="overlay-title"><Layers3 size={18}/>Transparent PNG overlays</h3></div><button className="subtle small" disabled={locked} onClick={()=>fileRef.current.click()}><Upload size={15}/>Upload PNG</button></div>
    <input className="file-input" ref={fileRef} type="file" accept="image/png" aria-label="Upload transparent PNG" onChange={e=>upload(e.target.files[0])}/>
    <p className="small muted">Bring Box Boi, Bucky, or any cutout into the scene. Add layers, drag them over the panorama, then merge them into an image revision. Their transparent pixels keep the scene visible.</p>
    <div className="overlay-generate"><label className="field"><span>Generate a transparent character or object</span><textarea rows="2" placeholder="A friendly cardboard box character, full body, playful expression…" value={prompt} disabled={locked} onChange={e=>setPrompt(e.target.value)} maxLength={4000}/></label><button className="subtle" disabled={locked||prompt.trim().length<3||!config.openaiConfigured} onClick={generate}><Sparkles size={15}/>Generate PNG</button></div>
    {!config.openaiConfigured&&<button className="text-link" onClick={onSettings}>Add your OpenAI key to generate PNGs</button>}
    {!!library.length&&<div className="overlay-library" aria-label="PNG library">{library.map(o=><div key={o.id} className="overlay-asset"><button className="overlay-asset-image" disabled={locked||draft.length>=32} title={'Place '+o.name} aria-label={'Place '+o.name} onClick={()=>onPlace(o)}><img src={asset(project,o.file)} alt={o.name}/><ImagePlus size={15}/></button><span title={o.name}>{o.name}</span><a href={asset(project,o.file)+'?download=1'} aria-label={'Download PNG '+o.name}><ArrowDownToLine size={14}/></a></div>)}</div>}
    {!!draft.length&&<><div className="overlay-layers" aria-label="Placed PNG layers">{draft.map((o,index)=><div key={o.id} className={selected===o.id?'active':''}><button disabled={locked} onClick={()=>onSelected(o.id)}><span>{index+1}</span>{o.name}</button><button className="icon-button" aria-label={'Remove layer '+(index+1)} disabled={locked} onClick={()=>{onDraft(draft.filter(a=>a.id!==o.id));if(selected===o.id)onSelected(null);}}><X size={13}/></button></div>)}</div>
      {active&&<div className="overlay-properties">{[['x','Overlay X'],['y','Overlay Y'],['width','Overlay width']].map(([key,label])=><label key={key} className="field"><span>{label}</span><input aria-label={label} type="number" min={key==='width'?1:0} disabled={locked} value={active[key]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))update({[key]:n});}}/></label>)}<label className="field"><span>Opacity · {Math.round(active.opacity*100)}%</span><input aria-label="Overlay opacity" type="range" min="0" max="1" step=".05" value={active.opacity} disabled={locked} onChange={e=>update({opacity:+e.target.value})}/></label></div>}
      <div className="overlay-apply"><p className="small muted">Drag a layer to move it; drag its corner to resize. Later layers appear on top. Merge before generating video. Animate a different region to keep the character still, or select the character to animate it.</p><button className="primary" disabled={locked} onClick={onCompose}><Layers3 size={16}/>Merge {draft.length===1?'PNG':draft.length+' PNGs'} into panorama</button></div>
      <p className="small muted">Placements are drafts until merged. Each merge saves a new image revision; use Exports to restore an earlier one.</p>
    </>}
  </section>;
}
