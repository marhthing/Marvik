import GameEngine from '../utils/GameEngine.js';
import ai from '../utils/ai.js';
import logger from '../utils/logger.js';
import { cloneReplySession, createReplySession } from '../utils/gameSessions.js';

const triviaQuestions = [
  { question: "What is the capital of France?", answer: "B", options: ["London", "Paris", "Berlin", "Madrid"] },
  { question: "What planet is known as the Red Planet?", answer: "B", options: ["Venus", "Mars", "Jupiter", "Saturn"] },
  { question: "What is the largest ocean on Earth?", answer: "C", options: ["Atlantic", "Indian", "Pacific", "Arctic"] },
  { question: "Who painted the Mona Lisa?", answer: "C", options: ["Picasso", "Van Gogh", "Leonardo", "Michelangelo"] },
  { question: "What is the chemical symbol for gold?", answer: "B", options: ["Ag", "Au", "Fe", "Cu"] }
];

const activeGames = new Map();
const optionLetters = ['A', 'B', 'C', 'D'];
const fallbackTrivia = triviaQuestions[0];
const fallbackRiddle = { riddle: 'What has keys but no locks?', answer: 'piano', hint: 'Musical instrument' };

function normalizeTriviaQuestion(raw) {
  if (!raw || typeof raw !== 'object') return fallbackTrivia;
  const question = typeof raw.question === 'string' && raw.question.trim() ? raw.question.trim() : fallbackTrivia.question;
  const options = Array.isArray(raw.options) && raw.options.length >= 4
    ? raw.options.slice(0, 4).map(opt => (typeof opt === 'string' ? opt : String(opt ?? '')))
    : fallbackTrivia.options;

  let answer = raw.answer;
  if (typeof answer === 'string') answer = answer.trim();
  if (!answer) return { question, options, answer: fallbackTrivia.answer };

  const upper = String(answer).toUpperCase();
  if (optionLetters.includes(upper)) return { question, options, answer: upper };

  const answerIndex = options.findIndex(opt => String(opt).trim().toLowerCase() === String(answer).trim().toLowerCase());
  if (answerIndex >= 0) return { question, options, answer: optionLetters[answerIndex] };

  return { question, options, answer: fallbackTrivia.answer };
}

