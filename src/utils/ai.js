import path from 'path';
import logger from './logger.js';
import { getStorageSection, setStorageSection, readJson } from './storageStore.js';

const STORAGE_DIR = path.join(process.cwd(), 'storage');
const AI_CACHE_PATH = path.join(STORAGE_DIR, 'ai_cache.json');
const AI_CACHE_SECTION = 'aiCache';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TTS_URL = 'https://api.groq.com/openai/v1/audio/speech';
const MODEL = 'llama-3.3-70b-versatile';
const STT_MODEL = 'whisper-large-v3';
const TTS_MODEL = 'canopylabs/orpheus-v1-english';

const rateLimiter = {
  lastRequest: 0,
  minInterval: 2000,
  requestCount: 0,
  resetTime: 0,
  maxRequestsPerMinute: 25
};

const CACHED_CONTENT_TYPES = ['wouldYouRather', 'trivia', 'truth', 'dare', 'riddles'];

function createDefaultCacheState() {
  const content = {};
  for (const type of CACHED_CONTENT_TYPES) {
    content[type] = { items: [], queue: [] };
  }

  return {
    content,
    akinator: { questions: [], guessPatterns: {} },
    lastUpdated: {}
  };
}

function shuffleArray(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePromptString(value) {
  return normalizeWhitespace(value)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(truth|dare|question|prompt)\s*[:\-]\s*/i, '');
}

function normalizeAnswerText(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeWouldYouRatherItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = normalizePromptString(raw.a);
  const b = normalizePromptString(raw.b);
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;
  return { a, b };
}

function sanitizeTriviaItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const question = normalizePromptString(raw.question);
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions
    .map((option) => normalizePromptString(option))
    .filter(Boolean)
    .slice(0, 4);

  const uniqueOptions = [];
  for (const option of options) {
    if (!uniqueOptions.some((entry) => entry.toLowerCase() === option.toLowerCase())) {
      uniqueOptions.push(option);
    }
  }

  if (!question || uniqueOptions.length !== 4) return null;

  let answer = normalizePromptString(raw.answer);
  if (!answer) return null;

  const upper = answer.toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(upper)) {
    answer = uniqueOptions[['A', 'B', 'C', 'D'].indexOf(upper)];
  } else {
    const matched = uniqueOptions.find((option) => option.toLowerCase() === answer.toLowerCase());
    if (!matched) return null;
    answer = matched;
  }

  return { question, options: uniqueOptions, answer };
}

function sanitizeTruthOrDareItem(raw) {
  const value = normalizePromptString(raw);
  if (!value) return null;
  if (value.length < 8 || value.length > 280) return null;
  return value;
}

function sanitizeRiddleItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const riddle = normalizePromptString(raw.riddle);
  const answer = normalizeAnswerText(raw.answer);
  const hint = normalizePromptString(raw.hint);

  if (!riddle || !answer || !hint) return null;
  if (answer.length < 2 || answer.length > 60) return null;

  return { riddle, answer, hint };
}

function sanitizeGeneratedItems(type, items) {
  if (!Array.isArray(items)) return [];

  const sanitizer = {
    wouldYouRather: sanitizeWouldYouRatherItem,
    trivia: sanitizeTriviaItem,
    truth: sanitizeTruthOrDareItem,
    dare: sanitizeTruthOrDareItem,
    riddles: sanitizeRiddleItem
  }[type];

  if (!sanitizer) return [];

  return items.map((item) => sanitizer(item)).filter(Boolean);
}

function getItemFingerprint(type, item) {
  switch (type) {
    case 'wouldYouRather':
      return `${item.a.toLowerCase()}||${item.b.toLowerCase()}`;
    case 'trivia':
      return `${item.question.toLowerCase()}||${item.options.map((option) => option.toLowerCase()).join('|')}||${item.answer.toLowerCase()}`;
    case 'riddles':
      return `${item.riddle.toLowerCase()}||${item.answer}`;
    case 'truth':
    case 'dare':
      return item.toLowerCase();
    default:
      return JSON.stringify(item);
  }
}

function normalizeLegacyCache(legacy) {
  const next = createDefaultCacheState();
  if (!legacy || typeof legacy !== 'object') return next;

  for (const type of CACHED_CONTENT_TYPES) {
    const legacyItems = Array.isArray(legacy[type]) ? sanitizeGeneratedItems(type, legacy[type]) : [];
    next.content[type] = {
      items: dedupeItems(type, legacyItems),
      queue: []
    };
  }

  next.lastUpdated = legacy.lastUpdated && typeof legacy.lastUpdated === 'object' ? legacy.lastUpdated : {};
  return next;
}

