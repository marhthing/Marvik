# Configuration

This file explains how to run, configure, and operate the bot.

## Runtime Entry Points

- `index.js`
  Outer process manager. It restarts the child bot process when it exits.
- `src/index.js`
  Real app entry point. It checks dependencies, loads config, enables hot reload, and starts `Bot`.

Normal startup uses:

```bash
npm start
```

## Required Environment Variables

Core values:

```env
BOT_NAME=Marvik
PREFIX=.
OWNER_NUMBER=2347000000000
BOT_LANG=en
ENABLE_WHATSAPP=true
LOG_LEVEL=info
LOG_PRETTY=true
LOG_TIMESTAMPS=true
```

## Common Optional Environment Variables

Bot behavior:

```env
STICKER_PACK=Marvik
STICKER_AUTHOR=Are Martins
BOT_REACTIONS=on
AUTO_RESTART_HOURS=0
```

Language:

```env
BOT_LANG=en
```

Supported values:

- `bn`
- `en`
- `es`
- `hi`
- `id`
- `ur`
- `tr`
- `fr`
- `ru`
- `ar`
- `ml`

Auto-features:

```env
AUTO_TYPING=false
ALWAYS_ONLINE=false
AUTO_READ=false
AUTO_REACT=false
AUTO_STATUS_REACT=false
```

AI:

```env
GROQ_API_KEY=
```

Network/proxy:

```env
PROXIES=http://host:port,https://host:port
```

YouTube:

```env
YOUTUBE_COOKIES=
YOUTUBE_COOKIES_FILE=
YTDLP_COOKIES_FILE=
```

## Pairing

On first WhatsApp login, the adapter asks for:

1. QR pairing
2. 8-digit pairing code

Session data is stored in:

- `session/whatsapp/`

## Storage

Primary bot state:

- `storage/storage.json`

This contains domain-owned state such as:

- moderation
- permissions
- group settings
- AI mode
- AI cache
- pins
- stats
- scheduler state
- AFK state

Separate message archive:

- `storage/messages/`

This is intentionally separate because it stores per-message records used by:

- antidelete
- memory recovery
- quoted-message lookups
- restart-safe message access

It is not normal app-state and should not be merged into `storage.json`.

## Hot Reload

`src/index.js` watches:

- `.env`
- `src/plugins/`

When `.env` changes:

- `dotenv` is reloaded
- in-memory env cache is reloaded
- config is re-imported

When a plugin file changes:

- existing plugin reloads if already loaded
- new plugin loads if it did not exist before

## Logging

Runtime logging uses the shared logger:

- `src/utils/logger.js`

Bootstrap/manager logging uses:

- `src/utils/bootstrapLogger.js`

Recommended defaults:

```env
LOG_LEVEL=info
LOG_PRETTY=true
LOG_TIMESTAMPS=true
```

For quieter output:

```env
LOG_LEVEL=warn
```

## Command Reactions

Command/plugin reactions are gated by:

- `BOT_REACTIONS=on|off`

Shared reaction helpers live in:

- `src/utils/pendingActions.js`

## Restart / Shutdown Behavior

The bot flushes pending memory-store writes during normal shutdown paths:

- manual restart
- manual shutdown
- signal shutdown
- graceful uncaught-exception shutdown path

Auto restart is now optional and off by default:

```env
AUTO_RESTART_HOURS=0
```

Set it to a positive number to enable periodic restart.

## Recommended First-Time Setup

Minimal:

```env
BOT_NAME=Marvik
PREFIX=.
OWNER_NUMBER=2347000000000
ENABLE_WHATSAPP=true
LOG_LEVEL=info
LOG_PRETTY=true
LOG_TIMESTAMPS=true
```

If using AI:

```env
GROQ_API_KEY=your_key_here
```

If using YouTube heavily:

```env
YOUTUBE_COOKIES_FILE=cookies/youtube-cookies.txt
```

## Quick Recipes

For common implementation examples, see:

- [Quick Recipes](./QUICK_RECIPES.md)
