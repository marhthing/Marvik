import fs from 'fs';
import {
  addJob,
  cleanupSchedulerMedia,
  formatScheduledTime,
  getJobs,
  parseTimeSpec,
  registerJobHandler,
  removeJob,
  startScheduler,
  stopScheduler,
  writeSchedulerMedia
} from '../utils/scheduler.js';
import {
  findParticipant,
  getParticipantPhone,
  normalizeWhatsAppJid,
  resolveParticipantFromContext
} from '../utils/whatsappJid.js';
import { getStatusRecipients } from '../utils/recipientUtils.js';

function formatJobLine(job) {
  return `- ${job.id} | ${job.type} | ${formatScheduledTime(job.runAt)}`;
}

function parseTimeInput(args, startIndex = 0) {
  const single = args[startIndex];
  const next = args[startIndex + 1];
  const looksLikeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(single || ''));
  const looksLikeTime = /^\d{1,2}:\d{2}$/.test(String(next || ''));
  if (looksLikeDate && looksLikeTime) {
    const combinedPreferred = `${single} ${next}`.trim();
    const combinedPreferredRunAt = parseTimeSpec(combinedPreferred);
    if (combinedPreferredRunAt) {
      return { runAt: combinedPreferredRunAt, consumed: 2 };
    }
  }

  const singleRunAt = parseTimeSpec(single);
  if (singleRunAt) {
    return { runAt: singleRunAt, consumed: 1 };
  }

  const combined = [single, next].filter(Boolean).join(' ').trim();
  const combinedRunAt = parseTimeSpec(combined);
  if (combinedRunAt) {
    return { runAt: combinedRunAt, consumed: 2 };
  }

  return { runAt: null, consumed: 0 };
}

function parseTargetList(input = '') {
  return String(input)
    .split(',')
    .map((entry) => normalizeWhatsAppJid(entry.trim()) || entry.trim())
    .filter((jid) => typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us') || jid.endsWith('@lid')));
}

function tokenizeArgs(text = '') {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text))) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function splitScheduleMessageArgs(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const timeInfo = parseTimeInput(args, index);
    if (!timeInfo.runAt) continue;

    const targetIndex = index + timeInfo.consumed;
    const targetArg = args[targetIndex];
    if (!targetArg) continue;

    const targets = parseTargetList(targetArg);
    if (!targets.length) continue;

    return {
      runAt: timeInfo.runAt,
      timeIndex: index,
      timeConsumed: timeInfo.consumed,
      targets
    };
  }

  return null;
}

async function sendScheduledStatus(whatsapp, payload) {
  const recipients = getStatusRecipients({
    adapter: whatsapp,
    audience: payload.recipients || payload.audience
  });
  if (!recipients.length) {
    throw new Error('No known WhatsApp recipients available for status posting yet');
  }

  const message = {};
  if (payload.kind === 'text') {
    message.text = payload.text;
  } else if (payload.kind === 'image') {
    message.image = fs.readFileSync(payload.mediaPath);
    if (payload.caption) message.caption = payload.caption;
  } else if (payload.kind === 'video') {
    message.video = fs.readFileSync(payload.mediaPath);
    if (payload.caption) message.caption = payload.caption;
    if (payload.mimetype) message.mimetype = payload.mimetype;
  } else {
    throw new Error('Unsupported scheduled status type');
  }

  await whatsapp.client.sendMessage('status@broadcast', message, {
    broadcast: true,
    statusJidList: recipients
  });
}

async function reAddTempKick(whatsapp, job) {
  const candidates = [...new Set([
    job.payload.userJid,
    job.payload.phoneJid
  ].filter(Boolean))];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      await whatsapp.client.groupParticipantsUpdate(job.payload.groupJid, [candidate], 'add');
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to re-add user after tempkick');
}