function normalizeId(id) {
  if (!id) return '';
  return id.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function formatLeaderboard(game) {
  const scores = game.engine.scores;
  if (!scores || scores.size === 0) return 'No scores yet!';
  const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  return sorted.map(([oderId, data], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} @${normalizeId(oderId)} (${data.name}) - ${data.score} pts`;
  }).join('\n');
}

async function endTriviaGame(ctx, game, reason) {
  activeGames.delete(ctx.chatId);
  if (game.answerTimer) clearTimeout(game.answerTimer);
  
  const scores = game.engine.scores;
  const participants = game.engine.participants;
  const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const winner = sorted[0];
  
  await ctx.reply(
    `*🏁 Trivia Game Over!*\n\n` +
    `Reason: ${reason}\n` +
    `Total Rounds: ${game.round}\n\n` +
    `*🏆 Final Scores:*\n${formatLeaderboard(game)}` +
    (winner ? `\n\n👑 Winner: @${normalizeId(winner[0])} (${winner[1].name})!` : ''),
    { mentions: [...participants.keys()] }
  );
}

async function sendTriviaQuestion(ctx, game) {
  const participants = game.engine.participants;
  if (participants.size < 2) {
    await endTriviaGame(ctx, game, 'Only one player remaining!');
    return;
  }
  
  game.round++;
  
  // Try to fetch from AI
  let q;
  try {
    q = await ai.getOrFetchItem('trivia', triviaQuestions);
  } catch (e) {
    q = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
  }
  
  game.currentQuestion = normalizeTriviaQuestion(q);
  
  const currentPlayerArr = [...participants.entries()];
  game.currentPlayerIndex = game.currentPlayerIndex % currentPlayerArr.length;
  const [currentPlayerId, currentPlayerData] = currentPlayerArr[game.currentPlayerIndex];
  game.currentTurn = currentPlayerId;
  
  const options = game.currentQuestion.options.map((opt, i) => `${optionLetters[i]}. ${opt}`).join('\n');
  const sent = await ctx.reply(
    `*🧠 AI Trivia - Round ${game.round}*\n\n` +
    `${game.currentQuestion.question}\n\n${options}\n\n` +
    `👤 @${normalizeId(currentPlayerId)} (${currentPlayerData.name})'s turn!\n` +
    `⏱️ Time: 30 seconds\n\n` +
    `Reply with A, B, C or D\n` +
    `Type *stop* to end the game`,
    { mentions: [currentPlayerId] }
  );
  
  if (game.answerTimer) clearTimeout(game.answerTimer);
  game.answerTimer = setTimeout(async () => {
    if (participants.has(game.currentTurn)) {
      await ctx.reply(`⏰ Time's up! @${normalizeId(game.currentTurn)} is eliminated!`, { mentions: [game.currentTurn] });
      participants.delete(game.currentTurn);
    }
    game.currentPlayerIndex++;
    await sendTriviaQuestion(ctx, game);
  }, 30000);
  
  createReplySession(ctx.chatId, sent, {
    type: 'trivia_answer',
    data: { gameId: ctx.chatId },
    timeout: 35000,
    match: (text) => ['A', 'B', 'C', 'D', 'STOP'].includes(text.toUpperCase().trim()),
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g || g.engine.phase !== 'playing') return true;
      
      const fromMe = replyCtx.isFromMe || replyCtx.message?.key?.fromMe;
      const botJid = replyCtx.platformAdapter?.client?.user?.id || replyCtx.client?.user?.id || "";
      const senderId = fromMe ? botJid : replyCtx.senderId;
      const text = replyCtx.text.toUpperCase().trim();
      
      if (text === 'STOP') {
        if (g.answerTimer) clearTimeout(g.answerTimer);
        await endTriviaGame(replyCtx, g, 'Game stopped by player');
        return true;
      }
      
      if (normalizeId(senderId) !== normalizeId(g.currentTurn)) {
        await replyCtx.reply(`❌ Not your turn! It's @${normalizeId(g.currentTurn)}'s turn.`, { mentions: [g.currentTurn] });
        return false;
      }
      
      if (g.answerTimer) clearTimeout(g.answerTimer);
      const isCorrect = text === g.currentQuestion.answer || text === g.currentQuestion.answer.toUpperCase();
      
      if (isCorrect) {
        const pData = g.engine.scores.get(senderId);
        if (pData) pData.score += 10;
        await replyCtx.reply(`✅ Correct! +10 points\n\n*Current Scores:*\n${formatLeaderboard(g)}`, { mentions: [senderId] });
      } else {
        await replyCtx.reply(`❌ Wrong! The answer was ${g.currentQuestion.answer}.\nYou are eliminated!`, { mentions: [senderId] });
        participants.delete(senderId);
      }
      
      g.currentPlayerIndex++;
      if (participants.size < 2) {
        await endTriviaGame(replyCtx, g, 'Only one player remaining!');
      } else {
        await new Promise(r => setTimeout(r, 2000));
        await sendTriviaQuestion(replyCtx, g);
      }
      return true;
    }
  });
}

function renderTicTacToeBoard(board) {
  const symbols = board.map(v => v === 0 ? '⬜' : (v === 1 ? '❌' : '⭕'));
  return `A1: ${symbols[0]} | A2: ${symbols[1]} | A3: ${symbols[2]}\nB1: ${symbols[3]} | B2: ${symbols[4]} | B3: ${symbols[5]}\nC1: ${symbols[6]} | C2: ${symbols[7]} | C3: ${symbols[8]}`;
}

function checkTicTacToeWinner(board) {
  const wins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const [a, b, c] of wins) {
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.includes(0) ? null : 'draw';
}

