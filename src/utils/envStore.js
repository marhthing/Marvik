import fs from 'fs';
import path from 'path';

export const ENV_PATH = path.resolve(process.cwd(), '.env');

export function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return '';
  return fs.readFileSync(ENV_PATH, 'utf8');
}

export function parseEnv(content = '') {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

export function readEnvObject() {
  return parseEnv(readEnvFile());
}

export function writeEnvObject(envObject) {
  const lines = Object.entries(envObject).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

export function getEnvValue(key, fallback = '') {
  const env = readEnvObject();
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : fallback;
}

export function setEnvValue(key, value) {
  const env = readEnvObject();
  env[key] = value;
  writeEnvObject(env);
  process.env[key] = value;
  return value;
}

export function removeEnvValue(key) {
  const env = readEnvObject();
  if (!Object.prototype.hasOwnProperty.call(env, key)) return false;
  delete env[key];
  writeEnvObject(env);
  delete process.env[key];
  return true;
}

export function getBooleanEnv(key, fallback = false) {
  const value = getEnvValue(key, fallback ? 'true' : 'false');
  return ['true', 'on', '1'].includes(String(value).toLowerCase());
}

export function setBooleanEnv(key, enabled, trueValue = 'true', falseValue = 'false') {
  return setEnvValue(key, enabled ? trueValue : falseValue);
}
