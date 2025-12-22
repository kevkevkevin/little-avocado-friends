import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://littleavocadofriends.vercel.app", 
  "http://localhost:3000"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// --- 🍃 MONGODB SETUP ---
const MONGO_URI = process.env.MONGO_URI || "";
let isDbConnected = false;

if (!MONGO_URI) {
    console.error("❌ FATAL: MONGO_URI is missing.");
} else {
    mongoose.connect(MONGO_URI)
      .then(() => {
          console.log("✅ Connected to MongoDB!");
          isDbConnected = true;
          loadGameState();
      })
      .catch(err => console.error("❌ MongoDB Connection Error:", err));
}

// 1. Define Schemas
const UserSchema = new mongoose.Schema({
    address: { type: String, required: true, unique: true },
    username: { type: String, default: "" },
    clicks: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    shards: { type: Number, default: 0 },
    trashCollected: { type: Number, default: 0 },
    dailyClicks: { type: Number, default: 0 },
    lastDailyDate: { type: String, default: "" }
});

const GameStateSchema = new mongoose.Schema({
    id: { type: String, default: 'global' },
    weeklyShards: { type: Number, default: 100 },
    totalClicks: { type: Number, default: 0 },
    currentBgColor: { type: String, default: "#5D4037" }
});

const User = mongoose.model('User', UserSchema);
const GameState = mongoose.model('GameState', GameStateSchema);

// --- GAME MEMORY STATE ---
interface Player {
  id: string;
  x: number;
  y: number;
  solanaAddress: string;
  username: string;
  color: string;
  size: number;
  clicks: number;
  coins: number;
  shards: number;
  trashCollected: number;
  dailyClicks: number;
}

interface Trash {
    id: string;
    x: number;
    y: number;
}

let players: Record<string, Player> = {};
let trashItems: Trash[] = []; 
let globalClicks = 0;
let weeklyShards = 100;
let currentBgColor = "#5D4037"; 

const BACKGROUND_COLORS = [
    "#5D4037", "#4E342E", "#3E2723", "#8D6E63", "#795548", 
    "#2E7D32", "#1B5E20", "#BF360C", "#00695C", "#AD1457", 
    "#6A1B9A", "#283593", "#C62828", "#F9A825"
];

