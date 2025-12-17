import express from 'express';
import http from 'http';
import { Server, Socket } from "socket.io";
import cors from 'cors';
import fs from 'fs';

const app = express();
app.use(cors());

const server = http.createServer(app);

// --- TYPES ---
interface Player {
  id: string;
  x: number;
  y: number;
  solanaAddress: string;
  color: string;
  size: number;
  clicks: number; 
  dailyClicks: number;
  coins: number;
  shrinkTimer?: NodeJS.Timeout; 
}

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  color: string;
  timestamp: number;
}

interface Coin {
    id: string;
    x: number;
    y: number;
}

const DB_FILE = './database.json';

// --- GAME DATA ---
// We use 'any' here temporarily to handle the data migration from number -> object
let gameData = {
    globalClicks: 0,
    highscores: {} as Record<string, any>, 
    backgroundColor: "#5D4037",
    dailyTracker: { date: new Date().toDateString(), counts: {} as Record<string, number> }
};

let activeCoin: Coin | null = null;

// Load Data
if (fs.existsSync(DB_FILE)) {
    try {
        const rawData = fs.readFileSync(DB_FILE, 'utf-8');
        gameData = { ...gameData, ...JSON.parse(rawData) };
    } catch (e) { console.error("Error loading DB:", e); }
}

const saveGame = () => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(gameData, null, 2)); } 
    catch (e) { console.error("Error saving DB:", e); }
};

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

let players: Record<string, Player> = {}; 

const COLOR_STAGES = [
    { threshold: 0, color: "#5D4037" },   
    { threshold: 10, color: "#A8D5BA" },  
    { threshold: 50, color: "#81C784" },  
    { threshold: 100, color: "#4CAF50" },  
    { threshold: 500, color: "#FFD54F" }, 
    { threshold: 1000, color: "#81D4FA" }, 
];

// Coin Spawner (50% chance every minute)
setInterval(() => {
    if (activeCoin) return; 
    if (Math.random() < 0.5) { 
        console.log("🪙 A RARE COIN HAS SPAWNED!");
        activeCoin = {
            id: Date.now().toString(),
            x: Math.random() * 90 + 5,
            y: Math.random() * 90 + 5
        };
        io.emit('coin_spawned', activeCoin);
    }
}, 60000);

const checkDailyReset = () => {
    const today = new Date().toDateString();
    if (gameData.dailyTracker.date !== today) {
        gameData.dailyTracker.date = today;
        gameData.dailyTracker.counts = {}; 
        saveGame();
        io.emit('daily_reset');
    }
};

setInterval(checkDailyReset, 60000);
setInterval(saveGame, 10000);

