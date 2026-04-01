import ai from '../utils/ai.js';
import { reactIfEnabled } from '../utils/pendingActions.js';
import fetch from 'node-fetch';
import { extractMessageText, getQuotedMessageObject } from '../utils/messageUtils.js';
import { getAiModeState, patchAiModeChat } from '../state/ai.js';
import logger from '../utils/logger.js';
import { getDisplayNameForJid } from '../utils/recipientUtils.js';
import { normalizeDigits } from '../utils/whatsappJid.js';

const pluginLogger = logger.child({ component: 'ai' });

// Keywords that indicate user wants to generate an image
const IMAGE_GEN_KEYWORDS = [
  'generate an image', 'create an image', 'make an image', 'draw', 'create a picture',
  'generate a picture', 'make a picture', 'design an image', 'create a design',
  'generate image', 'create image', 'make image', 'generate picture', 'create picture'
];

function getSpeakerName(ctx) {
  const directName = String(ctx.senderName || '').trim();
  if (directName) return directName;

  const senderId = String(ctx.senderId || '').trim();
  return senderId ? senderId.split('@')[0] : 'Unknown';
}

function getMentionHandle(jid) {
  const digits = normalizeDigits(jid || '');
  return digits ? `@${digits}` : null;
}

function getQuotedSpeaker(ctx) {
  const quotedSenderId = ctx.quoted?.senderId || null;
  if (!quotedSenderId) return null;

  const resolvedName = getDisplayNameForJid(quotedSenderId);
  const fallbackName = quotedSenderId.split('@')[0];
  return {
    senderId: quotedSenderId,
    senderName: resolvedName || fallbackName,
    mentionHandle: getMentionHandle(quotedSenderId),
    text: String(ctx.quoted?.text || '').trim()
  };
}

function buildParticipantContent(ctx, content) {
  const baseContent = String(content || '').trim();
  const quotedSpeaker = getQuotedSpeaker(ctx);
  if (!quotedSpeaker || !quotedSpeaker.text) return baseContent;

  return `[Replying to ${quotedSpeaker.senderName}${quotedSpeaker.mentionHandle ? ` ${quotedSpeaker.mentionHandle}` : ''}: "${quotedSpeaker.text}"] ${baseContent}`.trim();
}

function createParticipantEntry(ctx, content) {
  return {
    role: 'participant',
    senderId: ctx.senderId || null,
    senderName: getSpeakerName(ctx),
    mentionHandle: getMentionHandle(ctx.senderId),
    content: buildParticipantContent(ctx, content)
  };
}

function createAssistantEntry(content) {
  return {
    role: 'assistant',
    senderId: null,
    senderName: 'AI',
    mentionHandle: null,
    content: String(content || '').trim()
  };
}

function formatHistoryEntry(entry) {
  if (!entry?.content) return null;

  if (entry.role === 'assistant' || entry.role === 'ai') {
    return `AI: ${entry.content}`;
  }

  const speakerName = entry.senderName || entry.senderId || 'Unknown';
  const speakerId = entry.senderId ? ` (${entry.senderId})` : '';
  return `${speakerName}${speakerId}: ${entry.content}`;
}

function buildConversationTranscript(history, limit = 20) {
  return history
    .slice(-limit)
    .map(formatHistoryEntry)
    .filter(Boolean)
    .join('\n');
}

function buildParticipantsSummary(history) {
  const participants = new Map();

  for (const entry of history) {
    if (entry?.role !== 'participant' || !entry?.senderId) continue;
    if (!participants.has(entry.senderId)) {
      participants.set(entry.senderId, {
        senderName: entry.senderName || entry.senderId.split('@')[0],
        mentionHandle: entry.mentionHandle || getMentionHandle(entry.senderId)
      });
    }
  }

  return Array.from(participants.entries())
    .map(([senderId, speaker]) => `- ${speaker.senderName}: ${speaker.mentionHandle || senderId} (${senderId})`)
    .join('\n');
}

function buildAiModePrompt(history) {
  const transcript = buildConversationTranscript(history, 20);
  const participants = buildParticipantsSummary(history);
  return [
    'You are participating in an ongoing multi-person chat.',
    'Different messages can come from different people.',
    'Use the speaker names and JIDs to tell them apart.',
    'Reply as a smart third participant in the conversation.',
    'If one person talks about another person, keep the identities correct.',
    'If you want to mention someone, use their exact @handle from the participant list.',
    '',
    participants ? `Participants:\n${participants}\n` : '',
    transcript
  ].join('\n');
}

