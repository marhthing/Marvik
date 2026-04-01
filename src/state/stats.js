import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const STORAGE_KEY = 'stats';
const DEFAULT_STATE = {
  chats: {}
};

function getDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCounterMap(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeChatStats(chat = {}) {
  return {
    messagesByDate: normalizeCounterMap(chat.messagesByDate),
    usersByDate: normalizeCounterMap(chat.usersByDate),
    commandsByDate: normalizeCounterMap(chat.commandsByDate),
    updatedAt: Number(chat.updatedAt) || 0
  };
}

function normalizeState(state = {}) {
  const chats = state?.chats && typeof state.chats === 'object' ? state.chats : {};
  const normalizedChats = {};

  for (const [chatId, chatStats] of Object.entries(chats)) {
    if (!chatId || typeof chatId !== 'string') continue;
    normalizedChats[chatId] = normalizeChatStats(chatStats);
  }

  return { chats: normalizedChats };
}

function incrementCounter(map, key, amount = 1) {
  map[key] = (Number(map[key]) || 0) + amount;
}

function ensureNestedCounter(map, key) {
  if (!map[key] || typeof map[key] !== 'object') {
    map[key] = {};
  }
  return map[key];
}

export function getStatsState() {
  return normalizeState(getStorageSection(STORAGE_KEY, DEFAULT_STATE));
}

export function setStatsState(state) {
  return setStorageSection(STORAGE_KEY, normalizeState(state));
}

export function getChatStats(chatId) {
  const state = getStatsState();
  return normalizeChatStats(state.chats[chatId] || {});
}

export function recordChatMessage({ chatId, senderId, timestamp = Date.now() }) {
  if (!chatId || !senderId) return null;

  const state = getStatsState();
  const chatStats = normalizeChatStats(state.chats[chatId] || {});
  const dateKey = getDateKey(timestamp);

  incrementCounter(chatStats.messagesByDate, dateKey, 1);
  const usersForDate = ensureNestedCounter(chatStats.usersByDate, dateKey);
  incrementCounter(usersForDate, senderId, 1);
  chatStats.updatedAt = Date.now();

  state.chats[chatId] = chatStats;
  setStatsState(state);
  return chatStats;
}

export function recordChatCommand({ chatId, commandName, timestamp = Date.now() }) {
  if (!chatId || !commandName) return null;

  const state = getStatsState();
  const chatStats = normalizeChatStats(state.chats[chatId] || {});
  const dateKey = getDateKey(timestamp);

  const commandsForDate = ensureNestedCounter(chatStats.commandsByDate, dateKey);
  incrementCounter(commandsForDate, commandName, 1);
  chatStats.updatedAt = Date.now();

  state.chats[chatId] = chatStats;
  setStatsState(state);
  return chatStats;
}

function sumCountersForDates(map, dates) {
  const totals = {};
  for (const dateKey of dates) {
    const entry = map[dateKey];
    if (!entry || typeof entry !== 'object') continue;
    for (const [key, count] of Object.entries(entry)) {
      totals[key] = (totals[key] || 0) + (Number(count) || 0);
    }
  }
  return totals;
}

function getAllDateKeys(chatStats) {
  return Array.from(new Set([
    ...Object.keys(chatStats.messagesByDate || {}),
    ...Object.keys(chatStats.usersByDate || {}),
    ...Object.keys(chatStats.commandsByDate || {})
  ])).sort();
}

export function getChatStatsSummary(chatId) {
  const chatStats = getChatStats(chatId);
  const dateKeys = getAllDateKeys(chatStats);

  const totalMessages = dateKeys.reduce(
    (sum, dateKey) => sum + (Number(chatStats.messagesByDate[dateKey]) || 0),
    0
  );

  const topUsers = Object.entries(sumCountersForDates(chatStats.usersByDate, dateKeys))
    .sort((a, b) => b[1] - a[1]);

  const topCommands = Object.entries(sumCountersForDates(chatStats.commandsByDate, dateKeys))
    .sort((a, b) => b[1] - a[1]);

  const dailyActivity = dateKeys.map((dateKey) => ({
    date: dateKey,
    messages: Number(chatStats.messagesByDate[dateKey]) || 0
  }));

  return {
    totalMessages,
    topUsers,
    topCommands,
    dailyActivity
  };
}
