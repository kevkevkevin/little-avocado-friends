/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { usePrivy } from '@privy-io/react-auth';
import confetti from 'canvas-confetti';

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
}
interface Trash { id: string; x: number; y: number; }
interface InitState { players: Record<string, Player>; backgroundColor: string; globalClicks: number; shards: number; }
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

const CHRISTMAS_COLORS = ['#D32F2F', '#388E3C', '#FFFFFF', '#FFD700'];

const PLAYLIST = [
    { src: '/sounds/bgm.mp3', name: 'Cozy Xmas' },
    { src: '/sounds/bgm2.mp3', name: 'Snowy Beats' },
    { src: '/sounds/bgm3.mp3', name: 'Jingle Jam' }
];

export default function Home() {
  const { login, authenticated, user, logout } = usePrivy();
  const [joined, setJoined] = useState<boolean>(false);
  
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [highscores, setHighscores] = useState<Record<string, { clicks: number, coins: number, shards: number, username?: string }>>({}); 
  const [bgColor, setBgColor] = useState<string>("#5D4037");
  const [clicks, setClicks] = useState<number>(0);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [floaters, setFloaters] = useState<FloatingText[]>([]);
  
  const [activeCoin, setActiveCoin] = useState<Coin | null>(null);
  const [trashItems, setTrashItems] = useState<Trash[]>([]); 
  const [damageFlash, setDamageFlash] = useState(false); 
  
  // 🆕 WARNING POPUP STATE
  const [showWarning, setShowWarning] = useState(false);
  
  // We use a Ref to track if we've seen it, so we can check it inside socket listeners without dependency issues
  const hasSeenWarningRef = useRef(false);

  const [showCave, setShowCave] = useState(false);
  const [globalShards, setGlobalShards] = useState(100);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null); 
  const lastMoveTime = useRef<number>(0);
  
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false); 
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  const [tasks, setTasks] = useState(() => {
    if (typeof window === 'undefined') return { login: false, click: false, share: false };
    try {
        const today = new Date().toDateString();
        const savedDate = localStorage.getItem('avocado_last_login');
        if (savedDate !== today) {
            localStorage.setItem('avocado_last_login', today);
            const reset = { login: true, click: false, share: false };
            localStorage.setItem('avocado_tasks', JSON.stringify(reset));
            return reset;
        }
        const saved = localStorage.getItem('avocado_tasks');
        return saved ? JSON.parse(saved) : { login: false, click: false, share: false };
    } catch {
        return { login: false, click: false, share: false };
    }
  });

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
        bgmRef.current = new Audio(PLAYLIST[currentTrackIndex].src);
        bgmRef.current.loop = true;
        bgmRef.current.volume = 0.3; 
    }
    if (musicPlaying) bgmRef.current.pause();
    else bgmRef.current.play().catch((e) => console.log("Interaction needed", e));
    setMusicPlaying(!musicPlaying);
  };

  const changeTrack = (direction: 'next' | 'prev') => {
      let newIndex = direction === 'next' ? currentTrackIndex + 1 : currentTrackIndex - 1;
      if (newIndex >= PLAYLIST.length) newIndex = 0;
      if (newIndex < 0) newIndex = PLAYLIST.length - 1;
      setCurrentTrackIndex(newIndex);
      if (bgmRef.current) {
          bgmRef.current.src = PLAYLIST[newIndex].src;
          if (musicPlaying) bgmRef.current.play().catch(e => console.log(e));
      }
  };

  const updateTask = (task: 'click' | 'share') => {
    if (tasks[task]) return; 
    const newTasks = { ...tasks, [task]: true };
    setTasks(newTasks);
    localStorage.setItem('avocado_tasks', JSON.stringify(newTasks));
    confetti({ particleCount: 50, spread: 50, origin: { y: 0.5 }, colors: CHRISTMAS_COLORS });
  };

  const handleShare = () => {
    updateTask('share');
    window.open("https://twitter.com/intent/tweet?text=Growing%20my%20Christmas%20Avocado!%20%F0%9F%A5%91%F0%9F%8E%84", "_blank");
  };

  const handleMine = (e: React.MouseEvent) => {
      e.stopPropagation(); 
      if (globalShards > 0) {
          socket?.emit('mine_shard');
          playSound('click');
          const btn = e.target as HTMLElement;
          btn.style.transform = "scale(0.9)";
          setTimeout(() => btn.style.transform = "scale(1)", 100);
      }
  };

  const saveName = () => {
      if (tempName.trim().length > 0 && tempName.length <= 11) {
          socket?.emit('set_username', tempName.trim());
          setIsEditingName(false);
      } else {
          setIsEditingName(false); 
      }
  };

  const handleCollectTrash = (e: React.MouseEvent, trashId: string) => {
      e.stopPropagation(); 
      socket?.emit('collect_trash', trashId);
      playSound('click');
      const el = e.target as HTMLElement;
      el.style.transform = "scale(0)";
  };

  useEffect(() => {
    socket = io(SERVER_URL);

    socket.on('connect', () => {
        if (user?.wallet?.address) {
            socket?.emit('join_game', user.wallet.address);
            setJoined(true);
        }
    });

    socket.on('init_state', (data: InitState) => {
      setPlayers(data.players);
      setBgColor(data.backgroundColor);
      setClicks(data.globalClicks);
      setGlobalShards(data.shards);
      
      // Check immediately on join
      if (data.globalClicks >= 100 && !hasSeenWarningRef.current) {
          setShowWarning(true);
          hasSeenWarningRef.current = true;
      }
    });

    socket.on('trash_sync', (items: Trash[]) => setTrashItems(items));
    socket.on('trash_spawned', (item: Trash) => setTrashItems(prev => [...prev, item]));
    
    socket.on('trash_collected', (data: { trashId: string, collectorId: string, newCount: number }) => {
        setTrashItems(prev => prev.filter(t => t.id !== data.trashId));
        setPlayers((prev) => {
            if (!prev[data.collectorId]) return prev;
            return { ...prev, [data.collectorId]: { ...prev[data.collectorId], trashCollected: data.newCount } };
        });
        if (data.collectorId === socket?.id) {
            confetti({ colors: ['#FFFFFF', '#81D4FA'], particleCount: 20, spread: 30 });
        }
    });
    
    socket.on('score_damage', (data: { globalClicks: number, damage: number }) => {
        setClicks(data.globalClicks);
        setDamageFlash(true);
        setTimeout(() => setDamageFlash(false), 200); 
    });

    socket.on('game_over_reset', () => {
        alert("💀 THE COMMUNITY FAILED! ALL PROGRESS HAS BEEN RESET.");
        window.location.reload();
    });

    socket.on('player_updated', (data: { id: string, username: string }) => {
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], username: data.username } };
        });
    });

    socket.on('mining_update', (newCount: number) => {
        setGlobalShards(newCount);
        if (newCount === 0) confetti({ colors: ['#00E5FF', '#FFFFFF'] });
    });

    socket.on('mining_empty', () => {
        alert("💎 The Crystal is depleted! Come back next week.");
    });

    socket.on('shard_collected', (data: { id: string, shards: number }) => {
        if (data.id === socket?.id) {
            playSound('coin'); 
            confetti({ colors: ['#00E5FF', '#FFFFFF'], particleCount: 20 });
        }
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], shards: data.shards } };
        });
    });

    socket.on('player_joined', (player: Player) => {
      setPlayers((prev) => ({ ...prev, [player.id]: player }));
    });

    socket.on('player_grew', (data: { id: string, size: number }) => {
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], size: data.size } };
        });
    });

    socket.on('player_moved', (data) => {
      setPlayers((prev) => {
        if (!prev[data.id]) return prev;
        return { ...prev, [data.id]: { ...prev[data.id], x: data.x, y: data.y } };
      });
    });

    socket.on('score_update', (data: { id: string, clicks: number, globalClicks: number, bgColor: string }) => {
        setClicks(data.globalClicks); 
        if (data.bgColor) setBgColor(data.bgColor);
        setPlayers((prev) => {
            if (!prev[data.id]) return prev;
            return { ...prev, [data.id]: { ...prev[data.id], clicks: data.clicks } };
        });

        // 🆕 CHECK WARNING HERE INSTEAD OF useEffect
        if (data.globalClicks >= 100 && !hasSeenWarningRef.current) {
            setShowWarning(true);
            hasSeenWarningRef.current = true;
        }
    });

    socket.on('bg_update', (color: string) => {
        setBgColor(color);
        playSound('levelup');
        confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 }, colors: CHRISTMAS_COLORS });
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

    socket.on('leaderboard_update', (data: Record<string, { clicks: number, coins: number, shards: number, username?: string }>) => { setHighscores(data); });
    
    socket.on('new_message', (msg: ChatMessage) => {
        setMessages((prev) => [...prev.slice(-49), msg]); 
        playSound('chat');
    });

    socket.on('your_daily_progress', (count: number) => { setDailyCount(count); });
    socket.on('error_limit_reached', () => { alert("🥑 Daily limit reached!"); });
    socket.on('daily_reset', () => { setDailyCount(0); });

    return () => { if (socket) socket.disconnect(); };
  }, [user]); 

  // (Removed the failing useEffect entirely - Logic moved to socket listeners)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!joined || !socket) return;
        if (document.activeElement?.tagName === 'INPUT') return;
        const validKeys = [' ', 'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (validKeys.includes(e.key)) {
            if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
            if (e.key === ' ') {
                socket.emit('grow_avocado');
            } 
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [joined]);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleJoin = () => {
    const address = user?.wallet?.address;
    if (address && socket) {
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
        const sockId = socket?.id;
        if (sockId) {
            setPlayers((prev) => {
                if (!prev[sockId]) return prev;
                return { ...prev, [sockId]: { ...prev[sockId], x: xPercent, y: yPercent } };
            });
        }
        socket.emit('mouse_move', { x: xPercent, y: yPercent });
        lastMoveTime.current = now;
      }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => { handleInputMove(e.clientX, e.clientY); };
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => { handleInputMove(e.touches[0].clientX, e.touches[0].clientY); };

  // CORE LOGIC SEPARATED FOR REUSE
  const performClick = (x: number, y: number) => {
      if (!joined || !socket) return;
      if (dailyCount >= MAX_DAILY) return; 

      playSound('click');
      if (!tasks.click) updateTask('click');

      const newRipple = { id: Date.now(), x, y };
      setRipples((prev) => [...prev, newRipple]);
      setTimeout(() => setRipples((prev) => prev.filter(r => r.id !== newRipple.id)), 600);

      const newFloater = { id: Date.now(), x, y, text: "+1" };
      setFloaters((prev) => [...prev, newFloater]);
      setTimeout(() => setFloaters((prev) => prev.filter(f => f.id !== newFloater.id)), 1000);

      socket.emit('click_screen');
      setDailyCount(prev => prev + 1);
  };

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest && (target.closest('.chat-container') || target.closest('.music-btn') || target.closest('.task-btn') || target.closest('.leaderboard-btn') || target.closest('.mining-btn') || target.closest('.cave-modal') || target.closest('.mobile-menu-btn') || target.closest('.scoreboard') || target.closest('.music-controls') || target.closest('.mobile-joystick'))) return;

    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }
    performClick(clientX, clientY);
  };

  const handleJoystickClick = (e: React.TouchEvent) => {
      e.stopPropagation(); 
      const touch = e.touches[0];
      performClick(touch.clientX, touch.clientY);
  };

  const sendChat = (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (inputMsg.trim().length === 0 || !socket) return;
      socket.emit('send_message', inputMsg);
      setInputMsg(""); 
  };

  const myPlayer = socket?.id ? players[socket.id] : null;

  if (!joined) {
    return (
      <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#D32F2F', color: '#FFF', fontFamily: "'Fredoka', sans-serif" }}>
        <style jsx global>{`
            @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap'); 
            body { font-family: 'Fredoka', sans-serif; }
            .snow-bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="1" fill="white" opacity="0.4"/></svg>'); animation: snowFall 10s linear infinite; }
            @keyframes snowFall { from { background-position: 0 0; } to { background-position: 0 100px; } }
        `}</style>
        <div className="snow-bg" />
        <div style={{ fontSize: '5rem', marginBottom: '10px', zIndex: 1 }}>
            <img src="/avatar.png" alt="Avocado" style={{ width: '120px', height: 'auto', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.2))' }} />
        </div>
        <h1 style={{ fontSize: '3rem', marginBottom: '10px', color: '#FFF', textShadow: '2px 2px 0px #388E3C' }}>Merry Avocado Christmas!</h1>
        <p style={{ marginBottom: '40px', fontSize: '1.2rem', color: '#FFEBEE', zIndex: 1 }}>Join the festive party!</p>
        {!authenticated ? (
            <button onClick={login} className="bouncy-btn" style={{ padding: '15px 40px', fontSize: '1.2rem', cursor: 'pointer', background: '#388E3C', color: 'white', border: 'none', borderRadius: '50px', fontWeight: 'bold', boxShadow: '0 5px 0 #1B5E20', zIndex: 10 }}>Log in with Privy</button>
        ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', zIndex: 10 }}>
                <div style={{ background: '#FFF', padding: '10px 20px', borderRadius: '20px', color: '#D32F2F', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }}>🌱 Connected: {user?.wallet?.address.slice(0, 4)}...{user?.wallet?.address.slice(-4)}</div>
                <button onClick={handleJoin} className="bouncy-btn" style={{ padding: '15px 50px', fontSize: '1.5rem', cursor: 'pointer', background: '#FFD700', border: 'none', borderRadius: '50px', fontWeight: 'bold', color: '#5D4037', boxShadow: '0 5px 0 #FFA000' }}>ENTER WONDERLAND ❄️</button>
                <button onClick={logout} style={{ background: 'transparent', border: 'none', color: '#FFEBEE', cursor: 'pointer', textDecoration: 'underline' }}>Disconnect</button>
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
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'red', opacity: damageFlash ? 0.3 : 0, pointerEvents: 'none', transition: 'opacity 0.1s ease', zIndex: 999 }} />

      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap');
        .bouncy-btn:active { transform: translateY(4px); box-shadow: 0 1px 0 #388E3C !important; }
        .music-btn:hover, .task-btn:hover, .leaderboard-btn:hover, .mining-btn:hover, .mobile-menu-btn:hover { transform: scale(1.1); }
        .mining-btn { transition: transform 0.2s; }
        .chat-box { width: 320px; height: 220px; left: 20px; bottom: 20px; }
        .scoreboard { top: 20px; left: 20px; }
        .mobile-menu-btn { display: none; }
        .snowflake { position: fixed; top: -10px; z-index: 1; color: white; font-size: 1em; animation-name: fall; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes fall { to { transform: translateY(110vh); } }
        .sf1 { left: 10%; animation-duration: 10s; animation-delay: 0s; }
        .sf2 { left: 20%; animation-duration: 12s; animation-delay: 1s; }
        .sf3 { left: 30%; animation-duration: 8s; animation-delay: 2s; }
        .sf4 { left: 40%; animation-duration: 15s; animation-delay: 0s; }
        .sf5 { left: 50%; animation-duration: 11s; animation-delay: 3s; }
        .sf6 { left: 60%; animation-duration: 9s; animation-delay: 1s; }
        .sf7 { left: 70%; animation-duration: 14s; animation-delay: 2s; }
        .sf8 { left: 80%; animation-duration: 13s; animation-delay: 0s; }
        .sf9 { left: 90%; animation-duration: 10s; animation-delay: 4s; }
        .sf10 { left: 95%; animation-duration: 16s; animation-delay: 1s; }
        .mining-container { position: absolute; top: 465px; left: 20px; z-index: 25; background: rgba(255,255,255,0.9); padding: 10px 15px; border-radius: 20px; border: 3px solid #29B6F6; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: flex; alignItems: center; gap: 10px; cursor: pointer; }
        .mining-text-content { display: block; }
        .music-controls { display: flex; align-items: center; gap: 8px; background: white; padding: 5px 10px; border-radius: 30px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
        .control-btn { background: transparent; border: none; font-size: 18px; cursor: pointer; padding: 5px; border-radius: 50%; transition: background 0.2s; }
        .control-btn:hover { background: #EEE; }
        .mobile-joystick {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 80px;
            height: 80px;
            background: rgba(255, 255, 255, 0.5);
            border: 4px solid rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            z-index: 150;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            user-select: none;
            touch-action: manipulation;
            box-shadow: 0 0 15px rgba(0,0,0,0.2);
        }
        .mobile-joystick:active { background: rgba(255, 255, 255, 0.8); transform: scale(0.95); }
        @keyframes heartbeat { 0% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.1); } 100% { transform: translate(-50%, -50%) scale(1); } }
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
        @media (max-width: 900px) {
            .mobile-menu-btn { display: flex !important; }
            .chat-box { width: 250px !important; height: 150px !important; left: 10px !important; bottom: 10px !important; font-size: 12px; }
            .scoreboard { display: ${mobileMenuOpen ? 'flex' : 'none'} !important; position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) scale(1.1) !important; z-index: 100; }
            .mobile-backdrop { display: ${mobileMenuOpen ? 'block' : 'none'}; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); z-index: 90; }
            .mining-container { top: ${mobileMenuOpen ? '50%' : '100px'} !important; left: ${mobileMenuOpen ? '50%' : '20px'} !important; transform: ${mobileMenuOpen ? 'translate(-50%, 180px)' : 'none'} !important; z-index: ${mobileMenuOpen ? 120 : 25} !important; width: 50px !important; height: 50px !important; border-radius: 50% !important; padding: 0 !important; justifyContent: center !important; background: #E0F7FA !important; border: 2px solid #00E5FF !important; }
            .mining-text-content { display: none !important; }
            .mobile-joystick { display: flex !important; }
        }
        @keyframes rippleEffect { 0% { width: 0px; height: 0px; opacity: 1; } 100% { width: 120px; height: 120px; opacity: 0; } }
        @keyframes floatUp { 0% { transform: translateY(0px); opacity: 1; } 100% { transform: translateY(-50px); opacity: 0; } }
        @keyframes float { 0% { transform: translateY(0px) translateX(-50%) scale(1, 1); } 50% { transform: translateY(-10px) translateX(-50%) scale(1.1, 0.9); } 100% { transform: translateY(0px) translateX(-50%) scale(1, 1); } }
        @keyframes spin { 0% { transform: translate(-50%, -50%) rotateY(0deg); } 100% { transform: translate(-50%, -50%) rotateY(360deg); } }
      `}</style>

      <div className="mobile-joystick" onTouchStart={handleJoystickClick}>🥑</div>

      {/* 🆕 WARNING POPUP */}
      {showWarning && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#D32F2F', padding: '30px', borderRadius: '20px', border: '5px solid #FFF', textAlign: 'center', color: 'white', animation: 'pulse 1s infinite' }}>
                  <h1 style={{ fontSize: '2rem', marginBottom: '20px' }}>⚠️ WARNING! ⚠️</h1>
                  <p style={{ fontSize: '1.2rem', marginBottom: '30px' }}>KEEP AVOCADO LAND CLEAN!<br/>OR ALL OUR EFFORTS WILL BE DOOMED</p>
                  <button onClick={() => setShowWarning(false)} style={{ padding: '10px 30px', fontSize: '1.2rem', cursor: 'pointer', background: 'white', color: '#D32F2F', border: 'none', borderRadius: '50px', fontWeight: 'bold' }}>I WILL PROTECT IT! 🛡️</button>
              </div>
          </div>
      )}

      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '100px', opacity: 0.3, zIndex: 0, animation: 'heartbeat 2s infinite ease-in-out', pointerEvents: 'none' }}>💚</div>

      {trashItems.map(trash => (
          <div key={trash.id} onClick={(e) => handleCollectTrash(e, trash.id)} style={{ position: 'absolute', left: `${trash.x}%`, top: `${trash.y}%`, fontSize: '40px', cursor: 'pointer', zIndex: 20, transition: 'transform 0.2s', animation: 'float 2s ease-in-out infinite' }}>☃️</div>
      ))}

      <div className="snowflake sf1">❄</div>
      <div className="snowflake sf2">❅</div>
      <div className="snowflake sf3">❆</div>
      <div className="snowflake sf4">❄</div>
      <div className="snowflake sf5">❅</div>
      <div className="snowflake sf6">❆</div>
      <div className="snowflake sf7">❄</div>
      <div className="snowflake sf8">❅</div>
      <div className="snowflake sf9">❆</div>
      <div className="snowflake sf10">❄</div>

      <div className="mobile-backdrop" onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(false); }} />
      <button className="mobile-menu-btn" onClick={(e) => { e.stopPropagation(); setMobileMenuOpen(!mobileMenuOpen); }} style={{ position: 'absolute', top: 20, left: 20, zIndex: 110, background: '#FFF', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '24px', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.2)', cursor: 'pointer' }}>{mobileMenuOpen ? '✕' : '📊'}</button>

      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 30, display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div className="music-controls">
            <button onClick={() => changeTrack('prev')} className="control-btn">⏮️</button>
            <button onClick={toggleMusic} className="control-btn" style={{ fontSize: '20px' }}>{musicPlaying ? '⏸️' : '▶️'}</button>
            <button onClick={() => changeTrack('next')} className="control-btn">⏭️</button>
        </div>
        <button onClick={() => setShowTasks(!showTasks)} className="task-btn" style={{ background: '#FFD54F', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📝</button>
        <button onClick={() => setShowLeaderboard(!showLeaderboard)} className="leaderboard-btn" style={{ background: '#81D4FA', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🏆</button>
      </div>

      <div className="mining-btn mining-container" onClick={(e) => { e.stopPropagation(); setShowCave(true); }}>
          <span style={{ fontSize: '24px' }}>⛏️</span>
          <div className="mining-text-content">
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#5D4037', textTransform: 'uppercase' }}>Crystal Cave</div>
              <div style={{ fontSize: '10px', color: '#0277BD' }}>{globalShards > 0 ? "Mining Active" : "Depleted"}</div>
          </div>
      </div>

      {showCave && (
          <div className="cave-modal" style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
              <button onClick={(e) => { e.stopPropagation(); setShowCave(false); }} style={{ position: 'absolute', top: 30, right: 30, background: 'transparent', border: 'none', fontSize: '40px', color: 'white', cursor: 'pointer' }}>✕</button>
              <h1 style={{ fontSize: '3rem', marginBottom: '20px', textShadow: '0 0 10px #00E5FF' }}>Crystal Cave</h1>
              <div style={{ fontSize: '1.5rem', marginBottom: '40px' }}>Weekly Shards: <span style={{ color: '#00E5FF', fontWeight: 'bold' }}>{globalShards}</span> / 100</div>
              {globalShards > 0 ? (
                  <div onClick={handleMine} style={{ fontSize: '150px', cursor: 'pointer', transition: 'transform 0.1s', filter: 'drop-shadow(0 0 20px #00E5FF)' }}>💎</div>
              ) : (
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: '80px', marginBottom: '20px' }}>🌑</div><p style={{ fontSize: '1.2rem', color: '#AAA' }}>The vein has collapsed.<br/>Come back next week!</p></div>
              )}
          </div>
      )}

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
                      <span style={{ fontWeight: 'bold', color: i===0 ? '#FFD700' : '#5D4037' }}>#{i+1} {stats.username ? stats.username : addr.slice(0,4)}</span>
                      <span><span style={{ color: '#4CAF50', marginRight: '5px' }}>{stats.clicks}</span><span style={{ color: '#FFD700' }}>{stats.coins > 0 ? `(${stats.coins}🪙)` : ''}</span></span>
                  </div>
              ))}
          </div>
      )}

      <div className="scoreboard" style={{ position: 'absolute', pointerEvents: 'none', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(8px)', padding: '10px 20px', borderRadius: '20px', border: '2px solid rgba(255,255,255,0.6)', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            <h2 style={{ margin: 0, color: '#3E2723', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>Community Score</h2>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4CAF50', textShadow: '2px 2px 0 white' }}>{clicks}</div>
        </div>
        {myPlayer && (
            <div style={{ background: '#FFF9C4', padding: '10px 20px', borderRadius: '20px', border: '2px solid #FFF', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', pointerEvents: 'auto' }}>
                <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#5D4037', marginBottom: '2px', fontWeight: 'bold' }}><span>Energy ⚡</span><span>{Math.max(0, MAX_DAILY - dailyCount)} left</span></div>
                    <div style={{ width: '100%', height: '8px', background: '#E0E0E0', borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, (dailyCount / MAX_DAILY) * 100)}%`, height: '100%', background: dailyCount >= MAX_DAILY ? '#FF5252' : '#29B6F6', transition: 'width 0.2s' }} /></div>
                </div>
                <h3 style={{ margin: 0, color: '#FBC02D', fontSize: '14px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>My Contribution <span onClick={() => setIsEditingName(true)} style={{ cursor: 'pointer', fontSize: '16px' }}>✏️</span></h3>
                {isEditingName ? (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}><input autoFocus maxLength={11} placeholder="Max 11 chars" value={tempName} onChange={(e) => setTempName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} style={{ width: '100px', fontSize: '14px', padding: '2px' }} /><button onClick={saveName} style={{ fontSize: '12px', cursor: 'pointer' }}>✅</button></div>
                ) : (
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#5D4037', marginBottom: '5px' }}>{myPlayer.username ? myPlayer.username : myPlayer.solanaAddress.slice(0,6)}</div>
                )}
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#5D4037' }}>{myPlayer.clicks}</div>
                <div style={{ fontSize: '12px', color: '#8D6E63', marginTop: '5px', fontWeight: 'bold' }}>{getRank(myPlayer.clicks)}</div>
                <div style={{ marginTop: '10px', background: '#FFF', padding: '5px 10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}><span style={{ fontSize: '18px' }}>🪙</span><span style={{ fontWeight: 'bold', color: '#FFA000' }}>Coins: {myPlayer.coins}</span></div>
                <div style={{ marginTop: '5px', background: '#E0F7FA', padding: '5px 10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '5px', border: '1px solid #00E5FF' }}><span style={{ fontSize: '18px' }}>💎</span><span style={{ fontWeight: 'bold', color: '#006064' }}>Shards: {myPlayer.shards}</span></div>
                <div style={{ marginTop: '5px', background: '#FFEBEE', padding: '5px 10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '5px', border: '1px solid #D32F2F' }}><span style={{ fontSize: '18px' }}>☃️</span><span style={{ fontWeight: 'bold', color: '#C62828' }}>Snowmen: {myPlayer.trashCollected}</span></div>
            </div>
        )}
      </div>

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
      {floaters.map(f => ( <div key={f.id} style={{ position: 'absolute', left: f.x, top: f.y, color: '#D32F2F', fontWeight: 'bold', fontSize: '24px', pointerEvents: 'none', textShadow: '2px 2px 0px white', animation: 'floatUp 1s ease-out forwards' }}>{f.text}</div> ))}

      {activeCoin && ( <div style={{ position: 'absolute', left: `${activeCoin.x}%`, top: `${activeCoin.y}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'none', fontSize: '40px', animation: 'spin 2s linear infinite' }}>🪙</div> )}

      {Object.values(players).map((player) => (
        <div key={player.id} style={{ position: 'absolute', left: `${player.x}%`, top: `${player.y}%`, transform: 'translateX(-50%)', pointerEvents: 'none', transition: 'left 0.1s linear, top 0.1s linear, font-size 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 5, fontSize: `${player.size || 30}px` }}>
          <div style={{ background: 'white', padding: '2px 8px', borderRadius: '10px', color: '#5D4037', fontSize: '10px', fontWeight: 'bold', marginBottom: '2px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }}>{player.username || player.solanaAddress.slice(0, 4)}</div>
          <img src="/avatar.png" alt="Avocado" style={{ width: `${player.size || 40}px`, height: 'auto', filter: 'drop-shadow(0 4px 4px rgba(0,0,0,0.2))', animation: 'float 2s ease-in-out infinite' }} />
          {player.clicks > 0 && <div style={{ fontSize: '10px', color: '#FFF', background: '#388E3C', padding: '0 4px', borderRadius: '4px', marginTop: '-5px' }}>{player.clicks}</div>}
        </div>
      ))}
    </main>
  );
}