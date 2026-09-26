import fs from 'node:fs/promises';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
import { safeError } from './config.js';

async function request(url, options, signal, timeout = 120000) {
  const timeoutSignal = AbortSignal.timeout(timeout);
  const response = await fetch(url, { ...options, signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(safeError(new Error((data.error?.message || data.error || data.message || 'Provider request failed') + ' (HTTP ' + response.status + ')')));
  return data;
}
export async function remixImage({ crop, prompt, config, signal }) {
  if (!config.OPENAI_API_KEY) throw new Error('Add an OpenAI API key in Settings or .env.');
  const input = await sharp(crop).resize(1024, 1024).png().toBuffer();
  const form = new FormData();
  form.append('model', config.OPENAI_IMAGE_MODEL);
  form.append('image[]', new Blob([input], { type: 'image/png' }), 'panorama-square.png');
  form.append('prompt', 'Edit this square crop from an equirectangular 360-degree panorama. Keep the camera, composition, perspective, geometry and lighting fixed. Preserve the outer border so it blends back into the original panorama. Make only this requested change inside the crop: ' + prompt);
  form.append('size', '1024x1024'); form.append('quality', 'medium');
  form.append('output_format', 'png'); form.append('n', '1');
  const data = await request('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + config.OPENAI_API_KEY }, body: form }, signal, 600000);
  if (!data.data?.[0]?.b64_json) throw new Error('OpenAI returned no edited image.');
  return Buffer.from(data.data[0].b64_json, 'base64');
}
export async function generateVideo({ crop, clip, prompt, duration, resolution, config, requestId, onRequestId, signal, progress }) {
  if (!config.XAI_API_KEY) throw new Error('Add an xAI / Grok API key in Settings or .env.');
  const headers = { Authorization: 'Bearer ' + config.XAI_API_KEY, 'Content-Type': 'application/json' };
  let id = requestId;
  if (!id) {
    const body = { model: clip ? (config.XAI_EDIT_MODEL || 'grok-imagine-video') : config.XAI_VIDEO_MODEL, prompt: 'Locked-off camera. No camera movement, zoom, reframing or cuts. Keep the edges and background stationary. Only animate the requested elements. ' + prompt };
    if (clip) {
      const buffer = await fs.readFile(clip);
      body.video = { url: 'data:video/mp4;base64,' + buffer.toString('base64') };
    } else {
      const input = await sharp(crop).resize(1024, 1024).jpeg({ quality: 92 }).toBuffer();
      body.image = { url: 'data:image/jpeg;base64,' + input.toString('base64') };
      body.duration = duration; body.aspect_ratio = '1:1'; body.resolution = resolution;
      body.generate_audio = false;
    }
    const created = await request('https://api.x.ai/v1/videos/' + (clip ? 'edits' : 'generations'), { method: 'POST', headers, body: JSON.stringify(body) }, signal);
    if (!created.request_id) throw new Error('Grok returned no video request ID.');
    id = created.request_id; await onRequestId(id);
  }
  const start = Date.now();
  while (Date.now() - start < 30 * 60 * 1000) {
    signal?.throwIfAborted();
    const result = await request('https://api.x.ai/v1/videos/' + encodeURIComponent(id), { headers }, signal);
    if (result.status === 'done' && result.video?.url) {
      if (result.video.respect_moderation === false) throw new Error('Grok could not return this video because of its content policy.');
      const url = new URL(result.video.url);
      if (url.protocol !== 'https:') throw new Error('Provider returned an invalid download URL.');
      const response = await fetch(url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(120000)]) });
      if (!response.ok) throw new Error('Could not download the generated video.');
      const chunks = []; let total = 0;
      for await (const chunk of response.body) { total += chunk.length; if (total > 100 * 1024 * 1024) throw new Error('Generated clip exceeds 100 MB.'); chunks.push(Buffer.from(chunk)); }
      return Buffer.concat(chunks);
    }
    if (['failed', 'expired'].includes(result.status)) throw new Error('Grok video request ' + result.status + '. Try a new generation.');
    progress(Math.min(55, 30 + (Date.now() - start) / 12000), 'Grok is animating the square');
    await delay(5000, undefined, { signal });
  }
  throw new Error('Grok is taking longer than 30 minutes. Use Resume to check this same request without starting another generation.');
}

export async function generateOverlay({ prompt, config, signal }) {
  if (!config.OPENAI_API_KEY) throw new Error('Add an OpenAI API key in Settings or .env.');
  const data = await request('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.OPENAI_IMAGE_MODEL, prompt: 'Create an isolated character or object cutout for placing into a 360 panorama. Keep the complete subject in frame, with a fully transparent background. No scenery, solid backdrop, checkerboard, text labels or ground plane. Subject description: ' + prompt, size: '1024x1024', quality: 'medium', background: 'transparent', output_format: 'png', n: 1 }),
  }, signal, 600000);
  if (!data.data?.[0]?.b64_json) throw new Error('OpenAI returned no PNG overlay.');
  return Buffer.from(data.data[0].b64_json, 'base64');
}