io.on('connection', (socket: Socket) => {
  console.log('Avocado joined:', socket.id);

  socket.on('join_game', (solanaAddress: string) => {
    const safeAddress = solanaAddress.substring(0, 15);
    checkDailyReset();

    // --- FIX: HANDLE OLD DATA FORMAT ---
    let savedStats = gameData.highscores[safeAddress];
    
    // If it's a number (Old Format), convert it to object (New Format)
    if (typeof savedStats === 'number') {
        savedStats = { clicks: savedStats, coins: 0 };
        gameData.highscores[safeAddress] = savedStats;
    } else if (!savedStats) {
        savedStats = { clicks: 0, coins: 0 };
    }

    const dailyScore = gameData.dailyTracker.counts[safeAddress] || 0;

    players[socket.id] = {
      id: socket.id,
      x: 50, y: 50,
      solanaAddress: safeAddress,
      color: `hsl(${Math.random() * 360}, 100%, 50%)`,
      size: 30,
      clicks: savedStats.clicks || 0,
      coins: savedStats.coins || 0,
      dailyClicks: dailyScore
    };
    
    socket.emit('init_state', { 
        players, 
        backgroundColor: gameData.backgroundColor, 
        globalClicks: gameData.globalClicks 
    });
    
    if (activeCoin) socket.emit('coin_spawned', activeCoin);

    socket.emit('your_daily_progress', dailyScore);
    socket.emit('leaderboard_update', gameData.highscores);
    socket.broadcast.emit('player_joined', players[socket.id]);
  });

  socket.on('mouse_move', (data) => {
    if (players[socket.id]) {
      const p = players[socket.id];
      p.x = data.x;
      p.y = data.y;
      socket.broadcast.emit('player_moved', { id: socket.id, x: data.x, y: data.y });

      if (activeCoin) {
          const dx = Math.abs(p.x - activeCoin.x);
          const dy = Math.abs(p.y - activeCoin.y);

          if (dx < 3 && dy < 3) {
              p.coins++;
              
              // Ensure DB structure is correct before writing
              if (typeof gameData.highscores[p.solanaAddress] !== 'object') {
                  gameData.highscores[p.solanaAddress] = { clicks: p.clicks, coins: 0 };
              }
              
              gameData.highscores[p.solanaAddress].clicks = p.clicks;
              gameData.highscores[p.solanaAddress].coins = p.coins;

              io.emit('coin_collected', { id: socket.id, coins: p.coins });
              io.emit('coin_vanished');
              activeCoin = null; 
              saveGame();
          }
      }
    }
  });

  socket.on('click_screen', () => {
    const p = players[socket.id];
    if (!p) return;
    checkDailyReset();
    if (p.dailyClicks >= 100) { socket.emit('error_limit_reached'); return; }

    gameData.globalClicks++;
    p.clicks++;
    p.dailyClicks++;

    // --- FIX: CRASH PROOF DATABASE UPDATE ---
    // 1. Check if the entry is missing or is an old "number" format
    if (!gameData.highscores[p.solanaAddress] || typeof gameData.highscores[p.solanaAddress] !== 'object') {
        // Recover old score if it was a number
        const oldScore = typeof gameData.highscores[p.solanaAddress] === 'number' 
            ? gameData.highscores[p.solanaAddress] 
            : 0;
            
        // Convert to new format
        gameData.highscores[p.solanaAddress] = { clicks: oldScore, coins: p.coins };
    }

    // 2. Now it is safe to update
    gameData.highscores[p.solanaAddress].clicks = p.clicks;
    // (Coins stay the same, updated only in mouse_move)

    gameData.dailyTracker.counts[p.solanaAddress] = p.dailyClicks;

    io.emit('score_update', { id: socket.id, clicks: p.clicks, globalClicks: gameData.globalClicks });
    socket.emit('your_daily_progress', p.dailyClicks);

    if (gameData.globalClicks % 5 === 0) io.emit('leaderboard_update', gameData.highscores);

    const stage = COLOR_STAGES.slice().reverse().find(s => gameData.globalClicks >= s.threshold);
    if (stage && stage.color !== gameData.backgroundColor) {
      gameData.backgroundColor = stage.color;
      io.emit('bg_update', gameData.backgroundColor);
      saveGame();
    }
  });

  socket.on('grow_avocado', () => { 
    const player = players[socket.id];
    if (player) {
      if (player.size < 150) {
        player.size += 5;
        io.emit('player_grew', { id: socket.id, size: player.size });
      }
      if (player.shrinkTimer) clearTimeout(player.shrinkTimer);
      player.shrinkTimer = setTimeout(() => {
        if (players[socket.id]) {
            players[socket.id].size = 30;
            io.emit('player_grew', { id: socket.id, size: 30 });
        }
      }, 3000);
    }
  });
  
  socket.on('send_message', (text) => { 
    if (!players[socket.id]) return;
    const newMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        text: text.substring(0, 100),
        sender: players[socket.id].solanaAddress,
        color: players[socket.id].color,
        timestamp: Date.now()
    };
    io.emit('new_message', newMessage);
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
        gameData.highscores[players[socket.id].solanaAddress] = { 
            clicks: players[socket.id].clicks, 
            coins: players[socket.id].coins 
        };
    }
    delete players[socket.id];
    io.emit('player_left', socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => { console.log(`>> AVOCADO SERVER RUNNING ON PORT ${PORT}`); });