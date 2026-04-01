# Commands Overview

> This file is generated from plugin metadata in `src/plugins`. Run `npm run docs:commands` after adding or changing commands.

For live command help inside WhatsApp, use:

- `.menu`
- `.help`
- `.help <command>`

## Admin

### `antilink`

Turn anti-link on or off

- Usage: `.antilink on/off`
- Aliases: none
- Plugin: `src/plugins/moderation.js`

### `antispam`

Turn anti-spam on or off

- Usage: `.antispam on/off`
- Aliases: none
- Plugin: `src/plugins/moderation.js`

### `antiword`

Manage anti-word list

- Usage: `.antiword on/off | .antiword add <word> | .antiword remove <word>`
- Aliases: none
- Plugin: `src/plugins/moderation.js`

### `purge`

Delete recent messages from this group

- Usage: `.purge <count>`
- Aliases: none
- Plugin: `src/plugins/moderation.js`

### `warn`

Manage warning system and warn users

- Usage: `.warn on/off | .warn max <number> | .warn reset [reply/@user] | .warn [reply/@user] [reason]`
- Aliases: none
- Plugin: `src/plugins/moderation.js`


## Ai

### `ai`

Ask the AI anything

- Usage: `.ai <your question>`
- Aliases: `gpt`, `chat`
- Plugin: `src/plugins/ai.js`

### `aimode`

Enable continuous AI chat in this chat

- Usage: `.aimode | .aimode stop | .aimode clear`
- Aliases: none
- Plugin: `src/plugins/ai.js`

### `airefill`

Refill AI cache with fresh content

- Usage: `.airefill <type>`
- Aliases: `airefresh`
- Plugin: `src/plugins/ai.js`

### `aistatus`

Check AI cache status

- Usage: `.aistatus`
- Aliases: `aicache`
- Plugin: `src/plugins/ai.js`

### `image`

Generate an image from text prompt

- Usage: `.image <prompt> or reply to a message with .image`
- Aliases: `pollinations`
- Plugin: `src/plugins/image.js`


## Audio

### `ask`

Ask questions about images or describe them using Groq Vision

- Usage: `Send an image with .ask <question> as caption or reply to an image with .ask <question>`
- Aliases: `describe`, `explain`
- Plugin: `src/plugins/audiotextconversion.js`

### `stt`

Convert audio to text

- Usage: `Reply to an audio/voice note with .stt`
- Aliases: `transcribe`
- Plugin: `src/plugins/audiotextconversion.js`

### `tts`

Convert text to speech

- Usage: `Reply to a message with .tts or use .tts <text>. Use .tts voice to see available voices. Use .tts <voice> <text> to specify a voice.`
- Aliases: none
- Plugin: `src/plugins/audiotextconversion.js`


## Download

### `fb`

Download Facebook videos with quality selection

- Usage: `.fb <url>`
- Aliases: `facebook`, `fbdl`
- Plugin: `src/plugins/facebook.js`

### `ig`

Download Instagram media (post/reel/video)

- Usage: `.ig <url>`
- Aliases: `instagram`, `insta`
- Plugin: `src/plugins/instagram.js`

### `pinterest`

Download Pinterest media (image/video) with quality selection

- Usage: `.pinterest <url>`
- Aliases: `pinsrc`, `pint`
- Plugin: `src/plugins/pinterest.js`

### `snap`

Download Snapchat story/spotlight without watermark

- Usage: `.snap <url>`
- Aliases: `snapchat`, `sc`
- Plugin: `src/plugins/snapchat.js`

### `tiktok`

Download TikTok video without watermark

- Usage: `.tiktok <url>`
- Aliases: `tt`, `tik`
- Plugin: `src/plugins/tiktok.js`

### `twitter`

Download Twitter/X media

- Usage: `.twitter <url>`
- Aliases: `tw`, `x`, `tweet`
- Plugin: `src/plugins/twitter.js`

### `yta`

Download YouTube audio

- Usage: `.yta <url>`
- Aliases: `ytaudio`, `ytmp3`
- Plugin: `src/plugins/youtube.js`

### `yts`

Search YouTube videos

- Usage: `.yts <search term>`
- Aliases: `ytsearch`
- Plugin: `src/plugins/youtube.js`

