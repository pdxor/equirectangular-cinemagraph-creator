import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

export const root = process.cwd();
export const configPath = path.resolve(process.env.CONFIG_PATH || path.join(root, '.env'));
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const defaults = { OPENAI_IMAGE_MODEL: 'gpt-image-2', XAI_VIDEO_MODEL: 'grok-imagine-video-1.5', XAI_EDIT_MODEL: 'grok-imagine-video', ELEVENLABS_TTS_MODEL: 'eleven_multilingual_v2', ELEVENLABS_MUSIC_MODEL: 'music_v1', ELEVENLABS_VOICE_ID: 'JBFqnCBsd6RMkjVDRZzb', PORT: '4317' };
const editable = ['OPENAI_API_KEY', 'XAI_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_IMAGE_MODEL', 'XAI_VIDEO_MODEL', 'XAI_EDIT_MODEL', 'ELEVENLABS_TTS_MODEL', 'ELEVENLABS_MUSIC_MODEL', 'ELEVENLABS_VOICE_ID'];

export async function readConfig() {
  const contents = await fs.readFile(configPath, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return ''; });
  return { ...defaults, ...Object.fromEntries(editable.map(k => [k, process.env[k] || defaults[k] || ''])), ...dotenv.parse(contents) };
}
export async function publicConfig() {
  const c = await readConfig();
  return { openaiConfigured: !!c.OPENAI_API_KEY, xaiConfigured: !!c.XAI_API_KEY, elevenlabsConfigured: !!c.ELEVENLABS_API_KEY, imageModel: c.OPENAI_IMAGE_MODEL, videoModel: c.XAI_VIDEO_MODEL, editModel: c.XAI_EDIT_MODEL || defaults.XAI_EDIT_MODEL, ttsModel: c.ELEVENLABS_TTS_MODEL, musicModel: c.ELEVENLABS_MUSIC_MODEL, voiceId: c.ELEVENLABS_VOICE_ID };
}
let writes = Promise.resolve();
export function saveConfig(values) {
  const task = async () => {
    let contents = await fs.readFile(configPath, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return ''; });
    for (const key of editable) {
      if (!(key in values)) continue;
      const value = values[key];
      if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9._-]*$/.test(value)) throw new Error('Key or model has invalid characters.');
      const expression = new RegExp('^' + key + '=.*$', 'm');
      const line = key + '=' + value;
      contents = expression.test(contents) ? contents.replace(expression, () => line) : contents.trimEnd() + '\n' + line + '\n';
    }
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    // Write in place to support a Docker bind mount of this single .env file.
    await fs.writeFile(configPath, contents, { mode: 0o600 });
    return publicConfig();
  };
  const promise = writes.then(task);
  writes = promise.catch(() => {});
  return promise;
}
export function safeError(error) {
  return String(error?.message || error).replace(/\b(?:sk[-_]|xai-)[A-Za-z0-9_*-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 800);
}
