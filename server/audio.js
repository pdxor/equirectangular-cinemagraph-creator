import { safeError } from './config.js';

const origin = 'https://api.elevenlabs.io';
async function call(endpoint, config, { body, signal, timeout = 300000 } = {}) {
  if (!config.ELEVENLABS_API_KEY) throw new Error('Add your ElevenLabs key in API settings or ELEVENLABS_API_KEY in .env.');
  const response = await fetch(origin + endpoint, {
    method: body ? 'POST' : 'GET',
    headers: { 'xi-api-key': config.ELEVENLABS_API_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail?.message || data.detail?.status || data.detail || data.message || 'Request failed';
    const message = (typeof detail === 'string' ? detail : JSON.stringify(detail)).split(config.ELEVENLABS_API_KEY).join('[redacted]');
    throw new Error(safeError('ElevenLabs: ' + message + ' (HTTP ' + response.status + ')'));
  }
  return response;
}
export async function listVoices(config, { search = '', cursor = '' } = {}) {
  const query = new URLSearchParams({ page_size: '100', include_total_count: 'false' });
  if (search) query.set('search', search.slice(0, 100));
  if (cursor) query.set('next_page_token', cursor.slice(0, 300));
  const data = await (await call('/v2/voices?' + query, config, { timeout: 30000 })).json();
  return { voices: (data.voices || []).map(v => ({ id: v.voice_id, name: v.name, category: v.category })), nextCursor: data.has_more ? data.next_page_token : null };
}
export async function generateAudio({ kind, text, duration, voiceId, loop, config, signal }) {
  let endpoint, body;
  if (kind === 'narration') {
    const voice = voiceId || config.ELEVENLABS_VOICE_ID;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(voice || '')) throw new Error('Choose a voice or enter a valid ElevenLabs voice ID.');
    endpoint = '/v1/text-to-speech/' + encodeURIComponent(voice);
    body = { text, model_id: config.ELEVENLABS_TTS_MODEL };
  } else if (kind === 'sfx') {
    endpoint = '/v1/sound-generation';
    body = { text, duration_seconds: duration, loop: !!loop, model_id: 'eleven_text_to_sound_v2', prompt_influence: 0.3 };
  } else if (kind === 'music') {
    endpoint = '/v1/music';
    body = { prompt: text, music_length_ms: Math.round(duration * 1000), force_instrumental: true, model_id: config.ELEVENLABS_MUSIC_MODEL };
  } else throw new Error('Unknown audio type.');
  const response = await call(endpoint + '?output_format=mp3_44100_128', config, { body, signal });
  let total = 0; const chunks = [];
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > 50 * 1024 * 1024) throw new Error('Generated audio exceeds 50 MB.');
    chunks.push(Buffer.from(chunk));
  }
  if (!total) throw new Error('ElevenLabs returned no audio.');
  return { buffer: Buffer.concat(chunks), requestId: response.headers.get('request-id') || response.headers.get('x-request-id') || null };
}
