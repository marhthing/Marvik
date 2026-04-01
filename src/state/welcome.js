import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'welcome';
const DEFAULT_STATE = {
  enabled: false,
  scope: 'all',
  groups: [],
  welcomeTemplate: 'Welcome @user to {group}.',
  goodbyeTemplate: 'Goodbye @user from {group}.'
};

function normalizeGroupList(groups = []) {
  return Array.from(new Set(
    (Array.isArray(groups) ? groups : [])
      .map((group) => String(group || '').trim())
      .filter((group) => group.endsWith('@g.us'))
  ));
}

function normalizeTemplate(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeState(state = {}) {
  const scope = ['all', 'only', 'except'].includes(state?.scope) ? state.scope : DEFAULT_STATE.scope;
  return {
    enabled: typeof state?.enabled === 'boolean' ? state.enabled : DEFAULT_STATE.enabled,
    scope,
    groups: normalizeGroupList(state?.groups),
    welcomeTemplate: normalizeTemplate(state?.welcomeTemplate, DEFAULT_STATE.welcomeTemplate),
    goodbyeTemplate: normalizeTemplate(state?.goodbyeTemplate, DEFAULT_STATE.goodbyeTemplate)
  };
}

export function getWelcomeState() {
  return normalizeState(getStorageSection(STORAGE_KEY, DEFAULT_STATE));
}

export function setWelcomeState(state) {
  return setStorageSection(STORAGE_KEY, normalizeState(state));
}

export function patchWelcomeState(patch = {}) {
  return setWelcomeState({
    ...getWelcomeState(),
    ...patch
  });
}

export function isWelcomeEnabledForGroup(groupJid) {
  if (!groupJid || !String(groupJid).endsWith('@g.us')) return false;
  const state = getWelcomeState();
  if (!state.enabled) return false;
  if (state.scope === 'all') return true;
  if (state.scope === 'only') return state.groups.includes(groupJid);
  if (state.scope === 'except') return !state.groups.includes(groupJid);
  return false;
}
