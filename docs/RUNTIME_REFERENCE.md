# Runtime Reference

This file documents how the bot actually runs.

## Boot Flow

Process manager:

1. `index.js`
2. starts `src/index.js`
3. restarts child bot process if it exits

App startup:

1. `src/index.js`
2. checks/install dependencies if needed
3. loads config from `src/config/default.js`
4. creates `Bot`
5. sets file watchers
6. starts `Bot`

## Bot Lifecycle

Main class:

- `src/core/Bot.js`

The bot owns:

- `CommandRegistry`
- `PluginLoader`
- `PermissionManager`
- `RateLimiter`
- `MediaHandler`
- platform adapters

Start sequence:

1. create required directories/files
2. initialize WhatsApp
3. wait for platform ready
4. load all plugins
5. notify owner startup

Stop sequence:

1. disconnect adapters
2. flush memory store writes
3. exit

## Bot Events

`Bot` emits:

- `platform:ready`
  emitted when a platform adapter becomes ready
- `message`
  emitted after pending-action and permission/blacklist gates, before command execution

## Adapter Events

Base adapter contract:

- `src/adapters/BaseAdapter.js`

Common emitted events:

- `message`
- `ready`

WhatsApp-specific extra event:

- `raw:messages.update`

That event is currently used by plugins like antidelete to survive lower-level WhatsApp update flows.

## WhatsApp Adapter

Main file:

- `src/adapters/WhatsAppAdapter.js`

What it does:

- connects Baileys
- manages QR/pairing-code login
- parses raw WhatsApp messages into `MessageContext`
- stores incoming messages in memory storage
- handles message edits
- resolves quoted messages
- maps LID/phone-number identities
- exposes send/reaction/media/presence/admin helpers

## Message Parsing

`WhatsAppAdapter.parseMessage()` builds a unified `MessageContext`.

Important parsed fields:

- `platform`
- `messageId`
- `messageKey`
- `chatId`
- `senderId`
- `senderName`
- `text`
- `command`
- `args`
- `mentions`
- `media`
- `quoted`
- `isGroup`
- `isOwner`
- `isAdmin`
- `isFromMe`
- `raw`

## Message Context API

Main file:

- `src/core/MessageContext.js`

Methods available to plugins:

- `await ctx.reply(text, options)`
- `await ctx.send(text, options)`
- `await ctx.react(emoji)`
- `await ctx.delete()`
- `await ctx.edit(text, options)`
- `await ctx.sendMedia(buffer, options)`
- `await ctx.downloadMedia()`
- `await ctx.isGroupAdmin(userId?)`
- `await ctx.presence(type)`
- `await ctx.read()`

Adapter access:

- `ctx.platformAdapter`
- `ctx._adapter`

Raw access:

- `ctx.raw`

## Command Flow

Command dispatch goes through:

- `src/core/CommandRegistry.js`

Flow:

1. command parsed by adapter
2. bot checks pending actions first
3. bot blocks banned/blacklisted sources
4. all registered `onMessage` handlers run
5. if message is a command:
   - owner/admin/group checks
   - allow-list checks
   - cooldown checks
   - command executes
   - command executed hooks run

## Plugin Lifecycle

Loaded by:

- `src/core/PluginLoader.js`

Supported plugin hooks:

- `onLoad(bot)`
- `onUnload(bot)`
- `onMessage(ctx)`
- `commands: []`

If `onLoad()` returns a function, that function is used as cleanup.

## Plugin-Level Hook Types

There are two main extension styles:

1. command plugins
- expose commands in `commands`

2. message hook plugins
- expose `onMessage(ctx)`

Examples:

- `src/plugins/afk.js`
- `src/plugins/auto-features.js`
- `src/plugins/moderation.js`
- `src/plugins/stats.js`

## Registry Hooks

Available in `CommandRegistry`:

- `registerMessageHandler(fn)`
- `registerCommandExecutedHandler(fn)`

This is how plugins like stats track executed commands centrally.

## Pending Actions / Reply Sessions

Main files:

- `src/utils/pendingActions.js`
- `src/utils/gameSessions.js`
- `src/utils/downloadFlow.js`

This system is used for:

- reply-based flows
- numeric selections
- interactive game turns
- multi-step command interactions

It supports:

- quoted-message matching
- fallback recent-action matching
- chat/user scoping
- auto timeout cleanup

## Storage Flow

Low-level storage engine:

- `src/utils/storageStore.js`

Preferred usage:

- plugins call `state/*`
- `state/*` calls `storageStore`

Do not write persistent plugin state directly from plugin files.

## Accessing The WhatsApp Socket

If a plugin truly needs the raw Baileys client:

From bot:

```js
const wa = bot.getAdapter('whatsapp');
const client = wa?.client;
```

From message context:

```js
const client = ctx.platformAdapter?.client;
```

Use raw client access carefully.
Prefer:

- `ctx` helpers
- `domains/whatsapp/*`
- adapter methods

before touching Baileys directly.

## Useful Runtime Boundaries

Use these layers in this order:

1. `ctx` methods
2. `domains/whatsapp/*`
3. `state/*`
4. `utils/*`
5. raw adapter/client only if needed

That keeps new features from scattering logic across the codebase.
