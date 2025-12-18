"use client";

import { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { usePrivy } from '@privy-io/react-auth';
import confetti from 'canvas-confetti';

// --- TYPES ---
interface Player {
  id: string;
  x: number;
  y: number;
  solanaAddress: string;
  color: string;
  size: number;
  clicks: number;
  coins: number;
}
interface InitState { players: Record<string, Player>; backgroundColor: string; globalClicks: number; }
interface Ripple { id: number; x: number; y: number; }
interface FloatingText { id: number; x: number; y: number; text: string; }
interface ChatMessage { id: string; text: string; sender: string; color: string; timestamp: number; }
interface Coin { id: string; x: number; y: number; }

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
let socket: Socket | undefined;

const getRank = (clicks: number) => {
    if (clicks < 10) return "Baby Seed 🌱";
    if (clicks < 50) return "Tiny Sprout 🌿";
    if (clicks < 100) return "Fresh Avocado 🥑";
    if (clicks < 500) return "Super Fruit ✨";
    return "Guacamole God 👑";
};

export default function Home() {
  const { login, authenticated, user, logout } = usePrivy();
  const [joined, setJoined] = useState<boolean>(false);
  
  // Game State
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [highscores, setHighscores] = useState<Record<string, { clicks: number, coins: number }>>({}); 
  const [bgColor, setBgColor] = useState<string>("#5D4037");
  const [clicks, setClicks] = useState<number>(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [floaters, setFloaters] = useState<FloatingText[]>([]);
  
  // Coin State
  const [activeCoin, setActiveCoin] = useState<Coin | null>(null);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null); 
  const lastMoveTime = useRef<number>(0);
  
  // UI State
  const [musicPlaying, setMusicPlaying] = useState(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [tasks, setTasks] = useState({ login: false, click: false, share: false });
  const [dailyCount, setDailyCount] = useState<number>(0);
  const MAX_DAILY = 100;

  const playSound = (type: 'click' | 'levelup' | 'chat' | 'coin') => {
    try {
        const audio = new Audio(`/sounds/${type}.mp3`);
        audio.volume = 0.4; 
        audio.play().catch(() => {});
    } catch (err) { console.error(err); }
  };

  const toggleMusic = () => {
    if (!bgmRef.current) {
        bgmRef.current = new Audio('/sounds/bgm.mp3');
        bgmRef.current.loop = true;
        bgmRef.current.volume = 0.3; 
    }
    if (musicPlaying) bgmRef.current.pause();
    else bgmRef.current.play().catch((e) => console.log("Interaction needed"));
    setMusicPlaying(!musicPlaying);
  };

  // --- DAILY TASKS ---
  useEffect(() => {
    const today = new Date().toDateString(); 
    const savedDate = localStorage.getItem('avocado_last_login');
    const savedTasks = JSON.parse(localStorage.getItem('avocado_tasks') || '{}');

    if (savedDate !== today) {
        localStorage.setItem('avocado_last_login', today);
        setTasks({ login: true, click: false, share: false });
        localStorage.setItem('avocado_tasks', JSON.stringify({ login: true, click: false, share: false }));
    } else {
        setTasks(savedTasks);
    }
  }, []);

  const updateTask = (task: 'click' | 'share') => {
    if (tasks[task]) return; 
    const newTasks = { ...tasks, [task]: true };
    setTasks(newTasks);
    localStorage.setItem('avocado_tasks', JSON.stringify(newTasks));
    confetti({ particleCount: 50, spread: 50, origin: { y: 0.5 } });
  };

  const handleShare = () => {
    updateTask('share');
    window.open("https://twitter.com/intent/tweet?text=Growing%20my%20Avocado!%20%F0%9F%A5%91", "_blank");
  };

  // --- MAIN SOCKET CONNECTION ---
  useEffect(() => {
    socket = io(SERVER_URL);

    // FIX: Auto-Rejoin logic if server restarts
    socket.on('connect', () => {
        console.log("🔌 Connected to server ID:", socket?.id);
        if (user?.wallet?.address) {
            console.log("🔄 Auto-joining game as:", user.wallet.address);
            socket?.emit('join_game', user.wallet.address);
            setJoined(true);
        }
    });

    socket.on('init_state', (data: InitState) => {
      setPlayers(data.players);
      setBgColor(data.backgroundColor);
      setClicks(data.globalClicks);
    });

    socket.on('player_joined', (player: Player) => {
      setPlayers((prev) => ({ ...prev, [player.id]: player }));
    });

    socket.on('player_moved', (data) => {
      setPlayers((prev) => {
        if (!prev[data.id]) return prev;
        return { ...prev, [data.id]: { ...prev[data.id], x: data.x, y: data.y } };
      });
    });

    socket.on('score_update', (data: { id: string, clicks: number, globalClicks: number }) => {
        setClicks(data.globalClicks); 
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], clicks: data.clicks } };
        });
    });

    // COIN LOGIC
    socket.on('coin_spawned', (coin: Coin) => {
        setActiveCoin(coin);
        playSound('chat'); 
    });

    socket.on('coin_vanished', () => {
        setActiveCoin(null);
    });

    socket.on('coin_collected', (data: { id: string, coins: number }) => {
        if (data.id === socket?.id) {
            playSound('coin');
            confetti({ colors: ['#FFD700'] }); 
        }
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], coins: data.coins } };
        });
    });

    socket.on('leaderboard_update', (data: Record<string, { clicks: number, coins: number }>) => { setHighscores(data); });
    
    socket.on('player_grew', (data: { id: string, size: number }) => {
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], size: data.size } };
        });
    });
    
    socket.on('player_left', (id: string) => {
      setPlayers((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
    });
    
    socket.on('bg_update', (color: string) => {
        setBgColor(color);
        playSound('levelup');
        confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, colors: ['#FFD54F', '#81C784', '#FFFFFF', '#4CAF50'] });
    });
    
    socket.on('new_message', (msg: ChatMessage) => {
        console.log("📩 Chat received:", msg);
        setMessages((prev) => [...prev.slice(-49), msg]); 
        playSound('chat');
    });

    socket.on('your_daily_progress', (count: number) => { setDailyCount(count); });
    socket.on('error_limit_reached', () => { alert("🥑 Daily limit reached!"); });
    socket.on('daily_reset', () => { setDailyCount(0); });

    return () => { if (socket) socket.disconnect(); };
  }, [user]); // We depend on 'user' so we can auto-rejoin correctly

  // Keyboard Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!joined || !socket) return;
        if (document.activeElement?.tagName === 'INPUT') return;
        const validKeys = [' ', 'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (validKeys.includes(e.key)) {
            if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
            socket.emit('grow_avocado');
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [joined]);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleJoin = () => {
    const address = user?.wallet?.address;
    if (address && socket) {
      console.log("🟢 Manual Join Triggered");
      socket.emit('join_game', address);
      setJoined(true);
      playSound('chat');
      if (!musicPlaying) toggleMusic();
    }
  };

  const handleInputMove = (x: number, y: number) => {
      if (!joined || !socket) return;
      const now = Date.now();
      if (now - lastMoveTime.current > 30) {
        const xPercent = (x / window.innerWidth) * 100;
        const yPercent = (y / window.innerHeight) * 100;
        if (socket?.id) {
            setPlayers((prev) => {
                if (!prev[socket?.id!]) return prev;
                return { ...prev, [socket!.id!]: { ...prev[socket!.id!], x: xPercent, y: yPercent } };
            });
        }
        socket.emit('mouse_move', { x: xPercent, y: yPercent });
        lastMoveTime.current = now;
      }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => { handleInputMove(e.clientX, e.clientY); };
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => { handleInputMove(e.touches[0].clientX, e.touches[0].clientY); };

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (!joined || !socket) return;
    const target = e.target as HTMLElement;
    if (target.closest && (target.closest('.chat-container') || target.closest('.music-btn') || target.closest('.task-btn') || target.closest('.leaderboard-btn'))) return;

    if (dailyCount >= MAX_DAILY) return; 

    playSound('click');
    if (!tasks.click) updateTask('click');

    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const newRipple = { id: Date.now(), x: clientX, y: clientY };
    setRipples((prev) => [...prev, newRipple]);
    setTimeout(() => setRipples((prev) => prev.filter(r => r.id !== newRipple.id)), 600);

    const newFloater = { id: Date.now(), x: clientX, y: clientY, text: "+1" };
    setFloaters((prev) => [...prev, newFloater]);
    setTimeout(() => setFloaters((prev) => prev.filter(f => f.id !== newFloater.id)), 1000);

    socket.emit('click_screen');
    setDailyCount(prev => prev + 1);
  };

  const sendChat = (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      
      console.log("📤 Sending Chat:", inputMsg);

      if (inputMsg.trim().length === 0 || !socket) {
          console.log("❌ Chat failed: Empty or No Socket");
          return;
      }
      
      socket.emit('send_message', inputMsg);
      console.log("✅ Chat sent!");
      setInputMsg(""); 
  };

  const myPlayer = socket?.id ? players[socket.id] : null;

  if (!joined) {
    return (
      <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#FFF9C4', color: '#5D4037', fontFamily: "'Fredoka', sans-serif" }}>
        <style jsx global>{`@import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap'); body { font-family: 'Fredoka', sans-serif; }`}</style>
        <div style={{ fontSize: '5rem', marginBottom: '10px' }}>🥑</div>
        <h1 style={{ fontSize: '3rem', marginBottom: '10px', color: '#4CAF50', textShadow: '2px 2px 0px #FFF' }}>Little Avocado Friends</h1>
        <p style={{ marginBottom: '40px', fontSize: '1.2rem', color: '#795548' }}>Connect your wallet to join the party!</p>
        {!authenticated ? (
            <button onClick={login} className="bouncy-btn" style={{ padding: '15px 40px', fontSize: '1.2rem', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '50px', fontWeight: 'bold', boxShadow: '0 5px 0 #388E3C' }}>Log in with Privy</button>
        ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                <div style={{ background: '#FFF', padding: '10px 20px', borderRadius: '20px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>🌱 Connected: {user?.wallet?.address.slice(0, 4)}...{user?.wallet?.address.slice(-4)}</div>
                <button onClick={handleJoin} className="bouncy-btn" style={{ padding: '15px 50px', fontSize: '1.5rem', cursor: 'pointer', background: '#FFD54F', border: 'none', borderRadius: '50px', fontWeight: 'bold', color: '#5D4037', boxShadow: '0 5px 0 #FFA000' }}>BECOME AN AVOCADO! 🥑</button>
                <button onClick={logout} style={{ background: 'transparent', border: 'none', color: '#999', cursor: 'pointer', textDecoration: 'underline' }}>Disconnect</button>
            </div>
        )}
      </main>
    );
  }

  return (
    <main 
      onMouseMove={handleMouseMove} onClick={handleClick} onTouchMove={handleTouchMove} onTouchStart={handleClick}
      style={{ width: '100vw', height: '100vh', backgroundColor: bgColor, position: 'relative', overflow: 'hidden', cursor: dailyCount >= MAX_DAILY ? "not-allowed" : "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\"><text y=\"20\" font-size=\"20\">🥑</text></svg>'), auto", transition: 'background-color 1.5s ease', touchAction: 'none', fontFamily: "'Fredoka', sans-serif" }}
    >
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap');
        .bouncy-btn:active { transform: translateY(4px); box-shadow: 0 1px 0 #388E3C !important; }
        .music-btn:hover, .task-btn:hover, .leaderboard-btn:hover { transform: scale(1.1); }
        @keyframes rippleEffect { 0% { width: 0px; height: 0px; opacity: 1; } 100% { width: 120px; height: 120px; opacity: 0; } }
        @keyframes floatUp { 0% { transform: translateY(0px); opacity: 1; } 100% { transform: translateY(-50px); opacity: 0; } }
        @keyframes float { 0% { transform: translateY(0px) translateX(-50%) scale(1, 1); } 50% { transform: translateY(-10px) translateX(-50%) scale(1.1, 0.9); } 100% { transform: translateY(0px) translateX(-50%) scale(1, 1); } }
        @keyframes spin { 0% { transform: translate(-50%, -50%) rotateY(0deg); } 100% { transform: translate(-50%, -50%) rotateY(360deg); } }
        
        .chat-box { width: 320px; height: 220px; left: 20px; bottom: 20px; }
        .scoreboard { top: 20px; left: 20px; }
        @media (max-width: 600px) {
            .chat-box { width: 250px !important; height: 150px !important; left: 10px !important; bottom: 10px !important; font-size: 12px; }
            .scoreboard { top: 10px !important; left: 10px !important; transform: scale(0.85); transform-origin: top left; }
        }
      `}</style>

      {/* TOP RIGHT BUTTONS */}
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 30, display: 'flex', gap: '10px' }}>
        <button onClick={() => setShowTasks(!showTasks)} className="task-btn" style={{ background: '#FFD54F', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📝</button>
        <button onClick={() => setShowLeaderboard(!showLeaderboard)} className="leaderboard-btn" style={{ background: '#81D4FA', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🏆</button>
        <button onClick={toggleMusic} className="music-btn" style={{ background: 'white', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{musicPlaying ? '🎵' : '🔇'}</button>
      </div>

      {showTasks && (
          <div style={{ position: 'absolute', top: 80, right: 20, width: '250px', background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 8px 30px rgba(0,0,0,0.2)', zIndex: 40, border: '4px solid #FFD54F' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#5D4037' }}>Daily Tasks 📅</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: tasks.login ? '#4CAF50' : '#999' }}><span>1. Log in</span><span>{tasks.login ? '✅' : '⬜'}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: tasks.click ? '#4CAF50' : '#999' }}><span>2. Click once</span><span>{tasks.click ? '✅' : '⬜'}</span></div>
                  <div onClick={handleShare} style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', color: tasks.share ? '#4CAF50' : '#2196F3', fontWeight: 'bold' }}><span>3. Share 🐦</span><span>{tasks.share ? '✅' : '↗️'}</span></div>
              </div>
          </div>
      )}
      
      {showLeaderboard && (
          <div style={{ position: 'absolute', top: 80, right: 80, width: '250px', background: 'white', padding: '15px', borderRadius: '15px', boxShadow: '0 8px 30px rgba(0,0,0,0.2)', zIndex: 40, border: '4px solid #81D4FA' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#5D4037' }}>Top Avocados 🏆</h3>
              {Object.entries(highscores).sort(([,a], [,b]) => b.clicks - a.clicks).slice(0, 5).map(([addr, stats], i) => (
                  <div key={addr} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '5px 0', borderBottom: '1px solid #EEE' }}>
                      <span style={{ fontWeight: 'bold', color: i===0 ? '#FFD700' : '#5D4037' }}>#{i+1} {addr.slice(0,4)}</span>
                      <span>
                        <span style={{ color: '#4CAF50', marginRight: '5px' }}>{stats.clicks}</span>
                        <span style={{ color: '#FFD700' }}>{stats.coins > 0 ? `(${stats.coins}🪙)` : ''}</span>
                      </span>
                  </div>
              ))}
          </div>
      )}

      {/* SCOREBOARD */}
      <div className="scoreboard" style={{ position: 'absolute', pointerEvents: 'none', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(8px)', padding: '10px 20px', borderRadius: '20px', border: '2px solid rgba(255,255,255,0.6)', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: 0, color: '#3E2723', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>Community Score</h2>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4CAF50', textShadow: '2px 2px 0 white' }}>{clicks}</div>
        </div>
        
        {myPlayer && (
            <div style={{ background: '#FFF9C4', padding: '10px 20px', borderRadius: '20px', border: '2px solid #FFF', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
                <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#5D4037', marginBottom: '2px', fontWeight: 'bold' }}><span>Energy ⚡</span><span>{Math.max(0, MAX_DAILY - dailyCount)} left</span></div>
                    <div style={{ width: '100%', height: '8px', background: '#E0E0E0', borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (dailyCount / MAX_DAILY) * 100)}%`, height: '100%', background: dailyCount >= MAX_DAILY ? '#FF5252' : '#29B6F6', transition: 'width 0.2s' }} /></div>
                </div>
                <h3 style={{ margin: 0, color: '#FBC02D', fontSize: '14px', textTransform: 'uppercase' }}>My Contribution</h3>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#5D4037' }}>{myPlayer.clicks}</div>
                <div style={{ fontSize: '12px', color: '#8D6E63', marginTop: '5px', fontWeight: 'bold' }}>{getRank(myPlayer.clicks)}</div>
                
                {/* COIN DISPLAY */}
                <div style={{ marginTop: '10px', background: '#FFF', padding: '5px 10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '18px' }}>🪙</span>
                    <span style={{ fontWeight: 'bold', color: '#FFA000' }}>Coins Collected: {myPlayer.coins}</span>
                </div>
            </div>
        )}
      </div>

      {/* CHAT BOX */}
      <div className="chat-container chat-box" style={{ position: 'absolute', background: 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(8px)', borderRadius: '20px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', border: '2px solid rgba(255,255,255,0.5)', zIndex: 20, overflow: 'hidden', transition: 'all 0.3s ease' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px', color: '#5D4037', fontSize: 'inherit', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {messages.map((msg) => ( <div key={msg.id} style={{ background: 'rgba(255,255,255,0.6)', padding: '4px 8px', borderRadius: '8px', alignSelf: 'flex-start' }}><span style={{ color: msg.color, fontWeight: 'bold' }}>{msg.sender.slice(0,4)}: </span><span>{msg.text}</span></div> ))}
              <div ref={chatBottomRef} />
          </div>
          <form onSubmit={sendChat} style={{ borderTop: '1px solid rgba(255,255,255,0.3)', display: 'flex', background: 'rgba(255,255,255,0.2)' }}>
              <input value={inputMsg} onChange={(e) => setInputMsg(e.target.value)} placeholder="Say hi! 🥑" style={{ flex: 1, background: 'transparent', border: 'none', color: '#5D4037', padding: '10px', outline: 'none', fontSize: 'inherit', fontWeight: '600' }} />
              <button type="submit" style={{ background: 'rgba(129, 199, 132, 0.9)', border: 'none', color: 'white', fontWeight: 'bold', padding: '0 15px', cursor: 'pointer' }}>SEND</button>
          </form>
      </div>

      {ripples.map(ripple => ( <div key={ripple.id} style={{ position: 'absolute', left: ripple.x, top: ripple.y, width: '0px', height: '0px', borderRadius: '50%', border: '4px solid rgba(255, 255, 255, 0.6)', transform: 'translate(-50%, -50%)', animation: 'rippleEffect 0.5s linear forwards', pointerEvents: 'none' }} /> ))}
      {floaters.map(f => ( <div key={f.id} style={{ position: 'absolute', left: f.x, top: f.y, color: '#4CAF50', fontWeight: 'bold', fontSize: '24px', pointerEvents: 'none', textShadow: '2px 2px 0px white', animation: 'floatUp 1s ease-out forwards' }}>{f.text}</div> ))}

      {activeCoin && (
          <div style={{ position: 'absolute', left: `${activeCoin.x}%`, top: `${activeCoin.y}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'none', fontSize: '40px', animation: 'spin 2s linear infinite' }}>🪙</div>
      )}

      {Object.values(players).map((player) => (
        <div key={player.id} style={{ position: 'absolute', left: `${player.x}%`, top: `${player.y}%`, transform: 'translateX(-50%)', pointerEvents: 'none', transition: 'left 0.1s linear, top 0.1s linear, font-size 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 5, fontSize: `${player.size || 30}px` }}>
          <div style={{ background: 'white', padding: '2px 8px', borderRadius: '10px', color: '#5D4037', fontSize: '10px', fontWeight: 'bold', marginBottom: '2px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }}>{player.solanaAddress.slice(0, 4)}</div>
          <div style={{ fontSize: '1em', filter: 'drop-shadow(0 4px 4px rgba(0,0,0,0.2))', animation: 'float 2s ease-in-out infinite' }}>🥑</div>
          {player.clicks > 0 && <div style={{ fontSize: '10px', color: '#FFF', background: '#81C784', padding: '0 4px', borderRadius: '4px', marginTop: '-5px' }}>{player.clicks}</div>}
        </div> 
      ))}
    </main>
  );
}