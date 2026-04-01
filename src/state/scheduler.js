import fs from 'fs';
import path from 'path';
import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'scheduler';
const MEDIA_DIR = path.resolve(process.cwd(), 'storage', 'scheduler_media');
const DEFAULT_STATE = { jobs: [], lastId: 0 };
const handlers = new Map();
let intervalHandle = null;
let boundBot = null;
let ticking = false;
let startRefs = 0;

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

function readSchedulerState() {
  const state = getStorageSection(STORAGE_KEY, DEFAULT_STATE);
  const jobs = Array.isArray(state.jobs) ? state.jobs : [];
  const derivedLastId = jobs
    .map((job) => Number(job.id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .reduce((max, id) => Math.max(max, id), 0);
  const lastId = Math.max(Number(state.lastId) || 0, derivedLastId);
  return { jobs, lastId };
}

function writeSchedulerState(state) {
  setStorageSection(STORAGE_KEY, {
    jobs: Array.isArray(state.jobs) ? state.jobs : [],
    lastId: Number(state.lastId) || 0
  });
}

function nextJobId(state) {
  const nextId = (Number(state.lastId) || 0) + 1;
  state.lastId = nextId;
  return nextId;
}

function nextMediaToken() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function matchesJobId(jobId, expectedId) {
  return String(jobId) === String(expectedId);
}

function parseAbsoluteTime(input) {
  const normalized = String(input).trim();
  if (!normalized) return null;
  const matchLocal = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i);
  if (matchLocal) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = matchLocal;
    const local = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0
    );
    return Number.isNaN(local.getTime()) ? null : local.getTime();
  }

  const matchIso = normalized.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/);
  if (matchIso) {
    const direct = new Date(normalized);
    return Number.isNaN(direct.getTime()) ? null : direct.getTime();
  }

  return null;
}

export function parseTimeSpec(input) {
  const normalized = String(input).trim().toLowerCase();
  if (!normalized) return null;

  const relative = normalized.match(/^(\d+)(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    let multiplier = 60000;
    if (unit.startsWith('h')) multiplier = 60 * 60000;
    if (unit.startsWith('d')) multiplier = 24 * 60 * 60000;
    return Date.now() + (amount * multiplier);
  }

  return parseAbsoluteTime(input);
}

export function formatScheduledTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? 'invalid time'
    : date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
}

export function createSchedulerMediaFile(extension = 'bin') {
  ensureMediaDir();
  const safeExtension = String(extension).replace(/[^a-z0-9]/gi, '') || 'bin';
  return path.join(MEDIA_DIR, `${nextMediaToken()}.${safeExtension}`);
}

export function writeSchedulerMedia(buffer, extension = 'bin') {
  const filePath = createSchedulerMediaFile(extension);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function cleanupSchedulerMedia(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function registerJobHandler(type, handler) {
  handlers.set(type, handler);
  return () => handlers.delete(type);
}

export function addJob(job) {
  const state = readSchedulerState();
  const next = {
    id: nextJobId(state),
    createdAt: Date.now(),
    status: 'pending',
    ...job
  };
  state.jobs.push(next);
  writeSchedulerState(state);
  return next;
}

export function removeJob(jobId) {
  const state = readSchedulerState();
  const job = state.jobs.find((entry) => matchesJobId(entry.id, jobId)) || null;
  if (!job) return null;
  state.jobs = state.jobs.filter((entry) => !matchesJobId(entry.id, jobId));
  writeSchedulerState(state);
  return job;
}

export function updateJob(jobId, patch) {
  const state = readSchedulerState();
  const index = state.jobs.findIndex((entry) => matchesJobId(entry.id, jobId));
  if (index === -1) return null;
  state.jobs[index] = { ...state.jobs[index], ...patch };
  writeSchedulerState(state);
  return state.jobs[index];
}

export function getJobs(filter = null) {
  const jobs = readSchedulerState().jobs;
  if (typeof filter !== 'function') return jobs;
  return jobs.filter(filter);
}

async function tick() {
  if (ticking || !boundBot) return;
  ticking = true;
  try {
    const state = readSchedulerState();
    const now = Date.now();
    let changed = false;

    for (const job of state.jobs) {
      if (job.status !== 'pending' || Number(job.runAt) > now) continue;
      const handler = handlers.get(job.type);
      if (!handler) continue;

      job.status = 'running';
      changed = true;
      writeSchedulerState(state);

      try {
        await handler({ bot: boundBot, job });
        job.status = 'done';
        job.finishedAt = Date.now();
      } catch (error) {
        job.status = 'failed';
        job.finishedAt = Date.now();
        job.error = error?.message || 'Unknown scheduler error';
      }
      changed = true;
      writeSchedulerState(state);
    }

    if (changed) {
      state.jobs = state.jobs.filter((job) => job.status === 'pending');
      writeSchedulerState(state);
    }
  } finally {
    ticking = false;
  }
}

export function startScheduler(bot, intervalMs = 15000) {
  boundBot = bot;
  startRefs += 1;
  if (!intervalHandle) {
    intervalHandle = setInterval(() => {
      tick().catch(() => {});
    }, intervalMs);
  }
}

export function stopScheduler() {
  startRefs = Math.max(0, startRefs - 1);
  if (startRefs === 0 && intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