function dedupeItems(type, items, existingItems = []) {
  const seen = new Set(existingItems.map((item) => getItemFingerprint(type, item)));
  const unique = [];

  for (const item of items) {
    const key = getItemFingerprint(type, item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function normalizeCacheState(state) {
  const base = createDefaultCacheState();
  if (!state || typeof state !== 'object') return base;

  for (const type of CACHED_CONTENT_TYPES) {
    const current = state.content?.[type] || state[type] || {};
    const items = sanitizeGeneratedItems(type, Array.isArray(current.items) ? current.items : Array.isArray(current) ? current : []);
    const uniqueItems = dedupeItems(type, items);
    const queueSource = Array.isArray(current.queue) ? sanitizeGeneratedItems(type, current.queue) : [];
    const allowedKeys = new Set(uniqueItems.map((item) => getItemFingerprint(type, item)));
    const queue = [];
    const seenQueue = new Set();

    for (const item of queueSource) {
      const key = getItemFingerprint(type, item);
      if (!allowedKeys.has(key) || seenQueue.has(key)) continue;
      seenQueue.add(key);
      queue.push(item);
    }

    base.content[type] = {
      items: uniqueItems,
      queue
    };
  }

  base.lastUpdated = state.lastUpdated && typeof state.lastUpdated === 'object' ? state.lastUpdated : {};
  base.akinator = state.akinator && typeof state.akinator === 'object'
    ? {
        questions: Array.isArray(state.akinator.questions) ? state.akinator.questions : [],
        guessPatterns: state.akinator.guessPatterns && typeof state.akinator.guessPatterns === 'object'
          ? state.akinator.guessPatterns
          : {}
      }
    : base.akinator;

  return base;
}

let aiCacheState = null;
let aiCacheMigrated = false;
const generationInFlight = new Map();
let pendingCacheSave = null;

function persistCache(cache) {
  aiCacheState = normalizeCacheState(cache);
  setStorageSection(AI_CACHE_SECTION, aiCacheState);
  return aiCacheState;
}

function scheduleCacheSave() {
  if (pendingCacheSave) return;
  pendingCacheSave = setTimeout(() => {
    pendingCacheSave = null;
    if (aiCacheState) {
      persistCache(aiCacheState);
    }
  }, 500);
}

function saveCache(cache, options = {}) {
  aiCacheState = normalizeCacheState(cache);
  if (options.immediate === false) {
    scheduleCacheSave();
    return aiCacheState;
  }
  return persistCache(aiCacheState);
}

function migrateLegacyCacheIfNeeded() {
  if (aiCacheMigrated) return;
  aiCacheMigrated = true;

  const current = normalizeCacheState(getStorageSection(AI_CACHE_SECTION, {}));
  const hasCurrentData = CACHED_CONTENT_TYPES.some((type) => current.content[type].items.length > 0);
  if (hasCurrentData) {
    aiCacheState = current;
    return;
  }

  const legacy = normalizeLegacyCache(readJson(AI_CACHE_PATH, {}));
  const hasLegacyData = CACHED_CONTENT_TYPES.some((type) => legacy.content[type].items.length > 0);
  aiCacheState = hasLegacyData ? saveCache(legacy) : current;
}

function loadCache() {
  migrateLegacyCacheIfNeeded();
  if (!aiCacheState) {
    aiCacheState = normalizeCacheState(getStorageSection(AI_CACHE_SECTION, {}));
  }
  return aiCacheState;
}

function ensureQueue(cache, type) {
  const bucket = cache.content[type];
  if (!bucket) return;
  if (bucket.queue.length === 0 && bucket.items.length > 0) {
    bucket.queue = shuffleArray(bucket.items);
  }
}

function getFallbackItem(fallbackArray = []) {
  if (!Array.isArray(fallbackArray) || fallbackArray.length === 0) return null;
  return fallbackArray[Math.floor(Math.random() * fallbackArray.length)];
}

function shouldBackfill(bucket, minItems = 40) {
  return (bucket?.items?.length || 0) < minItems;
}

function triggerBackgroundGeneration(type, count = 50) {
  if (generationInFlight.has(type)) return generationInFlight.get(type);

  const task = generateBulkContent(type, count)
    .catch((error) => {
      logger.error(`Background generation failed for ${type}:`, error);
      return [];
    })
    .finally(() => {
      generationInFlight.delete(type);
    });

  generationInFlight.set(type, task);
  return task;
}

async function checkRateLimit() {
  const now = Date.now();
  
  if (now - rateLimiter.resetTime > 60000) {
    rateLimiter.requestCount = 0;
    rateLimiter.resetTime = now;
  }
  
  if (rateLimiter.requestCount >= rateLimiter.maxRequestsPerMinute) {
    const waitTime = 60000 - (now - rateLimiter.resetTime);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    rateLimiter.requestCount = 0;
    rateLimiter.resetTime = Date.now();
  }
  
  const timeSinceLastRequest = now - rateLimiter.lastRequest;
  if (timeSinceLastRequest < rateLimiter.minInterval) {
    await new Promise(resolve => setTimeout(resolve, rateLimiter.minInterval - timeSinceLastRequest));
  }
  
  rateLimiter.lastRequest = Date.now();
  rateLimiter.requestCount++;
}

async function callGroq(messages, options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }
  
  await checkRateLimit();
  
  const body = {
    model: options.model || MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 2048,
    top_p: options.topP || 1,
    stream: false
  };
  
  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  } catch (error) {
    logger.error('Groq API call failed:', error);
    throw error;
  }
}

async function askAI(question, context = '') {
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful, friendly, and knowledgeable AI assistant. Keep responses concise but informative. Be conversational and engaging.'
    }
  ];
  
  if (context) {
    messages.push({ role: 'system', content: `Context: ${context}` });
  }
  
  messages.push({ role: 'user', content: question });
  
  return await callGroq(messages, { maxTokens: 1024 });
}

