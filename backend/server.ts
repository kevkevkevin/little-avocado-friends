import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- DATABASE SETUP ---
const DB_FILE = path.join(__dirname, 'database.json');

interface Database {
  highscores: Record<string, { clicks: number, coins: number, shards: number }>;
  weeklyShards: number;
  lastReset: string;
}

const defaultDB: Database = { 
    highscores: {}, 
    weeklyShards: 100, 
    lastReset: new Date().toDateString() 
};

// Load DB
let db: Database = defaultDB;
if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    db = { ...defaultDB, ...JSON.parse(data) };
  } catch (e) { console.log("Error loading DB, using default"); }
}

const saveDB = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
};

// --- GAME STATE ---
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
const BACKGROUND_COLORS = ["#5D4037", "#4E342E", "#3E2723", "#8D6E63", "#795548"];

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('join_game', (address: string) => {
    // 1. Create Player
    players[socket.id] = {
      id: socket.id,
      x: Math.random() * 80 + 10,
      y: Math.random() * 80 + 10,
      solanaAddress: address,
      color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      size: 30,
      clicks: 0,
      coins: db.highscores[address]?.coins || 0,
      shards: db.highscores[address]?.shards || 0
    };

    // 2. Sync Highscores
    if (!db.highscores[address]) {
        db.highscores[address] = { clicks: 0, coins: 0, shards: 0 };
    } else {
        players[socket.id].clicks = db.highscores[address].clicks;
    }

    // 3. Send Init Data
    socket.emit('init_state', { 
        players, 
        backgroundColor: BACKGROUND_COLORS[0], 
        globalClicks,
        shards: db.weeklyShards
    });
    
    io.emit('player_joined', players[socket.id]);
  });

  // --- 💬 CHAT LOGIC (RESTORED) ---
  socket.on('send_message', (msg: string) => {
    const player = players[socket.id];
    if (player) {
      const chatMsg = {
        id: Date.now().toString(),
        text: msg,
        sender: player.solanaAddress,
        color: player.color,
        timestamp: Date.now()
      };
      io.emit('new_message', chatMsg);
    }
  });

  // --- 💎 MINING LOGIC ---
  socket.on('mine_shard', () => {
      if (db.weeklyShards > 0) {
          db.weeklyShards--;
          
          if (players[socket.id]) {
              players[socket.id].shards = (players[socket.id].shards || 0) + 1;
              const addr = players[socket.id].solanaAddress;
              if (db.highscores[addr]) {
                  db.highscores[addr].shards = (db.highscores[addr].shards || 0) + 1;
              }
              io.emit('shard_collected', { id: socket.id, shards: players[socket.id].shards });
          }

          saveDB(); 
          io.emit('mining_update', db.weeklyShards);
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
      
      const addr = players[socket.id].solanaAddress;
      if(db.highscores[addr]) db.highscores[addr].clicks++;
      saveDB();

      io.emit('score_update', { 
          id: socket.id, 
          clicks: players[socket.id].clicks, 
          globalClicks 
      });
      io.emit('leaderboard_update', db.highscores);
    }
  });

  socket.on('coin_spawned', (coin) => io.emit('coin_spawned', coin));

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('player_left', socket.id);
  });
});

const PORT = process.env.PORT || 3001; 
server.listen(PORT, () => {
  console.log(`>> AVOCADO SERVER RUNNING ON PORT ${PORT}`);
});