function tttPositionToIndex(pos) {
  const map = { 'A1': 0, 'A2': 1, 'A3': 2, 'B1': 3, 'B2': 4, 'B3': 5, 'C1': 6, 'C2': 7, 'C3': 8 };
  return map[pos.toUpperCase()] ?? -1;
}

async function startTicTacToeGame(ctx, game) {
  const players = [...game.engine.participants.entries()];
  game.player1 = players[0][0];
  game.player2 = players[1][0];
  game.currentTurn = game.player1;
  game.board = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  
  const p1Name = players[0][1].name;
  const p2Name = players[1][1].name;
  
  const sent = await ctx.reply(
    `*⭕❌ Tic-Tac-Toe*\n\n` +
    `${p1Name} (❌) vs ${p2Name} (⭕)\n\n` +
    `${renderTicTacToeBoard(game.board)}\n\n` +
    `👤 @${normalizeId(game.player1)} (${p1Name})'s turn! (❌)\n` +
    `Reply with position: A1, A2, A3, B1, B2, B3, C1, C2, C3\n` +
    `Type *stop* to quit`,
    { mentions: [game.player1, game.player2] }
  );
  
  createReplySession(ctx.chatId, sent, {
    type: 'ttt_move',
    data: { gameId: ctx.chatId },
    timeout: 5 * 60 * 1000,
    match: (text) => ['STOP', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'].includes(text.toUpperCase().trim()),
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g || g.engine.phase !== 'playing') return true;
      const senderId = replyCtx.senderId;
      const text = replyCtx.text.toUpperCase().trim();
      
      if (text === 'STOP') {
        activeGames.delete(ctx.chatId);
        await replyCtx.reply(`🏁 Game quit!`);
        return true;
      }
      
      if (normalizeId(senderId) !== normalizeId(g.currentTurn)) {
        await replyCtx.reply(`❌ Not your turn!`);
        return false;
      }
      
      const pos = tttPositionToIndex(text);
      if (pos === -1 || g.board[pos] !== 0) {
        await replyCtx.reply('Invalid position!');
        return false;
      }
      
      g.board[pos] = senderId === g.player1 ? 1 : 2;
      const winner = checkTicTacToeWinner(g.board);
      if (winner) {
        activeGames.delete(ctx.chatId);
        await replyCtx.reply(`${renderTicTacToeBoard(g.board)}\n\n${winner === 'draw' ? "🤝 Draw!" : "🎉 Winner!"}`);
        return true;
      }
      
      g.currentTurn = g.currentTurn === g.player1 ? g.player2 : g.player1;
      const nextP = g.engine.participants.get(g.currentTurn);
      const nextS = await replyCtx.reply(`${renderTicTacToeBoard(g.board)}\n\n👤 @${normalizeId(g.currentTurn)} (${nextP.name})'s turn!`, { mentions: [g.currentTurn] });
      cloneReplySession(replyCtx.chatId, sent.key.id, nextS);
      return false;
    }
  });
}

