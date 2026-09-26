import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

test('movie API imports media, persists timeline, generates all three audio kinds, renders and resumes without regenerating audio',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-movie-api-'));
  process.env.DATA_DIR=path.join(temp,'data');process.env.CONFIG_PATH=path.join(temp,'.env');
  await fs.writeFile(process.env.CONFIG_PATH,'ELEVENLABS_API_KEY=sk_test-fixture\n');
  const {createApp}=await import('../server/index.js');const {ffmpeg,probe}=await import('../server/media.js');
  const app=await createApp(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api',realFetch=globalThis.fetch;
  const request=(url,method='GET',body)=>realFetch(base+url,{method,headers:{'X-Cinemagraph-Client':'1',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
  const wait=async id=>{for(let i=0;i<200;i++){const j=await(await request('/jobs/'+id)).json();if(['done','failed','cancelled'].includes(j.status)){assert.equal(j.status,'done',j.message);return j;}await new Promise(r=>setTimeout(r,50));}throw new Error('Job timed out');};
  try{
    const image=await sharp({create:{width:256,height:128,channels:3,background:'#102030'}}).png().toBuffer(),form=new FormData();form.append('panorama',new Blob([image]),'fixture.png');
    const p=await(await request('/projects','POST',form)).json(),prefix='/projects/'+p.id;
    const clip=path.join(temp,'clip.mp4'),sound=path.join(temp,'tone.mp3');
    await ffmpeg(['-f','lavfi','-i','testsrc2=s=256x128:r=24','-t','1','-c:v','libx264',clip]);
    await ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame',sound]);
    for(const [kind,file]of[['scene',clip],['audio',sound]]){const data=new FormData();data.append('kind',kind);data.append('media',new Blob([await fs.readFile(file)]),path.basename(file));assert.equal((await request(prefix+'/media','POST',data)).status,200);}
    const calls=[];globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https://api.elevenlabs.io')){calls.push(String(url));return new Response(await fs.readFile(sound));}return realFetch(url,options);};
    for(const kind of ['narration','sfx','music']){const r=await request(prefix+'/audio','POST',{kind,text:'Test sound',duration:3,voiceId:'voice123'});assert.equal(r.status,202);await wait((await r.json()).id);}
    assert.equal(calls.length,3);
    const next=await(await request(prefix)).json();assert.equal(next.audio.length,4);assert.equal(next.media.length,1);
    const movie={title:'Acceptance movie',scenes:[{id:'a',type:'regions',name:'Still scene',base:'original.png',duration:.5,layers:[]},{id:'b',type:'video',name:'Imported scene',source:next.media[0].file,trim:0,duration:.8}],tracks:[{id:'sound',source:next.audio[1].file,name:'Generated voice',kind:'narration',start:.1,duration:.8}],fps:24,outputWidth:0};
    assert.equal((await request(prefix+'/movie','PUT',movie)).status,200);
    assert.equal((await request(prefix+'/movie','PUT',{...movie,tracks:[{...movie.tracks[0],source:'outside.mp3'}]})).status,400);
    assert.equal((await request(prefix+'/audio','POST',{kind:'sfx',text:'invalid length',duration:120})).status,400);
    const render=await request(prefix+'/movie/render','POST',movie);assert.equal(render.status,202);const job=await wait((await render.json()).id);
    const done=await(await request(prefix)).json();assert.equal(done.movie.title,'Acceptance movie');assert.equal(done.exports.at(-1).role,'movie');assert.equal(done.exports.at(-1).sceneCount,2);
    const info=await probe(path.join(process.env.DATA_DIR,'projects',p.id,job.output));assert.ok(info.streams.some(s=>s.side_data_list?.some(d=>d.projection==='equirectangular')));
    const download=await request(prefix+'/assets/'+job.output+'?download=1');assert.equal(download.status,200);assert.match(download.headers.get('content-type'),/video\/mp4/);
    // Saved audio is reused if a later local stage failed; no second provider charge.
    const {jobs,resumeJob}=await import('../server/jobs.js');const audioJob=[...jobs.values()].find(j=>j.options.type==='audio');audioJob.status='failed';await resumeJob(audioJob.id);await wait(audioJob.id);assert.equal(calls.length,3);
    const flags=await(await request('/settings')).json();assert.equal(flags.elevenlabsConfigured,true);assert.ok(!JSON.stringify(flags).includes('sk_test-fixture'));
  }finally{globalThis.fetch=realFetch;await new Promise(r=>server.close(r));}
});
