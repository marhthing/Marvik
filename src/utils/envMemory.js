// envMemory.js
import { parseEnv, readEnvFile } from './envStore.js';
let envCache = {};

function loadEnv() {
  envCache = parseEnv(readEnvFile());
}

function getEnv(key, fallback = undefined) {
  return envCache[key] !== undefined ? envCache[key] : fallback;
}

function getAllEnv() {
  return { ...envCache };
}

// Initial load
loadEnv();

export default {
  get: getEnv,
  getAll: getAllEnv,
  reload: loadEnv
};