async function startHangmanGame(ctx, game) {
  const words = ['WHATSAPP', 'BOT', 'REPLIT', 'PROGRAMMING', 'NODEJS', 'JAVASCRIPT', 'MOBILE', 'INTERNET'];
  game.word = words[Math.floor(Math.random() * words.length)];
  game.guessedLetters = new Set();
  game.wrongGuesses = 0;
  game.maxWrong = 6;
  game.currentTurn = [...game.engine.participants.keys()][0];
  
  const displayWord = game.word.split('').map(l => game.guessedLetters.has(l) ? l : '_').join(' ');
  const sent = await ctx.reply(
    `*😵 Hangman*\n\n` +
    `Word: ${displayWord}\n` +
    `Wrong: ${game.wrongGuesses}/${game.maxWrong}\n` +
    `Guessed: ${[...game.guessedLetters].join(', ') || 'None'}\n\n` +
    `👤 @${normalizeId(game.currentTurn)}'s turn!\n` +
    `Type a letter (A-Z) or *stop*`,
    { mentions: [game.currentTurn] }
  );
  
  createReplySession(ctx.chatId, sent, {
    type: 'hangman_guess',
    data: { gameId: ctx.chatId },
    timeout: 5 * 60 * 1000,
    match: (text) => text.length === 1 || text.toUpperCase() === 'STOP',
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g || g.engine.phase !== 'playing') return true;
      if (normalizeId(replyCtx.senderId) !== normalizeId(g.currentTurn)) return false;
      
      const letter = replyCtx.text.toUpperCase().trim();
      if (letter === 'STOP') { activeGames.delete(ctx.chatId); await replyCtx.reply('Game stopped.'); return true; }
      if (g.guessedLetters.has(letter)) { await replyCtx.reply('Already guessed!'); return false; }
      
      g.guessedLetters.add(letter);
      if (!g.word.includes(letter)) g.wrongGuesses++;
      
      const won = g.word.split('').every(l => g.guessedLetters.has(l));
      const lost = g.wrongGuesses >= g.maxWrong;
      
      if (won || lost) {
        activeGames.delete(ctx.chatId);
        await replyCtx.reply(`Game Over! ${won ? '🎉 You won!' : '💀 You lost!'} The word was *${g.word}*`);
        return true;
      }
      
      const participants = [...g.engine.participants.keys()];
      g.currentTurn = participants[(participants.indexOf(g.currentTurn) + 1) % participants.length];
      const newDisplay = g.word.split('').map(l => g.guessedLetters.has(l) ? l : '_').join(' ');
      const next = await replyCtx.reply(
        `Word: ${newDisplay}\nWrong: ${g.wrongGuesses}/${g.maxWrong}\nGuessed: ${[...g.guessedLetters].join(', ')}\n\nNext: @${normalizeId(g.currentTurn)}`,
        { mentions: [g.currentTurn] }
      );
      cloneReplySession(ctx.chatId, sent.key.id, next);
      return false;
    }
  });
}

async function startWordleGame(ctx, game) {
  const wordList = ['APPLE', 'BEACH', 'BRAIN', 'CLOUD', 'DREAM', 'EARTH', 'FLAME', 'GHOST', 'HEART', 'IMAGE', 'JUICE', 'KNIFE', 'LEMON', 'MUSIC', 'NIGHT', 'OCEAN', 'PIANO', 'QUEEN', 'RIVER', 'SMILE', 'TIGER', 'VOICE', 'WATER', 'YOUTH', 'ZEBRA'];
  game.word = wordList[Math.floor(Math.random() * wordList.length)];
  game.attempts = 0;
  game.maxAttempts = 6;
  game.history = [];
  game.currentTurn = [...game.engine.participants.keys()][0];

  const sent = await ctx.reply(
    `*🟩 Wordle*\n\n` +
    `Guess the 5-letter word!\n` +
    `Attempts: ${game.attempts}/${game.maxAttempts}\n\n` +
    `👤 @${normalizeId(game.currentTurn)}'s turn!\n` +
    `Type a 5-letter word or *stop*`,
    { mentions: [game.currentTurn] }
  );

  createReplySession(ctx.chatId, sent, {
    type: 'wordle_guess',
    data: { gameId: ctx.chatId },
    timeout: 5 * 60 * 1000,
    match: (text) => text.length === 5 || text.toUpperCase() === 'STOP',
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g || g.engine.phase !== 'playing') return true;
      if (normalizeId(replyCtx.senderId) !== normalizeId(g.currentTurn)) return false;

      const guess = replyCtx.text.toUpperCase().trim();
      if (guess === 'STOP') { activeGames.delete(ctx.chatId); await replyCtx.reply('Game stopped.'); return true; }
      if (guess.length !== 5) { await replyCtx.reply('Must be 5 letters!'); return false; }

      g.attempts++;
      let result = '';
      for (let i = 0; i < 5; i++) {
        if (guess[i] === g.word[i]) result += '🟩';
        else if (g.word.includes(guess[i])) result += '🟨';
        else result += '⬛';
      }
      g.history.push(`${guess}\n${result}`);

      if (guess === g.word || g.attempts >= g.maxAttempts) {
        activeGames.delete(ctx.chatId);
        await replyCtx.reply(`${g.history.join('\n\n')}\n\n${guess === g.word ? '🎉 Correct!' : '💀 Failed!'} The word was *${g.word}*`);
        return true;
      }

      const participants = [...g.engine.participants.keys()];
      g.currentTurn = participants[(participants.indexOf(g.currentTurn) + 1) % participants.length];
      const next = await replyCtx.reply(
        `${g.history.join('\n\n')}\n\nAttempts: ${g.attempts}/${g.maxAttempts}\nNext: @${normalizeId(g.currentTurn)}`,
        { mentions: [g.currentTurn] }
      );
      cloneReplySession(ctx.chatId, sent.key.id, next);
      return false;
    }
  });
}

