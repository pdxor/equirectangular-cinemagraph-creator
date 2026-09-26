import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ffmpeg, probe } from '../server/media.js';
import { renderMovie, validateMovie } from '../server/movie.js';
import { generateAudio, listVoices } from '../server/audio.js';

test('multiple moving regions, seam wrap, scene order, delayed sound and final 360 metadata survive the real FFmpeg mix',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cinemagraph-movie-')),workDir=path.join(dir,'work');await fs.mkdir(workDir);
  await sharp({create:{width:512,height:256,channels:3,background:'#102030'}}).png().toFile(path.join(dir,'original.png'));
  for(const [name,color,size]of[['red','red','64x64'],['green','lime','64x64'],['orange','orange','512x256']])await ffmpeg(['-f','lavfi','-i',`color=c=${color}:s=${size}:r=24`,'-t','1','-c:v','libx264','-pix_fmt','yuv420p',path.join(dir,name+'.mp4')]);
  await ffmpeg(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:a','libmp3lame',path.join(dir,'voice.mp3')]);
  await ffmpeg(['-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=0.5','-c:a','libmp3lame',path.join(dir,'music.mp3')]);
  const project={width:512,height:256,exports:[{kind:'video',file:'orange.mp4',clip:'red.mp4',region:{x:100,y:100,size:64}}],clips:[{file:'green.mp4'}],audio:[{file:'voice.mp3'},{file:'music.mp3'}]};
  const movie=validateMovie(project,{title:'Layered story',outputWidth:0,fps:24,scenes:[
    {id:'one',type:'regions',name:'Two regions',base:'original.png',duration:3,layers:[
      {id:'red',source:'red.mp4',region:{x:100,y:100,size:64},duration:3,trim:.2,playback:'loop',edgeMatch:false,feather:8},
      {id:'green',source:'green.mp4',region:{x:490,y:40,size:64},start:.5,duration:2,playback:'hold',edgeMatch:false,feather:8}]},
    {id:'two',type:'video',name:'Next scene',source:'orange.mp4',trim:.1,duration:.8,volume:1}],tracks:[
      {id:'voice',source:'voice.mp3',kind:'narration',name:'Voice',start:1,duration:.9,volume:1},
      {id:'music',source:'music.mp3',kind:'music',name:'Music',duration:3.8,volume:.08,loop:true,fadeIn:.1,fadeOut:.2}]},{render:true});
  assert.throws(()=>validateMovie(project,{...movie,scenes:[{...movie.scenes[1],source:'unknown.mp4'}]}),/not in this project/);
  assert.throws(()=>validateMovie(project,{...movie,tracks:[{...movie.tracks[0],start:50}]},{render:true}),/after the film ends/);
  const output=path.join(dir,'final.mp4');const result=await renderMovie({project,movie,dir,workDir,output});
  const info=await probe(output),v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
  assert.equal(v.width,512);assert.equal(v.height,256);assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');assert.equal(a.channels,2);
  assert.ok(v.side_data_list.some(s=>s.projection==='equirectangular'));assert.ok(Math.abs(result.duration-3.8)<.12);
  async function pixel(time,x,y){const file=path.join(dir,'frame.rgb');await ffmpeg(['-ss',String(time),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',file]);const raw=await fs.readFile(file);return [...raw.subarray((y*512+x)*3,(y*512+x)*3+3)];}
  assert.ok((await pixel(.2,120,120))[0]>230,'First moving region appears');
  assert.ok((await pixel(.2,5,65))[1]<50,'Delayed layer is absent before its start');
  const wrapped=await pixel(1,5,65);assert.ok(wrapped[1]>220&&wrapped[0]<30,'Second region wraps across longitude seam');
  assert.ok((await pixel(2.8,5,65))[1]<50,'Layer ends at its configured time');
  assert.ok((await pixel(1,250,190))[0]<30,'Unselected panorama stays unchanged');
  const next=await pixel(3.4,250,190);assert.ok(next[0]>230&&next[1]>120,'Second scene appears in timeline order');
  const pcm=path.join(dir,'sound.raw');await ffmpeg(['-i',output,'-vn','-ac','1','-ar','48000','-f','s16le',pcm]);const raw=await fs.readFile(pcm);
  function rms(start,end){let sum=0,n=0;for(let i=Math.round(start*48000)*2;i<Math.round(end*48000)*2;i+=2){sum+=raw.readInt16LE(i)**2;n++;}return Math.sqrt(sum/n);}
  assert.ok(rms(1.2,1.5)>rms(.2,.5)*6,'Narration starts at the requested offset over quiet music');
  assert.ok(rms(2.2,2.5)>10,'Music loops beyond the original half-second asset');
});

test('ElevenLabs speech, effects, instrumental music and voice-list contracts; errors redact credentials',async()=>{
  const previous=globalThis.fetch,calls=[],key='sk_eleven-secret-private';
  const config={ELEVENLABS_API_KEY:key,ELEVENLABS_VOICE_ID:'voice123',ELEVENLABS_TTS_MODEL:'eleven_multilingual_v2',ELEVENLABS_MUSIC_MODEL:'music_v1'};
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('/v2/voices'))return Response.json({voices:[{voice_id:'voice123',name:'Test voice'}],has_more:false});return new Response(Buffer.from('binary fixture'),{headers:{'request-id':'request-123'}});};
  try{
    for(const kind of ['narration','sfx','music']){const result=await generateAudio({kind,text:'A quiet shimmer',duration:6,voiceId:'voice123',config});assert.equal(result.requestId,'request-123');}
    assert.ok(calls[0].url.includes('/v1/text-to-speech/voice123'));assert.equal(JSON.parse(calls[0].options.body).model_id,'eleven_multilingual_v2');
    assert.ok(calls[1].url.includes('/v1/sound-generation'));assert.equal(JSON.parse(calls[1].options.body).duration_seconds,6);
    const music=JSON.parse(calls[2].options.body);assert.ok(music.force_instrumental);assert.equal(music.music_length_ms,6000);
    assert.ok(calls.every(c=>c.options.headers['xi-api-key']===key));
    assert.deepEqual((await listVoices(config)).voices[0].name,'Test voice');
    globalThis.fetch=async()=>Response.json({detail:{message:'Invalid '+key}},{status:401});
    await assert.rejects(generateAudio({kind:'narration',text:'Hello',config}),e=>e.message.includes('401')&&!e.message.includes(key));
  }finally{globalThis.fetch=previous;}
});