async function generateBulkContent(type, count = 50) {
  if (generationInFlight.has(type)) {
    return generationInFlight.get(type);
  }

  const task = generateBulkContentInternal(type, count);
  generationInFlight.set(type, task);

  return task.finally(() => {
    generationInFlight.delete(type);
  });
}

async function generateBulkContentInternal(type, count = 50) {
  const cache = loadCache();
  const prompts = {
    wouldYouRather: `Generate ${count} unique "Would You Rather" questions for a chat game. Make them fun, thought-provoking, and appropriate for all ages. Mix between silly, philosophical, and creative scenarios.

Return as JSON array with objects having "a" and "b" properties for each option.
Example: [{"a": "Be able to fly", "b": "Be invisible"}, ...]`,

    trivia: `Generate ${count} unique trivia questions covering various topics (science, history, geography, entertainment, sports, etc). Mix difficulty levels.

Return as JSON array with objects having "question", "answer" (single word or short phrase, lowercase), and "options" (array of 4 choices including the answer).
Example: [{"question": "What planet is known as the Red Planet?", "answer": "mars", "options": ["Venus", "Mars", "Jupiter", "Saturn"]}, ...]`,

    truth: `Generate ${count} unique "Truth" questions for a Truth or Dare game. Make them fun, revealing but appropriate. Mix between embarrassing, thoughtful, and silly questions.

Return as JSON array of strings.
Example: ["What's your most embarrassing moment?", "Who was your first crush?", ...]`,

    dare: `Generate ${count} unique "Dare" challenges for a Truth or Dare game played in a chat/messaging app. Dares should be doable via phone/chat (like send a message, take a selfie, etc). Keep them fun and appropriate.

Return as JSON array of strings.
Example: ["Send a voice note singing your favorite song", "Send a selfie with a silly face", ...]`,

    riddles: `Generate ${count} unique riddles with answers. Include a mix of classic-style riddles and clever wordplay. Keep them challenging but solvable.

Return as JSON array with objects having "riddle", "answer" (single word, lowercase), and "hint" properties.
Example: [{"riddle": "What has keys but no locks?", "answer": "piano", "hint": "Musical instrument"}, ...]`
  };
  
  if (!prompts[type]) {
    throw new Error(`Unknown content type: ${type}`);
  }
  
  const messages = [
    {
      role: 'system',
      content: 'You are a content generator for a chat bot game. Generate creative, engaging, and appropriate content. Always respond with valid JSON only, no extra text.'
    },
    {
      role: 'user',
      content: prompts[type]
    }
  ];
  
  try {
    const response = await callGroq(messages, { 
      maxTokens: 4096, 
      temperature: 0.9,
      jsonMode: true 
    });
    
    const parsed = JSON.parse(response);
    const generatedItems = Array.isArray(parsed) ? parsed : (parsed.items || parsed.questions || parsed.data || []);
    const sanitized = sanitizeGeneratedItems(type, generatedItems);
    const uniqueNewItems = dedupeItems(type, sanitized, cache.content[type].items);

    if (uniqueNewItems.length > 0) {
      cache.content[type].items.push(...uniqueNewItems);
      cache.content[type].queue.push(...shuffleArray(uniqueNewItems));
      cache.lastUpdated[type] = Date.now();
      saveCache(cache, { immediate: true });
      logger.info({ type, generated: generatedItems.length, accepted: uniqueNewItems.length, total: cache.content[type].items.length }, 'Generated AI game content');
    } else {
      logger.warn({ type, generated: generatedItems.length, accepted: 0 }, 'AI generation returned no usable new game items');
    }
    
    return uniqueNewItems;
  } catch (error) {
    logger.error(`Failed to generate ${type} content:`, error);
    return [];
  }
}