async function startRiddleGame(ctx, game) {
  let r;
  try {
    r = await ai.getOrFetchItem('riddles');
  } catch (e) {
    r = fallbackRiddle;
  }
  if (!r || typeof r !== 'object' || !r.riddle || !r.answer) r = fallbackRiddle;

  game.currentRiddle = r;
  game.currentTurn = [...game.engine.participants.keys()][0];

  const sent = await ctx.reply(
    `*🧩 Riddle*\n\n` +
    `${r.riddle}\n\n` +
    `👤 @${normalizeId(game.currentTurn)}'s turn!\n` +
    `Type your answer or *stop*`,
    { mentions: [game.currentTurn] }
  );

  createReplySession(ctx.chatId, sent, {
    type: 'riddle_guess',
    data: { gameId: ctx.chatId },
    timeout: 60000,
    match: (text) => true,
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g || g.engine.phase !== 'playing') return true;
      if (normalizeId(replyCtx.senderId) !== normalizeId(g.currentTurn)) return false;

      const guess = replyCtx.text.toLowerCase().trim();
      if (guess === 'stop') { activeGames.delete(ctx.chatId); await replyCtx.reply('Game stopped.'); return true; }
      if (guess === 'hint') { await replyCtx.reply(`💡 Hint: ${g.currentRiddle.hint}`); return false; }

      if (guess === g.currentRiddle.answer.toLowerCase()) {
        activeGames.delete(ctx.chatId);
        await replyCtx.reply(`🎉 Correct! @${normalizeId(replyCtx.senderId)} solved it! The answer was *${g.currentRiddle.answer}*`, { mentions: [replyCtx.senderId] });
        return true;
      }

      const participants = [...g.engine.participants.keys()];
      g.currentTurn = participants[(participants.indexOf(g.currentTurn) + 1) % participants.length];
      const next = await replyCtx.reply(`❌ Wrong! Next turn: @${normalizeId(g.currentTurn)}`, { mentions: [g.currentTurn] });
      cloneReplySession(ctx.chatId, sent.key.id, next);
      return false;
    }
  });
}