### `ytv`

Download YouTube video with quality selection

- Usage: `.ytv <url>`
- Aliases: `ytvideo`, `yt`
- Plugin: `src/plugins/youtube.js`


## Fun

### `gif`

Send a random GIF or search for a GIF by keyword

- Usage: `.gif [search]`
- Aliases: none
- Plugin: `src/plugins/gif.js`

### `quote`

Generate a quote image from replied text or inline text

- Usage: `.quote <text> or reply to a text with .quote`
- Aliases: none
- Plugin: `src/plugins/quote.js`


## Games

### `akinator`

🧞 Akinator game

- Usage: not specified
- Aliases: none
- Plugin: `src/plugins/games.js`

### `dare`

Play Dare

- Usage: not specified
- Aliases: none
- Plugin: `src/plugins/games.js`

### `hangman`

Start a Hangman game

- Usage: not specified
- Aliases: none
- Plugin: `src/plugins/games.js`

### `riddle`

Solve a riddle

- Usage: not specified
- Aliases: none
- Plugin: `src/plugins/games.js`

### `trivia`

Start a trivia game

- Usage: not specified
- Aliases: `t`
- Plugin: `src/plugins/games.js`

### `truth`

Play Truth

- Usage: not specified
- Aliases: none
- Plugin: `src/plugins/games.js`

### `ttt`

Start a Tic-Tac-Toe game

- Usage: not specified
- Aliases: `tictactoe`
- Plugin: `src/plugins/games.js`

### `wordle`

Start a Wordle game

- Usage: not specified
- Aliases: none
- Plugin: `src/plugins/games.js`


## General

### `clear`

Clear chat conversation (local)

- Usage: `.clear`
- Aliases: `clearchat`
- Plugin: `src/plugins/personal.js`


## Group

### `canceltempkick`

Cancel a pending tempkick re-add job

- Usage: `.canceltempkick <jobId>`
- Aliases: `deltempkick`
- Plugin: `src/plugins/scheduler.js`

### `listtempkicks`

List pending tempkick re-add jobs

- Usage: `.listtempkicks`
- Aliases: `tempkicklist`
- Plugin: `src/plugins/scheduler.js`

### `stats`

Show message and command statistics for the group

- Usage: `.stats`
- Aliases: `groupstats`, `activity`
- Plugin: `src/plugins/stats.js`

### `tempkick`

Kick a user now and re-add them later

- Usage: `.tempkick @user <10m|2h|1d>`
- Aliases: `tempban`
- Plugin: `src/plugins/scheduler.js`


## Media

### `delcmd`

Unbind a command from a sticker

- Usage: `.delcmd (reply to sticker)`
- Aliases: none
- Plugin: `src/plugins/sticker.js`

### `enhance`

Enhance image quality (reply to image)

- Usage: `.enhance (reply to image)`
- Aliases: none
- Plugin: `src/plugins/enhance.js`

### `img`

Convert sticker to image

- Usage: `.img (reply to sticker)`
- Aliases: none
- Plugin: `src/plugins/stickerconvert.js`

### `setcmd`

Bind a command to a sticker

- Usage: `.setcmd (reply to sticker) [command]`
- Aliases: none
- Plugin: `src/plugins/sticker.js`

### `sticker`

Convert an image to a sticker

- Usage: `.sticker (reply to image/video) or .sticker <pinterest url>`
- Aliases: `st`, `s`
- Plugin: `src/plugins/sticker.js`

### `take`

Update sticker metadata with your pack name and author

- Usage: `.take (reply to sticker)`
- Aliases: none
- Plugin: `src/plugins/take.js`

### `vid`

Convert animated sticker to video or gif

- Usage: `.vid (reply to sticker)`
- Aliases: none
- Plugin: `src/plugins/stickerconvert.js`


## Owner

### `allow`

Allow a user to use a command: .allow <cmd>

- Usage: `.allow <cmd>`
- Aliases: none
- Plugin: `src/plugins/permissions.js`

### `antistatusdelete`

Recover deleted WhatsApp statuses with include/exclude filters

- Usage: `.antistatusdelete <on|off|all|only|except|to>`
- Aliases: `antistatus`
- Plugin: `src/plugins/antidelete.js`

