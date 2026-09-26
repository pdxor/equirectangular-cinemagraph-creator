import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { inspectOverlay, validateOverlays, compositeOverlays } from '../server/overlays.js';
import { ffmpeg, probe, exportVideo } from '../server/media.js';

async function cutout() {
  const pixels=Buffer.alloc(16*12*4);
  for(let y=2;y<10;y++)for(let x=2;x<14;x++) {const i=(y*16+x)*4;pixels[i]=240;pixels[i+1]=40;pixels[i+2]=60;pixels[i+3]=x<8?255:128;}
  return sharp(pixels,{raw:{width:16,height:12,channels:4}}).png().toBuffer();
}

test('PNG alpha, opacity and layer order survive seam wrapping and a real 360 video export',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-overlay-')),base=path.join(dir,'base.png'),output=path.join(dir,'merged.png');
  const png=await cutout();await fs.writeFile(path.join(dir,'cutout.png'),png);
  await sharp({create:{width:256,height:128,channels:3,background:'#102030'}}).png().toFile(base);
  assert.deepEqual(await inspectOverlay(png),{width:16,height:12});
  await assert.rejects(inspectOverlay(await sharp({create:{width:16,height:12,channels:3,background:'white'}}).png().toBuffer()),/no transparency/);
  const project={width:256,height:128,overlays:[{file:'cutout.png',width:16,height:12}]};
  const placements=validateOverlays(project,[{source:'cutout.png',x:252,y:20,width:16,opacity:1},{source:'cutout.png',x:100,y:60,width:16,opacity:.5}]);
  assert.throws(()=>validateOverlays(project,[{source:'../outside.png',x:0,y:0,width:16}]),/not found/);
  assert.throws(()=>validateOverlays(project,[{source:'cutout.png',x:0,y:120,width:16}]),/panorama height/);
  await compositeOverlays({base,placements,width:256,dir,output});
  const pixels=await sharp(output).removeAlpha().raw().toBuffer(),pixel=(x,y)=>[...pixels.subarray((y*256+x)*3,(y*256+x)*3+3)];
  assert.deepEqual(pixel(252,20),[16,32,48],'transparent border preserves scene');
  assert.deepEqual(pixel(255,24),[240,40,60],'right-hand seam piece');
  assert.deepEqual(pixel(1,24),[240,40,60],'left-hand seam piece');
  for(const [actual,expected] of pixel(105,65).map((a,i)=>[a,[128,36,54][i]]))assert.ok(Math.abs(actual-expected)<=1,'opacity multiplies original alpha');
  assert.deepEqual(pixel(120,80),[16,32,48],'pixels outside PNGs are unchanged');
  const doubled=path.join(dir,'double.png');
  await compositeOverlays({base,placements:[...placements,placements[1]],width:256,dir,output:doubled});
  const more=await sharp(doubled).removeAlpha().raw().toBuffer();assert.ok(more[(65*256+105)*3]>pixels[(65*256+105)*3],'later layer composites over previous layer');
  const clip=path.join(dir,'motion.mp4'),video=path.join(dir,'film.mp4');
  await ffmpeg(['-f','lavfi','-i','testsrc2=s=32x32:r=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p',clip]);
  await exportVideo({base:output,clip,region:{x:40,y:20,size:32},width:256,height:128,outputWidth:256,loopMode:'none',feather:0,edgeMatch:false,workDir:dir,output:video});
  const info=await probe(video);assert.ok(info.streams[0].side_data_list.some(s=>s.projection==='equirectangular'));
  const frame=path.join(dir,'frame.rgb');await ffmpeg(['-ss','0.5','-i',video,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',frame]);
  const rendered=await fs.readFile(frame);assert.ok(rendered[(65*256+105)*3]>90,'static PNG stays visible beside animated region');
});

test('PNG API imports, generates with transparent background, composites and resumes saved generation',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-overlay-api-'));process.env.DATA_DIR=path.join(dir,'data');process.env.CONFIG_PATH=path.join(dir,'.env');
  await fs.writeFile(process.env.CONFIG_PATH,'OPENAI_API_KEY=test-overlay-key\n');
  const {createApp}=await import('../server/index.js'),app=await createApp(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api',realFetch=globalThis.fetch,png=await cutout();let calls=0;
  const req=(url,method='GET',body)=>realFetch(base+url,{method,headers:{'X-Cinemagraph-Client':'1',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
  const wait=async id=>{for(let n=0;n<100;n++){const j=await(await req('/jobs/'+id)).json();if(['done','failed'].includes(j.status)){assert.equal(j.status,'done',j.message);return j;}await new Promise(r=>setTimeout(r,50));}throw new Error('Timed out');};
  try {
    const form=new FormData();form.append('panorama',new Blob([await sharp({create:{width:256,height:128,channels:3,background:'#123456'}}).png().toBuffer()]),'scene.png');
    const p=await(await req('/projects','POST',form)).json(),prefix='/projects/'+p.id;
    const upload=new FormData();upload.append('overlay',new Blob([png]),'character.png');
    assert.equal((await req(prefix+'/overlays','POST',upload)).status,201);
    globalThis.fetch=async(url,options)=>{
      if(String(url)==='https://api.openai.com/v1/images/generations') {calls++;const body=JSON.parse(options.body);assert.equal(body.background,'transparent');assert.equal(body.output_format,'png');assert.equal(body.n,1);return Response.json({data:[{b64_json:png.toString('base64')}]});}
      return realFetch(url,options);
    };
    const generated=await req(prefix+'/overlays/generate','POST',{prompt:'A small friendly cardboard character'});assert.equal(generated.status,202);const job=await wait((await generated.json()).id);
    const next=await(await req(prefix)).json();assert.equal(next.overlays.length,2);assert.equal(next.image,'original.png');
    const invalid=await req(prefix+'/overlays/compose','POST',{overlays:[{source:'outside.png',x:0,y:0,width:16}]});assert.equal(invalid.status,400);
    const merge=await req(prefix+'/overlays/compose','POST',{overlays:[{source:next.overlays[0].file,x:250,y:30,width:16}]});assert.equal(merge.status,202);await wait((await merge.json()).id);
    const done=await(await req(prefix)).json();assert.notEqual(done.image,'original.png');assert.equal(done.exports.at(-1).kind,'image');
    const download=await req(prefix+'/assets/'+next.overlays[0].file);assert.equal(download.status,200);assert.equal((await sharp(Buffer.from(await download.arrayBuffer())).metadata()).hasAlpha,true);
    const {jobs,resumeJob}=await import('../server/jobs.js');jobs.get(job.id).status='failed';await resumeJob(job.id);await wait(job.id);assert.equal(calls,1,'saved PNG avoids a second paid request');
  } finally {globalThis.fetch=realFetch;await new Promise(r=>server.close(r));}
});