function getCachedItem(type, fallbackArray = []) {
  const cache = loadCache();
  ensureQueue(cache, type);
  const bucket = cache.content[type];

  if (bucket?.queue?.length > 0) {
    const item = bucket.queue.shift();
    saveCache(cache, { immediate: false });
    
    if (shouldBackfill(bucket)) {
      triggerBackgroundGeneration(type, 50);
    }
    
    return item;
  }
  
  triggerBackgroundGeneration(type, 50);
  
  return getFallbackItem(fallbackArray);
}

async function getOrFetchItem(type, fallbackArray = []) {
  const cache = loadCache();
  ensureQueue(cache, type);
  let bucket = cache.content[type];

  if (!bucket || bucket.queue.length === 0) {
    try {
      await generateBulkContent(type, 50);
    } catch (err) {
      logger.error(`Failed to fetch ${type}:`, err);
    }
  }

  const updatedCache = loadCache();
  ensureQueue(updatedCache, type);
  bucket = updatedCache.content[type];

  if (bucket?.queue?.length > 0) {
    const item = bucket.queue.shift();
    saveCache(updatedCache, { immediate: false });

    if (shouldBackfill(bucket)) {
      triggerBackgroundGeneration(type, 50);
    }
    
    return item;
  }

  return getFallbackItem(fallbackArray);
}

function getCacheCount(type) {
  const cache = loadCache();
  return cache.content[type]?.items?.length || 0;
}

async function ensureCacheHasItems(type, minCount = 10, generateCount = 50) {
  const count = getCacheCount(type);
  if (count < minCount) {
    await generateBulkContent(type, generateCount);
  }
}

async function analyzeAkinatorAnswers(answers, questionHistory) {
  const messages = [
    {
      role: 'system',
      content: `You are playing a 20 questions guessing game. Based on the yes/no answers to questions, you need to make an intelligent guess about what the person is thinking of.

Analyze the pattern of answers carefully:
- "yes" or "y" = confirms the trait
- "no" or "n" = denies the trait
- "maybe" or "idk" = uncertain

Make a specific, confident guess based on the evidence. Think about what could match ALL the confirmed traits while NOT matching denied traits.`
    },
    {
      role: 'user',
      content: `Here are the questions asked and answers received:

${questionHistory.map((q, i) => `Q${i+1}: ${q.question}\nA: ${q.answer}`).join('\n\n')}

Based on these ${answers.length} answers, what is your best guess? Give just the guess, be specific (e.g., "a golden retriever" not just "a dog", "Taylor Swift" not just "a singer").`
    }
  ];
  
  try {
    const response = await callGroq(messages, { maxTokens: 100, temperature: 0.3 });
    return response.trim();
  } catch (error) {
    logger.error('Akinator analysis failed:', error);
    return null;
  }
}

async function generateAkinatorQuestion(questionHistory, answers) {
  const messages = [
    {
      role: 'system',
      content: `You are playing 20 questions. Generate smart, strategic yes/no questions to narrow down what the person is thinking of.

Good questions:
- Start broad (Is it alive? Is it a person? Is it bigger than a car?)
- Get more specific based on previous answers
- Avoid redundant questions
- Target distinguishing features

Previous questions asked: ${questionHistory.map(q => q.question).join('; ') || 'None yet'}`
    },
    {
      role: 'user',
      content: `Based on the answers so far, generate the next strategic yes/no question to ask. Previous answers: ${answers.join(', ') || 'None yet'}. Just give the question, nothing else.`
    }
  ];
  
  try {
    const response = await callGroq(messages, { maxTokens: 100, temperature: 0.7 });
    return response.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    logger.error('Akinator question generation failed:', error);
    return null;
  }
}

async function speechToText(audioBuffer, fileName) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  await checkRateLimit();

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
  formData.append('file', blob, fileName || 'audio.mp3');
  formData.append('model', STT_MODEL);

  try {
    const response = await fetch(GROQ_STT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq STT error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.text || '';
  } catch (error) {
    logger.error('Groq STT failed:', error);
    throw error;
  }
}

async function textToSpeech(text, voice = 'hannah') {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  await checkRateLimit();

  try {
    const response = await fetch(GROQ_TTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: text,
        voice: voice,
        response_format: 'wav'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq TTS error: ${response.status} - ${errorText}`);
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    logger.error('Groq TTS failed:', error);
    throw error;
  }
}

export default {
  askAI,
  callGroq,
  generateBulkContent,
  getCachedItem,
  getOrFetchItem,
  getCacheCount,
  ensureCacheHasItems,
  analyzeAkinatorAnswers,
  generateAkinatorQuestion,
  speechToText,
  textToSpeech,
  loadCache,
  saveCache
};

export {
  askAI,
  callGroq,
  generateBulkContent,
  getCachedItem,
  getOrFetchItem,
  getCacheCount,
  ensureCacheHasItems,
  analyzeAkinatorAnswers,
  generateAkinatorQuestion,
  speechToText,
  textToSpeech
};
