# Plugin Guide

This file explains how to add new plugins correctly in this bot.

## Where New Code Belongs

Before writing a plugin, decide which layer the logic belongs to.

Use:

- `src/plugins`
  user-facing commands and message hooks
- `src/state`
  persistent domain state
- `src/domains/whatsapp`
  WhatsApp-specific business logic
- `src/utils`
  generic helpers

Rule:

- plugin = behavior surface
- state = saved data
- domain = WhatsApp operations/rules
- utils = generic helpers

## Minimum Plugin Shape

```js
export default {
  name: 'my-plugin',
  description: 'My plugin',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'hello',
      aliases: ['hi'],
      description: 'Say hello',
      usage: '.hello',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 3,
      async execute(ctx) {
        await ctx.reply('Hello');
      }
    }
  ]
};
```

## Optional Hooks

### `onLoad(bot)`

Use for startup registration:

- adapter event listeners
- registry hooks
- one-time migrations

```js
async onLoad(bot) {
  const unregister = bot.getCommandRegistry().registerCommandExecutedHandler(async ({ messageContext, command }) => {
    // track command usage
  });

  return () => unregister();
}
```

### `onUnload(bot)`

Use for cleanup if needed.

### `onMessage(ctx)`

Use for passive behavior on every message:

- AFK notices
- moderation scanning
- auto features
- stats collection

Keep it fast. This runs on the hot path.

## Command Fields

Each command can define:

- `name`
- `aliases`
- `description`
- `usage`
- `category`
- `ownerOnly`
- `adminOnly`
- `groupOnly`
- `cooldown`
- `allowedUsers`
- `allowedGroups`
- `execute(ctx)`

The runtime enforces these flags in `CommandRegistry`.

The command reference at `docs/COMMANDS.md` is generated from this metadata. After adding or changing commands, run:

```bash
npm run docs:commands
```

## Message Context In Plugins

Most plugins only need `ctx`.

Useful fields:

- `ctx.text`
- `ctx.command`
- `ctx.args`
- `ctx.chatId`
- `ctx.senderId`
- `ctx.senderName`
- `ctx.isGroup`
- `ctx.isOwner`
- `ctx.isAdmin`
- `ctx.isFromMe`
- `ctx.media`
- `ctx.quoted`
- `ctx.mentions`
- `ctx.raw`

Useful methods:

- `ctx.reply()`
- `ctx.send()`
- `ctx.react()`
- `ctx.sendMedia()`
- `ctx.downloadMedia()`
- `ctx.presence()`
- `ctx.read()`

## Reactions

Shared reaction helpers live in:

- `src/utils/pendingActions.js`

Use:

```js
import { reactIfEnabled } from '../utils/pendingActions.js';

await reactIfEnabled(ctx, '⏳');
await reactIfEnabled(ctx, '✅');
await reactIfEnabled(ctx, '❌');
```

Do not repeat manual `if (shouldReact()) await ctx.react(...)` patterns.

## Persistent State

Do not do this in a plugin:

- raw file writes for bot state
- direct top-level `storage.json` patching from plugin logic

Do this instead:

1. create `src/state/<domain>.js`
2. normalize data there
3. expose getters/setters
4. let plugin call the state module

Example:

- plugin: `src/plugins/afk.js`
- state: `src/state/afk.js`

## WhatsApp-Specific Logic

If the logic is about how WhatsApp works, it should probably not live in the plugin.

Examples already in the bot:

- `src/domains/whatsapp/groupActions.js`
- `src/domains/whatsapp/groupContext.js`
- `src/domains/whatsapp/channelUtils.js`

Use that layer for:

- group participant operations
- admin/participant resolution
- join request operations
- channel/newsletter operations

## Interactive Flows

For reply-based or multi-step flows, use:

- `src/utils/pendingActions.js`
- `src/utils/gameSessions.js`
- `src/utils/downloadFlow.js`

Do not create ad hoc global maps inside plugins unless there is a very strong reason.

## Example: Good Plugin Split

Goal:
- add a “notes” feature

Recommended layout:

- `src/plugins/notes.js`
  commands like `.note save`, `.note get`
- `src/state/notes.js`
  saved note data
- `src/domains/whatsapp/...`
  only if you need WhatsApp-specific participant/group logic

## Example Skeleton With State

```js
// src/state/notes.js
import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const SECTION = 'notes';

export function getNotes() {
  return getStorageSection(SECTION, { byChat: {} });
}

export function saveNotes(state) {
  return setStorageSection(SECTION, state);
}
```

```js
// src/plugins/notes.js
import { getNotes, saveNotes } from '../state/notes.js';

export default {
  name: 'notes',
  commands: [
    {
      name: 'note',
      async execute(ctx) {
        const state = getNotes();
        // ...
        saveNotes(state);
        await ctx.reply('Saved');
      }
    }
  ]
};
```

## End-To-End Plugin Example

This example shows the full intended flow:

- command surface in `src/plugins`
- saved state in `src/state`
- shared reactions
- proper validation

### State File

```js
// src/state/greeter.js
import { getStorageSection, setStorageSection } from '../utils/storageStore.js';

const SECTION = 'greeter';

export function getGreeterState() {
  return getStorageSection(SECTION, { byChat: {} });
}

export function setGreeting(chatId, text) {
  const state = getGreeterState();
  state.byChat[chatId] = text;
  return setStorageSection(SECTION, state);
}

export function getGreeting(chatId) {
  return getGreeterState().byChat[chatId] || null;
}
```

### Plugin File

```js
// src/plugins/greeter.js
import { reactIfEnabled } from '../utils/pendingActions.js';
import { getGreeting, setGreeting } from '../state/greeter.js';

export default {
  name: 'greeter',
  description: 'Simple per-chat greeting command',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'greetset',
      usage: '.greetset <text>',
      description: 'Set greeting for this chat',
      category: 'utility',
      async execute(ctx) {
        const text = ctx.args.join(' ').trim();
        if (!text) return ctx.reply('Usage: .greetset <text>');

        await reactIfEnabled(ctx, '⏳');
        setGreeting(ctx.chatId, text);
        await reactIfEnabled(ctx, '✅');
        await ctx.reply('Greeting saved.');
      }
    },
    {
      name: 'greet',
      usage: '.greet',
      description: 'Show greeting for this chat',
      category: 'utility',
      async execute(ctx) {
        const greeting = getGreeting(ctx.chatId);
        if (!greeting) return ctx.reply('No greeting set.');
        await ctx.reply(greeting);
      }
    }
  ]
};
```

Why this is correct:

- no plugin-owned JSON file
- no direct raw storage write in plugin
- reactions use shared helper
- plugin stays thin
- state owns persistence

## Hot Reload Rules

Plugin hot reload works when files under `src/plugins/` change.

That means:

- plugin code reloads quickly
- state/domain/utils changes may require full restart if only indirectly referenced

If a plugin depends on startup-only wiring, restart the bot after major internal refactors.

## Good Plugin Checklist

Before adding a plugin, check:

- is the command surface in `src/plugins`?
- is saved state in `src/state`?
- is WhatsApp-specific behavior in `src/domains/whatsapp`?
- are reply flows using pending actions?
- are reactions using shared helpers?
- is logging using `src/utils/logger.js`?
- is the plugin thin enough?

If yes, it probably fits the architecture.