### `autodownload`

Configure automatic downloader execution for plain links

- Usage: `.autodownload <on|off|p|g|all|jid,jid>`
- Aliases: `autodl`, `autourl`
- Plugin: `src/plugins/autodownload.js`

### `autoonline`

Turn always online on or off

- Usage: `.autoonline <on/off>`
- Aliases: none
- Plugin: `src/plugins/auto-features.js`

### `autoreact`

Turn auto react on or off

- Usage: `.autoreact <on/off>`
- Aliases: none
- Plugin: `src/plugins/auto-features.js`

### `autoread`

Turn auto read on or off

- Usage: `.autoread <on/off>`
- Aliases: none
- Plugin: `src/plugins/auto-features.js`

### `autostatusreact`

Turn auto status react on or off

- Usage: `.autostatusreact <on/off>`
- Aliases: none
- Plugin: `src/plugins/auto-features.js`

### `autotyping`

Turn auto typing on or off

- Usage: `.autotyping <on/off>`
- Aliases: none
- Plugin: `src/plugins/auto-features.js`

### `br`

Turn bot reactions on or off

- Usage: `.br on | off`
- Aliases: none
- Plugin: `src/plugins/botreactions.js`

### `broadcast`

Broadcast a message to known users, groups, or both

- Usage: `.broadcast <users|groups|all> <text> or reply to a message with .broadcast <scope>`
- Aliases: `bc`
- Plugin: `src/plugins/broadcast.js`

### `cancelschedule`

Cancel a scheduled message or status job

- Usage: `.cancelschedule <jobId>`
- Aliases: `delschedule`
- Plugin: `src/plugins/scheduler.js`

### `channel`

Inspect and manage WhatsApp channels

- Usage: `.channel <info|follow|unfollow|mute|unmute|posts> <jid|invite|link> [count]`
- Aliases: `newsletter`
- Plugin: `src/plugins/channel.js`

### `chats`

Show known chat JIDs

- Usage: `.chats [users|groups]`
- Aliases: `chatlist`
- Plugin: `src/plugins/chats.js`

### `contact`

Show all WhatsApp contacts

- Usage: `.contact`
- Aliases: `contacts`
- Plugin: `src/plugins/contact.js`

### `delete`

Configure antidelete destination and state

- Usage: `.delete <jid|g|p|on|off>`
- Aliases: none
- Plugin: `src/plugins/antidelete.js`

### `deny`

Remove a user or group from allowed list: .deny <cmd>

- Usage: `.deny <cmd>`
- Aliases: `disallow`
- Plugin: `src/plugins/permissions.js`

### `env`

Manage .env variables

- Usage: `.env add VAR=VALUE | .env del VAR | .env list`
- Aliases: none
- Plugin: `src/plugins/env.js`

### `listschedules`

List scheduled message and status jobs

- Usage: `.listschedules`
- Aliases: `schedulelist`
- Plugin: `src/plugins/scheduler.js`

### `pm`

Show allowed users for all commands

- Usage: `.pm`
- Aliases: none
- Plugin: `src/plugins/permissions.js`

### `restart`

Restart the bot process

- Usage: `.restart`
- Aliases: none
- Plugin: `src/plugins/core.js`

### `schedulemsg`

Schedule a message to be sent later

- Usage: `.schedulemsg <message> <10m|YYYY-MM-DD HH:mm> <jid>,<jid> or reply with .schedulemsg <time> <jid>,<jid>`
- Aliases: `msgschedule`
- Plugin: `src/plugins/scheduler.js`

### `schedulestatus`

Schedule a WhatsApp status post

- Usage: `.schedulestatus <10m|YYYY-MM-DD HH:mm> <text> or reply/send media with .schedulestatus <time> [caption]`
- Aliases: `statusschedule`
- Plugin: `src/plugins/scheduler.js`

### `shutdown`

Shutdown the bot process

- Usage: `.shutdown`
- Aliases: none
- Plugin: `src/plugins/core.js`

### `update`

Check for updates

- Usage: `.update`
- Aliases: none
- Plugin: `src/plugins/core.js`

### `updateforce`

