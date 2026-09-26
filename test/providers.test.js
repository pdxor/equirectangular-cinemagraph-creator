import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateVideo } from '../server/providers.js';
import { safeError } from '../server/config.js';
import { command } from '../server/media.js';
test('video edit request uses the edit endpoint and omits unsupported generation options', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-provider-')),clip=path.join(dir,'clip.mp4');await fs.writeFile(clip,'test');
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    url=String(url);
    calls.push(url);
    if(url.endsWith('/edits')){const body=JSON.parse(options.body);assert.equal(body.model,'grok-imagine-video');assert.ok(body.video.url.startsWith('data:video/mp4;base64,'));assert.equal(body.duration,undefined);assert.equal(body.resolution,undefined);assert.equal(body.aspect_ratio,undefined);return Response.json({request_id:'request-1'});}
    if(url.endsWith('/request-1'))return Response.json({status:'done',video:{url:'https://vidgen.x.ai/test.mp4',respect_moderation:true}});
    return new Response(Buffer.from('video'));
  };
  try {
    const result=await generateVideo({clip,prompt:'Glitter',config:{XAI_API_KEY:'test'},duration:8,resolution:'720p',onRequestId:async()=>{},progress:()=>{}});
    assert.equal(result.toString(),'video');assert.equal(calls[0],'https://api.x.ai/v1/videos/edits');
    calls.length=0;
    await generateVideo({requestId:'request-1',config:{XAI_API_KEY:'test'},progress:()=>{}});
    assert.equal(calls.length,2);assert.equal(calls[0],'https://api.x.ai/v1/videos/request-1');
  }finally{globalThis.fetch=original;}
});
test('failed Grok job surfaces an error without retrying a charged request', async () => {
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({status:'failed'});};
  try{await assert.rejects(generateVideo({requestId:'failed-1',config:{XAI_API_KEY:'test'},progress:()=>{}}),/failed/);assert.equal(calls,1);}
  finally{globalThis.fetch=original;}
});
test('provider errors redact complete and masked tokens',()=>{
  assert.equal(safeError(new Error('Incorrect sk-proj-secret********1234 token')),'Incorrect [redacted] token');
  assert.equal(safeError(new Error('Bearer test-private-token')),'Bearer [redacted]');
});
test('subprocess timeout settles instead of hanging',async()=>{
  await assert.rejects(command(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:50}),/timed out/);
});
