import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

test('local API: upload, key persistence, validation, CSRF checks and completed patch export', async () => {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-api-'));
  process.env.DATA_DIR=path.join(tmp,'data'); process.env.CONFIG_PATH=path.join(tmp,'.env');
  await fs.writeFile(process.env.CONFIG_PATH,'OPENAI_API_KEY=test-openai-local\nXAI_API_KEY=test-xai-local\n');
  const {createApp}=await import('../server/index.js');
  const app=await createApp();
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(url,options={})=>fetch(base+'/api'+url,{...options,headers:{'X-Cinemagraph-Client':'1',...options.headers}});
  try {
    const settings=await (await request('/settings')).json();
    assert.equal(settings.openaiConfigured,true); assert.equal(JSON.stringify(settings).includes('test-openai-local'),false);
    const saved=await request('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({OPENAI_IMAGE_MODEL:'gpt-image-2'})});
    assert.equal(saved.status,200); assert.ok((await fs.readFile(process.env.CONFIG_PATH,'utf8')).includes('OPENAI_API_KEY=test-openai-local'));
    assert.equal((await request('/settings',{method:'PUT',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const bad=await sharp({create:{width:100,height:100,channels:3,background:'#abcdef'}}).png().toBuffer();
    const badForm=new FormData();badForm.append('panorama',new Blob([bad]),'wrong.png');
    assert.equal((await request('/projects',{method:'POST',body:badForm})).status,400);
    const image=await sharp({create:{width:512,height:256,channels:3,background:'#102030'}}).png().toBuffer();
    const form=new FormData();form.append('panorama',new Blob([image]),'test.png');
    const response=await request('/projects',{method:'POST',body:form});assert.equal(response.status,201);
    const p=await response.json();
    const patch=new FormData();patch.append('patch',new Blob([bad]),'patch.png');
    assert.equal((await request('/projects/'+p.id+'/patch',{method:'POST',body:patch})).status,200);
    const invalid=await request('/projects/'+p.id+'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'stitch-image',region:{x:0,y:255,size:64}})});
    assert.equal(invalid.status,400);
    const started=await request('/projects/'+p.id+'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'stitch-image',region:{x:480,y:50,size:64}})});
    assert.equal(started.status,202); const job=await started.json();
    let status;
    for(let i=0;i<50;i++){status=await(await request('/jobs/'+job.id)).json();if(['done','failed'].includes(status.status))break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(status.status,'done',status.message);
    const complete=await(await request('/projects/'+p.id)).json();
    assert.equal(complete.exports.length,1);
    const downloaded=await request('/projects/'+p.id+'/assets/'+complete.exports[0].file+'?download=1');
    assert.equal(downloaded.status,200);assert.ok(downloaded.headers.get('content-disposition').includes('attachment'));
    assert.equal((await request('/projects/'+p.id+'/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"file":"original.png"}'})).status,200);
    // Exercise the complete combined workflow with deterministic provider assets.
    const {ffmpeg}=await import('../server/media.js');
    const clipPath=path.join(tmp,'fixture.mp4');
    await ffmpeg(['-f','lavfi','-i','testsrc2=size=64x64:rate=24','-t','1','-c:v','libx264','-pix_fmt','yuv420p',clipPath]);
    const clip=await fs.readFile(clipPath),realFetch=globalThis.fetch,providerCalls=[];
    globalThis.fetch=async(url,options={})=>{
      if(String(url).startsWith('https://api.openai.com/')){
        providerCalls.push('image');assert.equal(options.body.get('size'),'1024x1024');
        return Response.json({data:[{b64_json:bad.toString('base64')}]});
      }
      if(String(url)==='https://api.x.ai/v1/videos/generations'){providerCalls.push('video');const body=JSON.parse(options.body);assert.equal(body.aspect_ratio,'1:1');return Response.json({request_id:'test-request'});}
      if(String(url)==='https://api.x.ai/v1/videos/test-request')return Response.json({status:'done',video:{url:'https://vidgen.x.ai/test.mp4',respect_moderation:true}});
      if(String(url)==='https://vidgen.x.ai/test.mp4')return new Response(clip);
      return realFetch(url,options);
    };
    try{
      const both=await(await request('/projects/'+p.id+'/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'both',region:{x:480,y:50,size:64},imagePrompt:'Add a small light',videoPrompt:'Make it sparkle',loopMode:'crossfade'})})).json();
      for(let i=0;i<100;i++){status=await(await request('/jobs/'+both.id)).json();if(['done','failed'].includes(status.status))break;await new Promise(r=>setTimeout(r,100));}
      assert.equal(status.status,'done',status.message);assert.deepEqual(providerCalls,['image','video']);
      const combined=await(await request('/projects/'+p.id)).json();assert.equal(combined.exports.length,3);assert.equal(combined.exports.at(-1).kind,'video');
    }finally{globalThis.fetch=realFetch;}
  }finally{await new Promise(r=>server.close(r));}
});