async function startTruthDareGame(ctx, game, type) {
  const getTruthDarePrompt = async (promptType) => {
    const fallback = promptType === 'truth'
      ? "What is your biggest secret?"
      : "Do 10 pushups!";
    try {
      const value = await ai.getOrFetchItem(promptType);
      if (!value || typeof value !== 'string') return fallback;
      const normalized = value.trim();
      if (!normalized || normalized.toLowerCase() === 'null' || normalized.toLowerCase() === 'undefined') {
        return fallback;
      }
      return normalized;
    } catch (e) {
      return fallback;
    }
  };
  
  const mode = type === 'truth' || type === 'dare' ? type : 'mixed';
  game.turnMode = mode;
  const content = await getTruthDarePrompt(type);
  
  game.currentTurn = [...game.engine.participants.keys()][0];
  const sent = await ctx.reply(
    `*🔥 ${type.toUpperCase()}*\n\n` +
    `👤 @${normalizeId(game.currentTurn)}\n\n` +
    `"${content}"\n\n` +
    `Type *done* when finished or *stop*`,
    { mentions: [game.currentTurn] }
  );

  createReplySession(ctx.chatId, sent, {
    type: 'td_done',
    data: { gameId: ctx.chatId, type },
    timeout: 5 * 60 * 1000,
    match: (text) => ['DONE', 'STOP'].includes(text.toUpperCase().trim()),
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g || g.engine.phase !== 'playing') return true;
      if (normalizeId(replyCtx.senderId) !== normalizeId(g.currentTurn)) return false;
      
      const text = replyCtx.text.toUpperCase().trim();
      if (text === 'STOP') { activeGames.delete(ctx.chatId); await replyCtx.reply('Game stopped.'); return true; }
      
      const participants = [...g.engine.participants.keys()];
      g.currentTurn = participants[(participants.indexOf(g.currentTurn) + 1) % participants.length];
      
      const nextType = g.turnMode === 'mixed'
        ? (Math.random() > 0.5 ? 'truth' : 'dare')
        : g.turnMode;
      const nextContent = await getTruthDarePrompt(nextType);
      
      const next = await replyCtx.reply(
        `✅ Nice!\n\n*Next Turn:* @${normalizeId(g.currentTurn)}\nType: *${nextType.toUpperCase()}*\n\n"${nextContent}"`,
        { mentions: [g.currentTurn] }
      );
      cloneReplySession(ctx.chatId, sent.key.id, next);
      return false;
    }
  });
}

async function startAkinatorGame(ctx, game) {
  game.questionHistory = [];
  game.answers = [];
  game.step = 0;
  game.maxSteps = 20;

  let firstQuestion = await ai.generateAkinatorQuestion([], []);
  if (!firstQuestion || typeof firstQuestion !== 'string') firstQuestion = 'Is your character a real person?';
  game.questionHistory.push({ question: firstQuestion });
  
  const sent = await ctx.reply(
    `*🧞 Akinator*\n\n` +
    `Step ${game.step + 1}/${game.maxSteps}\n` +
    `❓ ${firstQuestion}\n\n` +
    `Reply with: *Yes*, *No*, *Maybe*, or *Stop*`,
    { mentions: [...game.engine.participants.keys()] }
  );

  createReplySession(ctx.chatId, sent, {
    type: 'akinator_answer',
    data: { gameId: ctx.chatId },
    timeout: 5 * 60 * 1000,
    match: (text) => ['YES', 'Y', 'NO', 'N', 'MAYBE', 'IDK', 'STOP'].includes(text.toUpperCase().trim()),
    handler: async (replyCtx) => {
      const g = activeGames.get(ctx.chatId);
      if (!g) return true;
      const text = replyCtx.text.toUpperCase().trim();
      if (text === 'STOP') { activeGames.delete(ctx.chatId); await replyCtx.reply('Game stopped.'); return true; }

      g.answers.push(text.toLowerCase());
      g.questionHistory[g.step].answer = text.toLowerCase();
      g.step++;

      if (g.step >= 5 && g.step % 5 === 0) {
        const guess = await ai.analyzeAkinatorAnswers(g.answers, g.questionHistory) || 'someone famous';
        const guessSent = await replyCtx.reply(`🤔 I'm thinking of... *${guess}*?\n\nIs this correct? (Yes/No/Stop)`);
        
        createReplySession(ctx.chatId, guessSent, {
            type: 'akinator_guess',
            data: { gameId: ctx.chatId, guess },
            timeout: 60000,
            match: (t) => ['YES', 'Y', 'NO', 'N', 'STOP'].includes(t.toUpperCase().trim()),
            handler: async (guessCtx) => {
                const finalChoice = guessCtx.text.toUpperCase().trim();
                if (finalChoice === 'STOP') { activeGames.delete(ctx.chatId); return true; }
                if (finalChoice === 'YES' || finalChoice === 'Y') {
                    activeGames.delete(ctx.chatId);
                    await guessCtx.reply(`🎉 I knew it! I am the best! 🧞`);
                    return true;
                }
                if (g.step >= g.maxSteps) {
                    activeGames.delete(ctx.chatId);
                    await guessCtx.reply(`💀 I give up! You win! What were you thinking of?`);
                    return true;
                }
                // Continue to next question
                let nextQ = await ai.generateAkinatorQuestion(g.questionHistory, g.answers);
                if (!nextQ || typeof nextQ !== 'string') nextQ = 'Is your character from a movie or TV show?';
                g.questionHistory.push({ question: nextQ });
                const nextSent = await guessCtx.reply(`Step ${g.step + 1}/${g.maxSteps}\n❓ ${nextQ}`);
                cloneReplySession(ctx.chatId, sent.key.id, nextSent);
                return true;
            }
        });
        return true;
      }

      let nextQ = await ai.generateAkinatorQuestion(g.questionHistory, g.answers);
      if (!nextQ || typeof nextQ !== 'string') nextQ = 'Is your character older than 30?';
      g.questionHistory.push({ question: nextQ });
      const nextS = await replyCtx.reply(`Step ${g.step + 1}/${g.maxSteps}\n❓ ${nextQ}`);
      cloneReplySession(ctx.chatId, sent.key.id, nextS);
      return false;
    }
  });
}

