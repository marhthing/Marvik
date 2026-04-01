# Troubleshooting

This file is organized by scenario instead of by subsystem.

## Bot Keeps Restarting On Startup

Check:

- syntax errors in recently edited files
- logger/bootstrap issues
- invalid imports

Useful checks:

```bash
node --check src/path/to/file.js
```

If the manager keeps restarting the bot:

- read the first real stack trace before the restart loop repeats
- fix that underlying app error, not the manager

## WhatsApp Pairing Fails

Try:

1. stop the bot
2. clear `session/whatsapp/`
3. start again
4. re-pair

If pairing code fails repeatedly:

- verify the phone number format
- verify the session folder is writable

## Commands Do Not Respond

Check:

- `OWNER_NUMBER`
- `PREFIX`
- whether the command is owner-only/admin-only/group-only
- whether the sender/chat is blocked by permissions or moderation

Also check whether:

- plugin is loaded
- command name or alias actually exists

Use:

- `.menu`
- `.help`

## Reactions Are Not Showing

Check:

- `BOT_REACTIONS=on`

Command reactions are shared through:

- `src/utils/pendingActions.js`

Automatic reactions are controlled separately by:

- `AUTO_REACT`
- `AUTO_STATUS_REACT`

## AI Commands Fail

Check:

- `GROQ_API_KEY`

If AI mode or AI games act strangely:

- inspect `aiCache` and `aiMode` in `storage/storage.json`
- use `.aistatus`
- use `.airefill`

## YouTube Commands Fail

Common causes:

- YouTube anti-bot checks
- expired or missing cookies
- IP/proxy issues

Check:

- `YOUTUBE_COOKIES`
- `YOUTUBE_COOKIES_FILE`
- `YTDLP_COOKIES_FILE`
- `PROXIES`

If a video is blocked by YouTube, refresh cookies first.

## Media Commands Fail

Check:

- whether the quoted media is still available
- whether the message was actually quoted
- whether ffmpeg/media dependencies are installed

For sticker/media conversion:

- verify the input message type is supported

## Antidelete Does Not Recover A Message

Check:

- whether the bot actually saw the message before it was deleted
- whether message archives under `storage/messages/` exist
- whether the process restarted before the message archive was flushed

Antidelete depends on the message archive and memory store.

## Group Commands Fail

Check:

- is the chat actually a group?
- is the bot an admin?
- is the caller allowed to use the command?

Typical failing cases:

- promote/demote/kick without admin rights
- open/close without admin rights
- join-request commands in unsupported context

## Channel Commands Fail

Check:

- whether the channel/newsletter identifier is valid
- whether the account has the required rights for admin/update actions

Channel message fetches are more fragile than normal chat commands.

## Bot Is Slow After Running For A While

Focus on:

- message archive size under `storage/messages/`
- media-heavy plugins
- AI/network-heavy commands
- overall system RAM/CPU

The architecture itself is not usually the performance bottleneck.

## Logs Are Too Noisy

Set:

```env
LOG_LEVEL=warn
```

For normal operation:

```env
LOG_LEVEL=info
LOG_PRETTY=true
LOG_TIMESTAMPS=true
```

## Hot Reload Did Not Pick Up My Change

Hot reload reliably watches:

- `.env`
- `src/plugins/`

If you changed:

- `src/state`
- `src/domains`
- `src/utils`
- `src/core`

a full restart is safer.