function buildMentionMap(history) {
  const map = new Map();

  for (const entry of history) {
    if (entry?.role !== 'participant' || !entry?.senderId) continue;
    const handle = entry.mentionHandle || getMentionHandle(entry.senderId);
    if (handle) {
      map.set(handle.toLowerCase(), entry.senderId);
    }
  }

  return map;
}

function extractMentionsFromReply(text, history) {
  const mentionMap = buildMentionMap(history);
  if (!mentionMap.size) return [];

  const mentions = new Set();
  const matches = String(text || '').match(/@\d{5,20}/g) || [];
  for (const handle of matches) {
    const senderId = mentionMap.get(handle.toLowerCase());
    if (senderId) mentions.add(senderId);
  }

  return Array.from(mentions);
}

async function replyWithAiText(ctx, history, text) {
  const mentions = extractMentionsFromReply(text, history);
  await ctx.reply(text, mentions.length ? { mentions } : {});
}
export default {
  name: 'ai',
  description: 'AI-powered assistant using Groq',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'ai',
      aliases: ['gpt', 'chat'],
      description: 'Ask the AI anything',
      usage: '.ai <your question>',
      category: 'ai',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 5,
      async execute(ctx) {
        try {
          let question = ctx.args.join(' ');
          let quotedMsg = getQuotedMessageObject(ctx);
          if (!question) {
            if (quotedMsg) {
              question = extractMessageText(quotedMsg);
            }
          }
          // If both question and quotedMsg, combine for AI context
          if (question && quotedMsg) {
            let quotedText = extractMessageText(quotedMsg);
            question = `User asked: "${question}"
Quoted message: "${quotedText}"`;
          }
          if (!question || !question.trim()) {
            return await ctx.reply('Please ask me something!\n\nUsage: .ai What is the meaning of life?');
          }
          
          await reactIfEnabled(ctx, '🤔');
          
          const response = await ai.askAI(question);
          
          if (response) {
            await ctx.reply(`🤖 *AI Response*\n\n${response}`);
            await reactIfEnabled(ctx, '✅');
          } else {
            await ctx.reply('Sorry, I couldn\'t generate a response. Please try again.');
            await reactIfEnabled(ctx, '❌');
          }
          
        } catch (error) {
          pluginLogger.error({ error }, 'AI command failed');
          
          if (error.message?.includes('GROQ_API_KEY')) {
            await ctx.reply('AI is not configured. Please set up the GROQ_API_KEY.');
          } else {
            await ctx.reply('An error occurred while processing your request. Please try again later.');
          }
          await reactIfEnabled(ctx, '❌');
        }
      }
    },
    {
      name: 'aistatus',
      aliases: ['aicache'],
      description: 'Check AI cache status',
      usage: '.aistatus',
      category: 'ai',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 10,
      async execute(ctx) {
        try {
          const cache = ai.loadCache();
          const content = cache.content || {};
          
          let status = '🤖 *AI Cache Status*\n\n';
          status += `📝 Would You Rather: ${content.wouldYouRather?.items?.length || 0} items\n`;
          status += `❓ Trivia: ${content.trivia?.items?.length || 0} items\n`;
          status += `🤔 Truth: ${content.truth?.items?.length || 0} items\n`;
          status += `😈 Dare: ${content.dare?.items?.length || 0} items\n`;
          status += `🧩 Riddles: ${content.riddles?.items?.length || 0} items\n`;
          
          const lastUpdated = cache.lastUpdated || {};
          if (Object.keys(lastUpdated).length > 0) {
            status += '\n*Last Updated:*\n';
            for (const [type, time] of Object.entries(lastUpdated)) {
              const date = new Date(time).toLocaleString();
              status += `• ${type}: ${date}\n`;
            }
          }
          
          await ctx.reply(status);
          
        } catch (error) {
          pluginLogger.error({ error }, 'AI status command failed');
          await ctx.reply('Error checking AI status.');
        }
      }
    },
    {
      name: 'airefill',
      aliases: ['airefresh'],
      description: 'Refill AI cache with fresh content',
      usage: '.airefill <type>',
      category: 'ai',
      ownerOnly: true,
      adminOnly: false,
      groupOnly: false,
      cooldown: 60,
      async execute(ctx) {
        try {
          const type = ctx.args[0]?.toLowerCase();
          const validTypes = ['wouldyourather', 'trivia', 'truth', 'dare', 'riddles'];
          
          if (!type || !validTypes.includes(type)) {
            return await ctx.reply(`Please specify a type to refill:\n\n• wouldyourather\n• trivia\n• truth\n• dare\n• riddles\n\nUsage: .airefill trivia`);
          }
          
          const typeMap = {
            'wouldyourather': 'wouldYouRather',
            'trivia': 'trivia',
            'truth': 'truth',
            'dare': 'dare',
            'riddles': 'riddles'
          };
          
          await ctx.reply(`🔄 Generating new ${type} content... This may take a moment.`);
          await reactIfEnabled(ctx, '⏳');
          
          const items = await ai.generateBulkContent(typeMap[type], 50);
          
          if (items.length > 0) {
            await ctx.reply(`✅ Generated ${items.length} new ${type} items!`);
            await reactIfEnabled(ctx, '✅');
          } else {
            await ctx.reply(`❌ Failed to generate ${type} content. Check the API key and try again.`);
            await reactIfEnabled(ctx, '❌');
          }
          
        } catch (error) {
          pluginLogger.error({ error }, 'AI refill command failed');
          await ctx.reply('Error refilling cache.');
          await reactIfEnabled(ctx, '❌');
        }
      }
    },
    {
      name: 'aimode',
      description: 'Enable continuous AI chat in this chat',
      usage: '.aimode | .aimode stop | .aimode clear',
      category: 'ai',
      cooldown: 3,
      async execute(ctx) {
        const arg = ctx.args[0]?.toLowerCase();
        const chatId = ctx.chatId;
        let state = getAiModeState();
        
        if (arg === 'stop') {
          if (state[chatId]?.active) {
            patchAiModeChat(chatId, { active: false, history: state[chatId].history || [] });
            await ctx.reply('🛑 AI mode stopped for this chat. Your conversation history is saved.');
          } else {
            await ctx.reply('AI mode is not active in this chat.');
          }
          return;
        }
        
        if (arg === 'clear') {
          if (state[chatId]) {
            patchAiModeChat(chatId, { active: state[chatId].active, history: [] });
            await ctx.reply('🗑️ AI conversation history cleared for this chat.');
          } else {
            await ctx.reply('No AI history to clear in this chat.');
          }
          return;
        }
        
        if (!state[chatId]) {
          patchAiModeChat(chatId, { active: true, history: [] });
          await ctx.reply('🤖 AI mode activated! All your messages will be sent to AI until you send .aimode stop.');
        } else if (!state[chatId].active) {
          patchAiModeChat(chatId, { active: true, history: state[chatId].history || [] });
          const historyCount = state[chatId].history?.length || 0;
          await ctx.reply(`🤖 AI mode activated! Continuing from your previous conversation (${historyCount} messages saved).`);
        } else {
          await ctx.reply('AI mode is already active in this chat. Send .aimode stop to exit.');
        }
      }
    }
  ],
  async onMessage(ctx) {
    if (ctx.text?.startsWith('.')) return;
    const chatId = ctx.chatId;
    let state = getAiModeState();
    if (!state[chatId]?.active) return;
    
    state[chatId].history = state[chatId].history || [];
    const userText = ctx.text || '';
    const lowerText = userText.toLowerCase();
    
    // Check if user sent or quoted an image
    const quotedMsg = ctx.quoted || ctx;
    const mimetype = quotedMsg?.mimetype || quotedMsg?.msg?.mimetype || 
                     quotedMsg?.message?.imageMessage?.mimetype ||
                     ctx.raw?.message?.imageMessage?.mimetype;
    const isImage = mimetype?.includes('image');
    
    // Check if user wants to generate an image
    const wantsImageGen = IMAGE_GEN_KEYWORDS.some(kw => lowerText.includes(kw));
    
    try {
      // CASE 1: User sent/quoted an image - analyze it with vision
      if (isImage && userText) {
        state[chatId].history.push(createParticipantEntry(ctx, `[Sent an image] ${userText}`));
        await reactIfEnabled(ctx, '👁️');
        
        try {
          const buffer = await ctx._adapter.downloadMedia({ raw: quotedMsg.raw || quotedMsg });
          const groq = (await import('groq-sdk')).default;
          const client = new groq({ apiKey: process.env.GROQ_API_KEY });
          const base64Image = buffer.toString('base64');
          
          // Build conversation context for vision
          const recentHistory = buildConversationTranscript(state[chatId].history, 10);
          
          const completion = await client.chat.completions.create({
            messages: [
              {
                role: 'system',
                content: `You are a helpful AI assistant in a continuous multi-person conversation. Keep track of who is speaking by their name and JID.\n\nRecent conversation context:\n${recentHistory}\n\nNow one participant is showing you an image and asking about it.`
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userText || 'What do you see in this image?' },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${mimetype};base64,${base64Image}` }
                  }
                ]
              }
            ],
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            temperature: 0.7,
            max_tokens: 1024
          });
          
          const aiReply = completion.choices[0]?.message?.content || '❌ Could not analyze image.';
          state[chatId].history.push(createAssistantEntry(aiReply));
          patchAiModeChat(chatId, state[chatId]);
          await replyWithAiText(ctx, state[chatId].history, `👁️ ${aiReply}`);
          await reactIfEnabled(ctx, '✅');
        } catch (e) {
          pluginLogger.error({ error: e }, 'Vision failed in aimode');
          await ctx.reply('❌ Failed to analyze the image.');
          await reactIfEnabled(ctx, '❌');
        }
        return;
      }
      
      // CASE 2: User wants to generate an image
      if (wantsImageGen && userText) {
        state[chatId].history.push(createParticipantEntry(ctx, userText));
        await reactIfEnabled(ctx, '🎨');
        
        try {
          // Build conversation context for prompt generation
          const conversationContext = buildConversationTranscript(state[chatId].history, 20);
          
          // Ask AI to generate a perfect image prompt based on conversation
          const promptGeneration = await ai.askAI(
            `Based on this conversation, the user wants to generate an image. Create a detailed, descriptive prompt for an AI image generator. Focus on visual details, style, colors, and composition. Only output the image prompt, nothing else.\n\nConversation:\n${conversationContext}\n\nUser's request: ${userText}\n\nImage prompt:`
          );
          
          const imagePrompt = promptGeneration.trim();
          
          // Generate the image using Pollinations
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Failed to generate image');
          const arrayBuffer = await res.arrayBuffer();
          const imgBuffer = Buffer.from(arrayBuffer);
          
          await ctx._adapter.sendMedia(ctx.chatId, imgBuffer, {
            type: 'image',
            mimetype: 'image/png',
            caption: `🎨 *Generated Image*\n\nPrompt: ${imagePrompt}`
          });
          
          state[chatId].history.push(createAssistantEntry(`[Generated an image with prompt: ${imagePrompt}]`));
          patchAiModeChat(chatId, state[chatId]);
          await reactIfEnabled(ctx, '✅');
        } catch (e) {
          pluginLogger.error({ error: e }, 'Image generation failed in aimode');
          await ctx.reply('❌ Failed to generate the image. Please try again.');
          await reactIfEnabled(ctx, '❌');
        }
        return;
      }
      
      // CASE 3: Normal text conversation
      if (userText) {
        state[chatId].history.push(createParticipantEntry(ctx, userText));
        const conversation = buildAiModePrompt(state[chatId].history);
        
        await reactIfEnabled(ctx, '🤔');
        
        let aiReply = '';
        try {
          aiReply = await ai.askAI(conversation);
        } catch (e) {
          aiReply = '❌ AI error.';
        }
        
        state[chatId].history.push(createAssistantEntry(aiReply));
        patchAiModeChat(chatId, state[chatId]);
        await replyWithAiText(ctx, state[chatId].history, aiReply);
        await reactIfEnabled(ctx, '✅');
      }
    } catch (e) {
      pluginLogger.error({ error: e }, 'AI mode failed');
      await ctx.reply('❌ An error occurred.');
      await reactIfEnabled(ctx, '❌');
    }
  }
};

