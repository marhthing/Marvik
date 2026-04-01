import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const SECTION = 'lifecycle';
const MAX_HISTORY = 50;

function getDefaultState() {
  return {
    history: [],
    pendingAction: null,
    lastStartupAt: null
  };
}

function getState() {
  return getStorageSection(SECTION, getDefaultState());
}

function writeState(nextState) {
  return setStorageSection(SECTION, {
    ...getDefaultState(),
    ...nextState,
    history: Array.isArray(nextState.history) ? nextState.history.slice(-MAX_HISTORY) : []
  });
}

export function recordLifecycleEvent(type, details = {}) {
  const state = getState();
  state.history.push({
    type,
    timestamp: new Date().toISOString(),
    ...details
  });
  return writeState(state);
}

export function setPendingLifecycleAction(action) {
  const state = getState();
  state.pendingAction = {
    ...action,
    requestedAt: action?.requestedAt || new Date().toISOString()
  };
  return writeState(state);
}

export function getPendingLifecycleAction() {
  return getState().pendingAction || null;
}

export function clearPendingLifecycleAction() {
  const state = getState();
  state.pendingAction = null;
  return writeState(state);
}

export function markStartup(details = {}) {
  const state = getState();
  state.lastStartupAt = new Date().toISOString();
  if (details.clearPending !== false) {
    state.pendingAction = null;
  }
  state.history.push({
    type: 'startup',
    timestamp: state.lastStartupAt,
    ...details
  });
  return writeState(state);
}
