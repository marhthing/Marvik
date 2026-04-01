import { getStorageSection, patchStorageSection } from '../utils/storageStore.js';
import { normalizeDestinationConfig, normalizeDestinationJid, normalizeJidList } from '../utils/destinationRouter.js';

const ANTIDELETE_DEFAULT = { dest: 'owner', jid: null };
const STATUS_ANTIDELETE_DEFAULT = {
  dest: 'owner',
  jid: null,
  scope: 'all',
  only: [],
  except: []
};

export function getAntideleteConfig() {
  return getStorageSection('antidelete', ANTIDELETE_DEFAULT);
}

export function setAntideleteConfig(newConfig) {
  return patchStorageSection('antidelete', newConfig, ANTIDELETE_DEFAULT);
}

export function getStatusAntideleteConfig() {
  const config = getStorageSection('statusantidelete', STATUS_ANTIDELETE_DEFAULT);
  const normalized = normalizeDestinationConfig(config, STATUS_ANTIDELETE_DEFAULT, { allowGroup: true });
  return {
    dest: normalized.dest,
    jid: normalized.jid,
    scope: ['all', 'only', 'except'].includes(config.scope) ? config.scope : 'all',
    only: normalizeJidList(config.only),
    except: normalizeJidList(config.except)
  };
}

export function setStatusAntideleteConfig(newConfig) {
  const current = getStatusAntideleteConfig();
  const next = {
    ...current,
    ...newConfig
  };

  next.dest = next.dest === 'custom' ? 'custom' : 'owner';
  next.jid = next.dest === 'custom' ? normalizeDestinationJid(next.jid, { allowGroup: true }) : null;
  next.scope = ['all', 'only', 'except'].includes(next.scope) ? next.scope : 'all';
  next.only = normalizeJidList(next.only);
  next.except = normalizeJidList(next.except);

  if (next.scope !== 'only') next.only = [];
  if (next.scope !== 'except') next.except = [];

  return patchStorageSection('statusantidelete', next, STATUS_ANTIDELETE_DEFAULT);
}