const commands = [
  {
    name: 'trivia',
    aliases: ['t'],
    description: 'Start a trivia game',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game already running in this chat!');
      const game = {
        round: 0,
        currentPlayerIndex: 0,
        answerTimer: null
      };
      game.engine = new GameEngine(ctx, { 
        gameType: 'trivia', 
        minPlayers: 2,
        maxPlayers: 10, 
        onStart: () => sendTriviaQuestion(ctx, game), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'ttt',
    aliases: ['tictactoe'],
    description: 'Start a Tic-Tac-Toe game',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game already running in this chat!');
      const game = {};
      game.engine = new GameEngine(ctx, { 
        gameType: 'ttt', 
        maxPlayers: 2, 
        onStart: () => startTicTacToeGame(ctx, game), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'hangman',
    description: 'Start a Hangman game',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game running!');
      const game = {};
      game.engine = new GameEngine(ctx, { gameType: 'hangman', maxPlayers: 5, onStart: () => startHangmanGame(ctx, game), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'wordle',
    description: 'Start a Wordle game',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game running!');
      const game = {};
      game.engine = new GameEngine(ctx, { gameType: 'wordle', maxPlayers: 1, onStart: () => startWordleGame(ctx, game), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'riddle',
    description: 'Solve a riddle',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game running!');
      const game = {};
      game.engine = new GameEngine(ctx, { gameType: 'riddle', maxPlayers: 5, onStart: () => startRiddleGame(ctx, game), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'truth',
    description: 'Play Truth',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game running!');
      const game = {};
      game.engine = new GameEngine(ctx, { gameType: 'truth', maxPlayers: 10, onStart: () => startTruthDareGame(ctx, game, 'truth'), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'dare',
    description: 'Play Dare',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game running!');
      const game = {};
      game.engine = new GameEngine(ctx, { gameType: 'dare', maxPlayers: 10, onStart: () => startTruthDareGame(ctx, game, 'dare'), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  },
  {
    name: 'akinator',
    description: '🧞 Akinator game',
    category: 'games',
    execute: async (ctx) => {
      if (activeGames.has(ctx.chatId)) return ctx.reply('Game running!');
      const game = {};
      game.engine = new GameEngine(ctx, { gameType: 'akinator', maxPlayers: 1, onStart: () => startAkinatorGame(ctx, game), onEnd: () => activeGames.delete(ctx.chatId) });
      activeGames.set(ctx.chatId, game);
      await game.engine.startJoinPhase();
    }
  }
];

export default { name: 'games', commands };