Force reclone and clean environment, regardless of update status

- Usage: `.update force`
- Aliases: `update force`
- Plugin: `src/plugins/core.js`

### `updatenow`

Apply update if available (reclone only if update exists)

- Usage: `.update now`
- Aliases: `update now`
- Plugin: `src/plugins/core.js`

### `welcome`

Configure welcome and goodbye messages

- Usage: `.welcome <status|on|off|all|only|except|text|bye>`
- Aliases: none
- Plugin: `src/plugins/welcome.js`


## Personal

### `setbio`

Update owner bio

- Usage: `.setbio <text>`
- Aliases: none
- Plugin: `src/plugins/personal.js`

### `setpp`

Update owner profile picture

- Usage: `Reply to an image with .setpp`
- Aliases: none
- Plugin: `src/plugins/personal.js`


## Privacy

### `vv`

Manually extract view-once from reply or set destination

- Usage: `.vv (reply to a view-once message) | .vv <jid|g|p>`
- Aliases: none
- Plugin: `src/plugins/antiviewonce.js`


## Utility

### `afk`

Mark yourself as AFK with an optional reason

- Usage: `.afk [reason] | .afk off | .afk status`
- Aliases: none
- Plugin: `src/plugins/afk.js`

### `alive`

Show bot uptime

- Usage: `.alive`
- Aliases: `uptime`, `awake`
- Plugin: `src/plugins/alive.js`

### `back`

Clear your AFK status

- Usage: `.back`
- Aliases: none
- Plugin: `src/plugins/afk.js`

### `caption`

Resend media with a caption

- Usage: `.caption <text> (reply to media or send media with command)`
- Aliases: `setcaption`
- Plugin: `src/plugins/caption.js`

### `help`

List all available commands or get help for a specific command

- Usage: `.help [command]`
- Aliases: `h`
- Plugin: `src/plugins/help.js`

### `jid`

Show the current chat JID or the JID of a replied user

- Usage: `.jid`
- Aliases: none
- Plugin: `src/plugins/jid.js`

### `memory`

Show current memory usage and system info

- Usage: `.memory`
- Aliases: `mem`, `ram`, `meminfo`
- Plugin: `src/plugins/memory.js`

### `menu`

Show main menu and bot info

- Usage: `.menu`
- Aliases: none
- Plugin: `src/plugins/menu.js`

### `pin`

Save and manage pinned messages for this chat

- Usage: `.pin save <tag> | .pin get <tag> | .pin list | .pin del <tag>`
- Aliases: `pins`
- Plugin: `src/plugins/pins.js`

### `ping`

Check if the bot is alive

- Usage: `.ping`
- Aliases: `p`
- Plugin: `src/plugins/ping.js`

### `poll`

Create a WhatsApp poll

- Usage: `.poll Question | Option 1 | Option 2 | [Option 3...]`
- Aliases: none
- Plugin: `src/plugins/poll.js`

### `profile`

Show WhatsApp profile details for a user

- Usage: `.profile <number|@mention|reply>`
- Aliases: `whois`, `userinfo`
- Plugin: `src/plugins/profile.js`

### `qr`

Generate a QR code from text

- Usage: `.qr <text>`
- Aliases: `qrcode`
- Plugin: `src/plugins/qr.js`

### `save`

Forward message to owner or custom JID

- Usage: `.save (reply to a message) | .save <jid|g|p>`
- Aliases: none
- Plugin: `src/plugins/save.js`

### `star`

Star a replied message in WhatsApp

- Usage: `.star`
- Aliases: none
- Plugin: `src/plugins/pins.js`

### `unstar`

Unstar a replied message in WhatsApp

- Usage: `.unstar`
- Aliases: none
- Plugin: `src/plugins/pins.js`


## Utils

### `lyrics`

Find lyrics for a song

- Usage: `.lyrics <song name>`
- Aliases: none
- Plugin: `src/plugins/lyrics.js`

### `weather`

Get weather for a city

- Usage: `.weather <city>`
- Aliases: none
- Plugin: `src/plugins/weather.js`

## Notes

- Keep `README.md`, architecture docs, and plugin guides hand-written and stable.
- Treat this command reference as generated output from the source of truth in plugin metadata.
