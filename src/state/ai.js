import fs from 'fs';
import path from 'path';
import { getStorageSection, setStorageSection, readJson } from '../utils/storageStore.js';

const AI_MODE_SECTION = 'aiMode';
const LEGACY_AI_MODE_FILE = path.join(process.cwd(), 'storage', 'ai_mode.json');

function normalizeState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};

  const normalized = {};
  for (const [chatId, value] of Object.entries(state)) {
    normalized[chatId] = {
      active: Boolean(value?.active),
      history: Array.isArray(value?.history)
        ? value.history
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null;
              return {
                role: typeof entry.role === 'string' ? entry.role : 'participant',
                content: typeof entry.content === 'string' ? entry.content : '',
                senderId: typeof entry.senderId === 'string' ? entry.senderId : null,
                senderName: typeof entry.senderName === 'string' ? entry.senderName : null,
                mentionHandle: typeof entry.mentionHandle === 'string' ? entry.mentionHandle : null
              };
            })
            .filter((entry) => entry && entry.content)
        : []
    };
  }
  return normalized;
}

let migrated = false;

function loadLegacyState() {
  const legacy = normalizeState(readJson(LEGACY_AI_MODE_FILE, {}));
  if (Object.keys(legacy).length === 0) return null;
  return legacy;
}

function migrateLegacyStateIfNeeded() {
  if (migrated) return;
  migrated = true;

  const current = normalizeState(getStorageSection(AI_MODE_SECTION, {}));
  if (Object.keys(current).length > 0) {
    if (fs.existsSync(LEGACY_AI_MODE_FILE)) {
      fs.unlinkSync(LEGACY_AI_MODE_FILE);
    }
    return;
  }

  const legacy = loadLegacyState();
  if (!legacy) return;

  setStorageSection(AI_MODE_SECTION, legacy);
  if (fs.existsSync(LEGACY_AI_MODE_FILE)) {
    fs.unlinkSync(LEGACY_AI_MODE_FILE);
  }
}

export function getAiModeState() {
  migrateLegacyStateIfNeeded();
  return normalizeState(getStorageSection(AI_MODE_SECTION, {}));
}

export function saveAiModeState(state) {
  migrateLegacyStateIfNeeded();
  setStorageSection(AI_MODE_SECTION, normalizeState(state));
}

export function patchAiModeChat(chatId, patch = {}) {
  const state = getAiModeState();
  const current = state[chatId] || { active: false, history: [] };
  state[chatId] = {
    active: typeof patch.active === 'boolean' ? patch.active : current.active,
    history: Array.isArray(patch.history) ? patch.history : current.history
  };
  saveAiModeState(state);
  return state[chatId];
}
