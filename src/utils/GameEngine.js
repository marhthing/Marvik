import { createReplySession } from './gameSessions.js';

export default class GameEngine {
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        this.chatId = ctx.chatId;
        this.gameType = options.gameType || 'game';
        this.minPlayers = options.minPlayers || 2;
        this.maxPlayers = options.maxPlayers || 999;
        this.joinTimeout = options.joinTimeout || 40000;
        this.participants = new Map();
        this.scores = new Map();
        this.phase = 'joining';
        this.startTime = Date.now();
        this.onStart = options.onStart || (() => {});
        this.onEnd = options.onEnd || (() => {});
        this.normalizeId = (id) => id ? id.split('@')[0].split(':')[0].replace(/\D/g, '') : '';
    }

    async startJoinPhase() {
        const botJid = this.ctx.platformAdapter?.client?.user?.id || "";
        const hostJid = this.ctx.isFromMe ? botJid : this.ctx.senderId;
        const hostName = this.ctx.senderName || this.ctx.pushName || this.normalizeId(hostJid);

        this.participants.set(hostJid, { name: hostName, oderId: hostJid });
        this.scores.set(hostJid, { name: hostName, score: 0 });

        const sent = await this.ctx.reply(
            `*🎮 ${this.gameType.toUpperCase()} Game Starting!*\n\n` +
            `Type *join* to participate!\n` +
            `⏱️ Time remaining: ${Math.floor(this.joinTimeout / 1000)} seconds\n\n` +
            `*Players (${this.participants.size}/${this.maxPlayers === 999 ? '∞' : this.maxPlayers}):*\n` +
            `• @${this.normalizeId(hostJid)} (${hostName}) (host)\n\n` +
            `Min players: ${this.minPlayers}`,
            { mentions: [hostJid] }
        );

        const updateInterval = setInterval(async () => {
            if (this.phase !== 'joining') {
                clearInterval(updateInterval);
                return;
            }
            
            const elapsed = Date.now() - this.startTime;
            const remaining = Math.max(0, Math.floor((this.joinTimeout - elapsed) / 1000));
            
            const playerList = [...this.participants.values()].map(p => `• @${this.normalizeId(p.oderId)} (${p.name})`).join('\n');
            await this.ctx.reply(
                `*🎮 ${this.gameType.toUpperCase()}*\n\n` +
                `⏱️ Time remaining: ${remaining} seconds\n\n` +
                `*Players (${this.participants.size}/${this.maxPlayers === 999 ? '∞' : this.maxPlayers}):*\n` +
                `${playerList}\n\n` +
                `Type *join* to participate!`,
                { mentions: [...this.participants.keys()] }
            );
        }, 15000);

        createReplySession(this.chatId, sent, {
            type: `${this.gameType}_join`,
            data: { gameId: this.chatId },
            timeout: this.joinTimeout + 5000,
            match: (text) => text.toLowerCase().trim() === 'join',
            handler: async (replyCtx) => {
                if (this.phase !== 'joining') return true;
                const senderId = replyCtx.isFromMe ? botJid : replyCtx.senderId;
                const senderName = replyCtx.senderName || replyCtx.pushName || this.normalizeId(senderId);

                if (this.participants.has(senderId)) {
                    await replyCtx.reply(`@${this.normalizeId(senderId)}, you're already in!`, { mentions: [senderId] });
                    return false;
                }

                if (this.participants.size >= this.maxPlayers) {
                    await replyCtx.reply(`Game is full!`);
                    return false;
                }

                this.participants.set(senderId, { name: senderName, oderId: senderId });
                this.scores.set(senderId, { name: senderName, score: 0 });

                const playerList = [...this.participants.values()].map(p => `• @${this.normalizeId(p.oderId)} (${p.name})`).join('\n');
                await replyCtx.reply(
                    `✅ @${this.normalizeId(senderId)} (${senderName}) joined!\n\n` +
                    `*Players (${this.participants.size}/${this.maxPlayers === 999 ? '∞' : this.maxPlayers}):*\n${playerList}`,
                    { mentions: [...this.participants.keys()] }
                );

                if (this.participants.size === this.maxPlayers) {
                    clearTimeout(startTimeout);
                    clearInterval(updateInterval);
                    this.phase = 'playing';
                    await this.onStart();
                    return true;
                }
                return false;
            }
        });

        const startTimeout = setTimeout(async () => {
            clearInterval(updateInterval);
            if (this.phase !== 'joining') return;

            if (this.participants.size < this.minPlayers) {
                this.phase = 'ended';
                await this.ctx.reply(`❌ Not enough players joined. Game cancelled.`);
                await this.onEnd({ reason: 'not_enough_players', gameType: this.gameType, chatId: this.chatId });
                return;
            }

            this.phase = 'playing';
            const playerList = [...this.participants.values()].map(p => `• @${this.normalizeId(p.oderId)} (${p.name})`).join('\n');
            await this.ctx.reply(
                `*🚀 ${this.gameType.toUpperCase()} Starting!*\n\n` +
                `*Players:*\n${playerList}\n\n` +
                `First turn coming...`,
                { mentions: [...this.participants.keys()] }
            );
            await new Promise(r => setTimeout(r, 2000));
            await this.onStart();
        }, this.joinTimeout);
    }
}