export default {
  name: 'scheduler',
  description: 'Scheduled messages, status posting, and temporary kicks',
  async onLoad(bot) {
    startScheduler(bot);

    const unregisterMessage = registerJobHandler('scheduled-message', async ({ bot: runtimeBot, job }) => {
      const whatsapp = runtimeBot.getAdapter('whatsapp');
      if (!whatsapp) throw new Error('WhatsApp adapter unavailable');
      await whatsapp.sendMessage(job.payload.chatId, job.payload.text);
    });

    const unregisterStatus = registerJobHandler('scheduled-status', async ({ bot: runtimeBot, job }) => {
      const whatsapp = runtimeBot.getAdapter('whatsapp');
      if (!whatsapp) throw new Error('WhatsApp adapter unavailable');
      await sendScheduledStatus(whatsapp, job.payload);
      cleanupSchedulerMedia(job.payload.mediaPath);
    });

    const unregisterTempKick = registerJobHandler('tempkick-readd', async ({ bot: runtimeBot, job }) => {
      const whatsapp = runtimeBot.getAdapter('whatsapp');
      if (!whatsapp) throw new Error('WhatsApp adapter unavailable');
      await reAddTempKick(whatsapp, job);
    });

    return () => {
      unregisterMessage();
      unregisterStatus();
      unregisterTempKick();
      stopScheduler();
    };
  },
  commands: [
    {
      name: 'schedulemsg',
      aliases: ['msgschedule'],
      description: 'Schedule a message to be sent later',
      usage: '.schedulemsg <message> <10m|YYYY-MM-DD HH:mm> <jid>,<jid> or reply with .schedulemsg <time> <jid>,<jid>',
      category: 'owner',
      ownerOnly: true,
      cooldown: 2,
      async execute(ctx) {
        const now = Date.now();
        const rawText = typeof ctx.text === 'string' ? ctx.text.trim() : '';
        const prefix = ctx.bot?.config?.prefix || ctx.platformAdapter?.config?.prefix || '';
        let rest = rawText;
        if (prefix && rest.startsWith(prefix)) {
          rest = rest.slice(prefix.length).trim();
        }
        if (rest.toLowerCase().startsWith(ctx.command)) {
          rest = rest.slice(ctx.command.length).trim();
        }
        const parsedArgs = rest ? tokenizeArgs(rest) : ctx.args;

        if (parsedArgs.length < 2 && !ctx.quoted?.text) {
          await ctx.reply('Usage: .schedulemsg <message> <10m|YYYY-MM-DD HH:mm> <jid>,<jid> or reply with .schedulemsg <time> <jid>,<jid>');
          return;
        }

        let parsed = splitScheduleMessageArgs(parsedArgs);
        if (!parsed) {
          for (let index = 0; index < parsedArgs.length; index += 1) {
            const timeInfo = parseTimeInput(parsedArgs, index);
            if (!timeInfo.runAt) continue;
            const targetIndex = index + timeInfo.consumed;
            const targetArg = parsedArgs[targetIndex];
            if (!targetArg) continue;
            const targets = parseTargetList(targetArg);
            if (!targets.length) continue;
            parsed = {
              runAt: timeInfo.runAt,
              timeIndex: index,
              timeConsumed: timeInfo.consumed,
              targets
            };
            break;
          }
        }
        if (!parsed) {
          const timeInfo = parseTimeInput(parsedArgs, 0);
          if (timeInfo.runAt && ctx.quoted?.senderId) {
            parsed = {
              runAt: timeInfo.runAt,
              timeIndex: 0,
              timeConsumed: timeInfo.consumed,
              targets: [normalizeWhatsAppJid(ctx.quoted.senderId)].filter(Boolean)
            };
          }
        }
        if (!parsed) {
          await ctx.reply('Invalid time. Use formats like `10m`, `2h`, or `2025-12-31 18:30`.');
          return;
        }
        if (parsed.runAt <= now) {
          await ctx.reply('Scheduled time is in the past. Use a future time like `10m` or `2025-12-31 18:30`.');
          return;
        }

        const hasQuotedSource = Boolean(ctx.quoted?.text);
        const finalText = hasQuotedSource
          ? ctx.quoted.text.trim()
          : parsedArgs.slice(0, parsed.timeIndex).join(' ').trim();

        if (!finalText) {
          await ctx.reply('Please provide message text before the time, or reply to a text message.');
          return;
        }

        const createdJobs = parsed.targets.map((chatId) => addJob({
          type: 'scheduled-message',
          runAt: parsed.runAt,
          payload: {
            chatId,
            text: finalText
          },
          createdBy: ctx.senderId
        }));

        await ctx.reply(
          `Scheduled ${createdJobs.length} message job(s).\nIDs: ${createdJobs.map((job) => job.id).join(', ')}\nWhen: ${formatScheduledTime(parsed.runAt)}\nTargets: ${parsed.targets.join(', ')}`
        );
      }
    },
    {
      name: 'schedulestatus',
      aliases: ['statusschedule'],
      description: 'Schedule a WhatsApp status post',
      usage: '.schedulestatus <10m|YYYY-MM-DD HH:mm> <text> or reply/send media with .schedulestatus <time> [caption]',
      category: 'owner',
      ownerOnly: true,
      cooldown: 2,
      async execute(ctx) {
        const now = Date.now();
        const rawText = typeof ctx.text === 'string' ? ctx.text.trim() : '';
        const prefix = ctx.bot?.config?.prefix || ctx.platformAdapter?.config?.prefix || '';
        let rest = rawText;
        if (prefix && rest.startsWith(prefix)) {
          rest = rest.slice(prefix.length).trim();
        }
        if (rest.toLowerCase().startsWith(ctx.command)) {
          rest = rest.slice(ctx.command.length).trim();
        }
        const parsedArgs = rest ? tokenizeArgs(rest) : ctx.args;

        if (!parsedArgs[0]) {
          await ctx.reply('Usage: .schedulestatus <10m|YYYY-MM-DD HH:mm> <text>');
          return;
        }

        let timeInfo = null;
        let timeIndex = -1;
        for (let index = 0; index < parsedArgs.length; index += 1) {
          const candidate = parseTimeInput(parsedArgs, index);
          if (candidate?.runAt) {
            timeInfo = candidate;
            timeIndex = index;
            break;
          }
        }
        const runAt = timeInfo?.runAt || null;
        if (!runAt || runAt <= now) {
          await ctx.reply('Invalid time. Use formats like `10m`, `2h`, or `2025-12-31 18:30`.');
          return;
        }

        let payload;
        const captionStart = Math.max(timeIndex + (timeInfo?.consumed || 0), 1);
        const captionAfterTime = parsedArgs.slice(captionStart).join(' ').trim();
        const messageBeforeTime = parsedArgs.slice(0, timeIndex).join(' ').trim();
        let caption = captionAfterTime || messageBeforeTime;
        const sourceMedia = ctx.media || ctx.quoted?.media;

        if (sourceMedia) {
          if (!caption) {
            const quotedMsg = ctx.quoted?.message;
            const quotedCaption = quotedMsg?.imageMessage?.caption ||
              quotedMsg?.videoMessage?.caption ||
              quotedMsg?.documentMessage?.caption ||
              '';
            caption = sourceMedia.caption || quotedCaption || '';
          }
          const buffer = ctx.media
            ? await ctx.downloadMedia()
            : await ctx.platformAdapter.downloadMedia(sourceMedia);
          const extension = sourceMedia.mimetype?.split('/')[1] || (sourceMedia.type === 'video' ? 'mp4' : 'jpg');
          const mediaPath = writeSchedulerMedia(buffer, extension);
          payload = {
            kind: sourceMedia.type === 'video' ? 'video' : 'image',
            mediaPath,
            caption,
            mimetype: sourceMedia.mimetype || null
          };
        } else {
          const text = caption.trim();
          if (!text) {
            await ctx.reply('Please provide status text, or reply/send media with the command.');
            return;
          }
          payload = {
            kind: 'text',
            text
          };
        }

        const job = addJob({
          type: 'scheduled-status',
          runAt,
          payload,
          createdBy: ctx.senderId
        });

        await ctx.reply(`Scheduled status created.\nID: ${job.id}\nWhen: ${formatScheduledTime(runAt)}`);
      }
    },
    {
      name: 'listschedules',
      aliases: ['schedulelist'],
      description: 'List scheduled message and status jobs',
      usage: '.listschedules',
      category: 'owner',
      ownerOnly: true,
      cooldown: 2,
      async execute(ctx) {
        const jobs = getJobs((job) => job.type === 'scheduled-message' || job.type === 'scheduled-status');
        if (!jobs.length) {
          await ctx.reply('No scheduled messages or statuses found.');
          return;
        }

        await ctx.reply(`Scheduled jobs:\n${jobs.map(formatJobLine).join('\n')}`);
      }
    },
    {
      name: 'cancelschedule',
      aliases: ['delschedule'],
      description: 'Cancel a scheduled message or status job',
      usage: '.cancelschedule <jobId>',
      category: 'owner',
      ownerOnly: true,
      cooldown: 2,
      async execute(ctx) {
        const jobId = ctx.args[0];
        if (!jobId) {
          await ctx.reply('Usage: .cancelschedule <jobId>');
          return;
        }

        const job = removeJob(jobId);
        if (!job) {
          await ctx.reply('Schedule not found.');
          return;
        }

        if (job.type === 'scheduled-status') {
          cleanupSchedulerMedia(job.payload?.mediaPath);
        }

        await ctx.reply(`Cancelled schedule ${jobId}.`);
      }
    },
    {
      name: 'tempkick',
      aliases: ['tempban'],
      description: 'Kick a user now and re-add them later',
      usage: '.tempkick @user <10m|2h|1d>',
      category: 'group',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 3,
      async execute(ctx) {
        if (!ctx.args[1] && !(ctx.quoted || ctx.mentions?.length)) {
          await ctx.reply('Usage: .tempkick @user <10m|2h|1d>');
          return;
        }

        const runAt = parseTimeSpec(ctx.args[1] || ctx.args[0]);
        if (!runAt || runAt <= Date.now()) {
          await ctx.reply('Invalid duration. Use values like `10m`, `2h`, or `1d`.');
          return;
        }

        const metadata = await ctx.platformAdapter.client.groupMetadata(ctx.chatId);
        const botId = ctx.platformAdapter.client.user?.id || ctx.platformAdapter.client.user?.jid;
        const botLid = ctx.platformAdapter.client.user?.lid;
        const botParticipant = findParticipant(metadata.participants, botId, botLid);
        if (!botParticipant?.admin) {
          await ctx.reply('I need to be an admin to use tempkick.');
          return;
        }

        const target = await resolveParticipantFromContext(ctx, metadata);
        if (!target) {
          await ctx.reply('User not found. Mention, reply, or pass the phone number.');
          return;
        }
        if (target.admin === 'superadmin') {
          await ctx.reply('Cannot tempkick the group creator.');
          return;
        }

        const phoneJid = normalizeWhatsAppJid(getParticipantPhone(target));
        await ctx.platformAdapter.client.groupParticipantsUpdate(ctx.chatId, [target.id], 'remove');
        const job = addJob({
          type: 'tempkick-readd',
          runAt,
          payload: {
            groupJid: ctx.chatId,
            userJid: target.id,
            phoneJid
          },
          createdBy: ctx.senderId
        });

        await ctx.reply(`User removed and queued for re-add.\nID: ${job.id}\nWhen: ${formatScheduledTime(runAt)}`);
      }
    },
    {
      name: 'listtempkicks',
      aliases: ['tempkicklist'],
      description: 'List pending tempkick re-add jobs',
      usage: '.listtempkicks',
      category: 'group',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 2,
      async execute(ctx) {
        const jobs = getJobs((job) => job.type === 'tempkick-readd' && job.payload?.groupJid === ctx.chatId);
        if (!jobs.length) {
          await ctx.reply('No pending tempkicks in this group.');
          return;
        }

        await ctx.reply(`Pending tempkicks:\n${jobs.map((job) => `- ${job.id} | ${job.payload.userJid} | ${formatScheduledTime(job.runAt)}`).join('\n')}`);
      }
    },
    {
      name: 'canceltempkick',
      aliases: ['deltempkick'],
      description: 'Cancel a pending tempkick re-add job',
      usage: '.canceltempkick <jobId>',
      category: 'group',
      ownerOnly: false,
      adminOnly: true,
      groupOnly: true,
      cooldown: 2,
      async execute(ctx) {
        const jobId = ctx.args[0];
        if (!jobId) {
          await ctx.reply('Usage: .canceltempkick <jobId>');
          return;
        }

        const jobs = getJobs((entry) => String(entry.id) === String(jobId) && entry.type === 'tempkick-readd' && entry.payload?.groupJid === ctx.chatId);
        if (!jobs.length) {
          await ctx.reply('Tempkick job not found.');
          return;
        }
        removeJob(jobId);

        await ctx.reply(`Cancelled tempkick ${jobId}.`);
      }
    }
  ]
};
