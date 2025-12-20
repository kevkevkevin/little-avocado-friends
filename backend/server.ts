import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- 🍃 MONGODB SETUP ---
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/avocado";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB!"))
  .catch(err => console.error("❌ MongoDB Error:", err));

// 1. Define Schemas
const UserSchema = new mongoose.Schema({
    address: { type: String, required: true, unique: true },
    clicks: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    shards: { type: Number, default: 0 }
});

const GameStateSchema = new mongoose.Schema({
    id: { type: String, default: 'global' },
    weeklyShards: { type: Number, default: 100 },
    totalClicks: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);
const GameState = mongoose.model('GameState', GameStateSchema);

// --- GAME MEMORY STATE ---
interface Player {
  id: string;
  x: number;
  y: number;
  solanaAddress: string;
  color: string;
  size: number;
  clicks: number;
  coins: number;
  shards: number;
}

let players: Record<string, Player> = {};
let globalClicks = 0;
let weeklyShards = 100;
const BACKGROUND_COLORS = ["#5D4037", "#4E342E", "#3E2723", "#8D6E63", "#795548", "#2E7D32", "#1B5E20", "#BF360C"];

// --- INITIALIZE FROM DB ---
async function loadGameState() {
    try {
        let state = await GameState.findOne({ id: 'global' });
        if (!state) {
            state = await GameState.create({ id: 'global', weeklyShards: 100, totalClicks: 0 });
        }
        weeklyShards = state.weeklyShards;
        globalClicks = state.totalClicks;
        console.log(`💎 Loaded State: ${weeklyShards} Shards left, ${globalClicks} Total Clicks`);
    } catch (e) {
        console.log("⚠️ DB Load Error (might be connecting...)", e);
    }
}
loadGameState();

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join_game', async (address: string) => {
    // Find or Create User in DB
    let user = await User.findOne({ address });
    if (!user) {
        user = await User.create({ address, clicks: 0, coins: 0, shards: 0 });
    }

    players[socket.id] = {
      id: socket.id,
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      solanaAddress: address,
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      size: 30,
      clicks: user.clicks,
      coins: user.coins,
      shards: user.shards
    };

    // Get current highscores
    const allUsers = await User.find().sort({ clicks: -1 }).limit(10);
    const highscores: Record<string, any> = {};
    allUsers.forEach(u => {
        highscores[u.address] = { clicks: u.clicks, coins: u.coins, shards: u.shards };
    });

    socket.emit('init_state', { 
        players, 
        backgroundColor: BACKGROUND_COLORS[0], 
        globalClicks,
        shards: weeklyShards
    });
    
    io.emit('leaderboard_update', highscores);
    io.emit('player_joined', players[socket.id]);
  });

  socket.on('send_message', (msg: string) => {
    const player = players[socket.id];
    if (player) {
      io.emit('new_message', {
        id: Date.now().toString(),
        text: msg,
        sender: player.solanaAddress,
        color: player.color,
        timestamp: Date.now()
      });
    }
  });

  socket.on('mine_shard', async () => {
      if (weeklyShards > 0) {
          weeklyShards--;
          if (players[socket.id]) {
              players[socket.id].shards++;
              // Save immediately
              await User.updateOne({ address: players[socket.id].solanaAddress }, { $inc: { shards: 1 } });
              await GameState.updateOne({ id: 'global' }, { weeklyShards: weeklyShards });
              
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

  socket.on('click_screen', () => {
    if (players[socket.id]) {
      players[socket.id].clicks++;
      globalClicks++;

      if (globalClicks % 50 === 0) {
          const randomColor = BACKGROUND_COLORS[Math.floor(Math.random() * BACKGROUND_COLORS.length)];
          io.emit('bg_update', randomColor);
      }

      io.emit('score_update', { 
          id: socket.id, 
          clicks: players[socket.id].clicks, 
          globalClicks 
      });
    }
  });

  socket.on('disconnect', async () => {
    if (players[socket.id]) {
        // Save user stats on disconnect
        await User.updateOne(
            { address: players[socket.id].solanaAddress }, 
            { clicks: players[socket.id].clicks }
        );
        delete players[socket.id];
        io.emit('player_left', socket.id);
    }
  });
});

// Periodic Global Save
setInterval(async () => {
    await GameState.updateOne({ id: 'global' }, { totalClicks: globalClicks });
}, 60000);

const PORT = process.env.PORT || 3001; 
server.listen(PORT, () => {
  console.log(`>> AVOCADO SERVER RUNNING ON PORT ${PORT}`);
});