// --- INITIALIZE ---
async function loadGameState() {
    if (!isDbConnected) return;
    try {
        let state = await GameState.findOne({ id: 'global' });
        if (!state) {
            state = await GameState.create({ 
                id: 'global', 
                weeklyShards: 100, 
                totalClicks: 0, // Fresh start logic
                currentBgColor: "#5D4037" 
            });
        }
        weeklyShards = state.weeklyShards;
        globalClicks = state.totalClicks;
        currentBgColor = state.currentBgColor || "#5D4037"; 
        console.log(`💎 Loaded: ${globalClicks} Clicks`);
    } catch (e) { console.log("⚠️ DB Load Error (Non-fatal)", e); }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join_game', async (address: string) => {
    let userClicks = 0, userCoins = 0, userShards = 0, userDaily = 0, userTrash = 0;
    let userDisplayName = "";

    if (isDbConnected) {
        try {
            let user = await User.findOne({ address });
            const today = new Date().toDateString();

            if (!user) {
                user = await User.create({ address, username: "", clicks: 0, coins: 0, shards: 0, trashCollected: 0, dailyClicks: 0, lastDailyDate: today });
            } else {
                if (user.lastDailyDate !== today) {
                    user.dailyClicks = 0;
                    user.lastDailyDate = today;
                    await user.save();
                }
            }
            userClicks = user.clicks;
            userCoins = user.coins;
            userShards = user.shards;
            userTrash = user.trashCollected || 0;
            userDaily = user.dailyClicks;
            userDisplayName = user.username || "";
        } catch (e) { console.error("Error loading user:", e); }
    }

    players[socket.id] = {
      id: socket.id,
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      solanaAddress: address,
      username: userDisplayName, 
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      size: 30,
      clicks: userClicks,
      coins: userCoins,
      shards: userShards,
      trashCollected: userTrash,
      dailyClicks: userDaily
    };

    socket.emit('your_daily_progress', userDaily);

    socket.emit('init_state', { 
        players, 
        backgroundColor: currentBgColor, 
        globalClicks,
        shards: weeklyShards
    });
    
    socket.emit('trash_sync', trashItems);

    if (isDbConnected) {
        try {
            const allUsers = await User.find().sort({ clicks: -1 }).limit(10);
            const highscores: Record<string, any> = {};
            allUsers.forEach(u => {
                highscores[u.address] = { 
                    clicks: u.clicks, 
                    coins: u.coins, 
                    shards: u.shards, 
                    trashCollected: u.trashCollected || 0,
                    username: u.username 
                };
            });
            socket.emit('leaderboard_update', highscores);
        } catch(e) {}
    }
    
    io.emit('player_joined', players[socket.id]);
  });

  socket.on('set_username', async (name: string) => {
      if (!name) return;
      const cleanName = name.trim().slice(0, 11); 
      if (players[socket.id]) {
          players[socket.id].username = cleanName;
          io.emit('player_updated', { id: socket.id, username: cleanName });
          if (isDbConnected) {
              await User.updateOne({ address: players[socket.id].solanaAddress }, { username: cleanName });
          }
      }
  });

  socket.on('send_message', (msg: string) => {
    const player = players[socket.id];
    if (player) {
      io.emit('new_message', {
        id: Date.now().toString(),
        text: msg,
        sender: player.username || player.solanaAddress,
        color: player.color,
        timestamp: Date.now()
      });
    }
  });

  socket.on('grow_avocado', () => {
    if (players[socket.id]) {
        players[socket.id].size = 60; 
        io.emit('player_grew', { id: socket.id, size: 60 });
        setTimeout(() => {
            if (players[socket.id]) {
                players[socket.id].size = 30;
                io.emit('player_grew', { id: socket.id, size: 30 });
            }
        }, 3000);
    }
  });

  socket.on('collect_trash', (trashId: string) => {
      const index = trashItems.findIndex(t => t.id === trashId);
      if (index !== -1) {
          trashItems.splice(index, 1); 
          if (players[socket.id]) {
              players[socket.id].trashCollected += 1;
              if (isDbConnected) {
                  User.updateOne({ address: players[socket.id].solanaAddress }, { $inc: { trashCollected: 1 } }).catch(()=>{});
              }
              io.emit('trash_collected', { 
                  trashId, 
                  collectorId: socket.id, 
                  newCount: players[socket.id].trashCollected 
              });
          }
      }
  });

  socket.on('mine_shard', async () => {
      if (weeklyShards > 0) {
          weeklyShards--;
          if (players[socket.id]) {
              players[socket.id].shards++;
              if (isDbConnected) {
                  await User.updateOne({ address: players[socket.id].solanaAddress }, { $inc: { shards: 1 } }).catch(()=>{});
                  await GameState.updateOne({ id: 'global' }, { weeklyShards: weeklyShards }).catch(()=>{});
              }
              io.emit('shard_collected', { id: socket.id, shards: players[socket.id].shards });
          }
          io.emit('mining_update', weeklyShards);
      } else {
          socket.emit('mining_empty');
      }
  });

  socket.on('mouse_move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      socket.broadcast.emit('player_moved', { id: socket.id, x: data.x, y: data.y });
    }
  });

  socket.on('click_screen', async () => {
    const p = players[socket.id];
    if (p) {
      if (p.dailyClicks >= 100) { 
          socket.emit('error_limit_reached');
          return; 
      }
      p.clicks++;
      p.dailyClicks++;
      globalClicks++;

      if (globalClicks % 50 === 0) {
          const randomColor = BACKGROUND_COLORS[Math.floor(Math.random() * BACKGROUND_COLORS.length)];
          currentBgColor = randomColor; 
          io.emit('bg_update', randomColor); 
          if(isDbConnected) {
             await GameState.updateOne({ id: 'global' }, { currentBgColor: randomColor }).catch(()=>{});
          }
      }

      io.emit('score_update', { 
          id: socket.id, 
          clicks: p.clicks, 
          globalClicks,
          bgColor: currentBgColor 
      });

      if (isDbConnected) {
          try {
             await User.updateOne(
                 { address: p.solanaAddress }, 
                 { $inc: { clicks: 1, dailyClicks: 1 } }
             );
          } catch(e) {}
      }
    }
  });

  socket.on('coin_spawned', (coin) => io.emit('coin_spawned', coin));

  socket.on('disconnect', () => {
    const player = players[socket.id];
    if (player) {
        delete players[socket.id];
        io.emit('player_left', socket.id);
        if (isDbConnected) {
            User.updateOne(
                { address: player.solanaAddress }, 
                { clicks: player.clicks }
            ).catch(err => console.log("Save on disconnect failed", err));
        }
    }
  });
});

// --- ☠️ THE GAME LOOP ---
setInterval(async () => {
    // 🆕 RESTRICT SPAWNING: ONLY IF SCORE >= 100
    if (globalClicks >= 100 && trashItems.length < 10 && Math.random() < 0.1) {
        const newTrash = {
            id: Date.now().toString(),
            x: Math.random() * 80 + 10,
            y: Math.random() * 80 + 10
        };
        trashItems.push(newTrash);
        io.emit('trash_spawned', newTrash);
    }

    if (trashItems.length > 0) {
        const damage = trashItems.length * 1; 
        globalClicks = Math.max(0, globalClicks - damage);
        
        io.emit('score_damage', { globalClicks, damage });

        if (globalClicks <= 0) {
            console.log("💀 GAME OVER - WIPING DATA");
            globalClicks = 1000; // Reset to 1000 buffer
            trashItems = []; 
            Object.values(players).forEach(p => {
                p.clicks = 0; p.coins = 0; p.shards = 0; p.trashCollected = 0;
            });
            if (isDbConnected) {
                await User.updateMany({}, { clicks: 0, coins: 0, shards: 0, trashCollected: 0 });
                await GameState.updateOne({ id: 'global' }, { totalClicks: 1000 });
            }
            io.emit('game_over_reset');
        }
    }

    if (isDbConnected) {
        try {
            await GameState.updateOne({ id: 'global' }, { totalClicks: globalClicks });
        } catch(e) {}
    }
}, 1000); 

app.get('/', (req, res) => { res.send('🥑 Avocado Server is RUNNING!'); });

const PORT = process.env.PORT || 3001; 
server.listen(PORT, () => {
  console.log(`>> AVOCADO SERVER RUNNING ON PORT ${PORT}`);
});