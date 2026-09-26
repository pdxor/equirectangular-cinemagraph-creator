import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from './config.js';

export const idPattern = /^[0-9a-f-]{36}$/;
export const projectDir = id => {
  if (!idPattern.test(id)) throw new Error('Invalid project ID.');
  return path.join(dataDir, 'projects', id);
};
export async function initializeStorage() {
  await Promise.all(['projects', 'jobs', 'uploads'].map(name => fs.mkdir(path.join(dataDir, name), { recursive: true })));
}
const writes = new Map();
export function writeJson(file, object) {
  const task = async () => { const temporary = file + '.tmp'; await fs.writeFile(temporary, JSON.stringify(object, null, 2)); await fs.rename(temporary, file); };
  const pending = (writes.get(file) || Promise.resolve()).catch(() => {}).then(task);
  writes.set(file, pending);
  pending.finally(() => { if (writes.get(file) === pending) writes.delete(file); }).catch(() => {});
  return pending;
}
export const saveProject = p => writeJson(path.join(projectDir(p.id), 'project.json'), p);
export async function getProject(id) {
  try { return JSON.parse(await fs.readFile(path.join(projectDir(id), 'project.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') { error.status = 404; error.message = 'Project not found.'; } throw error; }
}
export async function listProjects() {
  const ids = await fs.readdir(path.join(dataDir, 'projects'));
  const projects = await Promise.all(ids.filter(id => idPattern.test(id)).map(id => getProject(id).catch(() => null)));
  return projects.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
