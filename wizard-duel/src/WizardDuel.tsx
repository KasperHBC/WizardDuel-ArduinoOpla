import { useState, useEffect, useRef } from 'react';
import { Zap, Shield, Heart, Flame, Sparkles, Skull, Users, Clock, Play, RotateCcw } from 'lucide-react';

// Interfaces
interface Spell {
  name: string;
  damage: number;
  manaCost: number;
  type: string;
  effect?: string;
  duration?: number;
}

interface Player {
  wizardId: number;
  deviceId: string;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  alive: boolean;
  shield: boolean;
  boost: boolean;
}

interface QueueEntry {
  deviceId: string;
  position: number;
}

// Spell definitions (lokal konstant)
const SPELLS: Record<string, Spell> = {
  FIREBALL:    { name: "Fireball",       damage: 10, manaCost: 20, type: "single" },
  LIGHTNING:   { name: "Lightning Storm", damage: 10, manaCost: 50, type: "aoe" },
  SHIELD:      { name: "Shield",          damage: 0,  manaCost: 25, type: "self", effect: "shield", duration: 5000 },
  HEAL:        { name: "Heal",            damage: -20, manaCost: 40, type: "self" },
  POWER_BOOST: { name: "Power Boost",     damage: 0,  manaCost: 40, type: "self", effect: "boost", duration: 10000 },
  DEATH_RAY:   { name: "Death Ray",       damage: 40, manaCost: 80, type: "single" }
};



// Spell icons mapping
const SPELL_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  FIREBALL: Flame,
  LIGHTNING: Zap,
  SHIELD: Shield,
  HEAL: Heart,
  POWER_BOOST: Sparkles,
  DEATH_RAY: Skull
};

const WIZARD_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf'];
const WIZARD_POSITIONS = [
  { x: 150, y: 280 },
  { x: 650, y: 280 },
  { x: 150, y: 120 },
  { x: 650, y: 120 }
];

interface SpellEffect {
  id: number;
  casterId: number;
  spellKey: string;
  spellName: string;
  targetId?: number;
  timestamp: number;
}

interface SpellShout {
  id: number;
  wizardId: number;
  spellName: string;
  timestamp: number;
}

interface LogEntry {
  message: string;
  time: number;
  type?: 'info' | 'damage' | 'heal' | 'kill' | 'system';
}

export default function WizardDuel() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [effects, setEffects] = useState<SpellEffect[]>([]);
  const [shouts, setShouts] = useState<SpellShout[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bridgeHostRef = useRef<string>('');

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev.slice(-19), { message, time: Date.now(), type }]);
  };

  // API calls til bridge
  const api = {
    startGame: async () => {
      try {
        const res = await fetch(`http://${bridgeHostRef.current}/start-game`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
          addLog(`Kunne ikke starte: ${data.message}`, 'system');
        }
      } catch (e) {
        addLog('Fejl ved start af spil', 'system');
      }
    },
    
    newGame: async () => {
      try {
        await fetch(`http://${bridgeHostRef.current}/new-game`, { method: 'POST' });
        setWinner(null);
      } catch (e) {
        addLog('Fejl ved nyt spil', 'system');
      }
    }
  };

  // WebSocket connection
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const bridgeHost = qs.get("bridge") || `${window.location.hostname}:3000`;
    bridgeHostRef.current = bridgeHost;

    const connect = () => {
      console.log("Connecting to WebSocket:", `ws://${bridgeHost}/ws`);
      const ws = new WebSocket(`ws://${bridgeHost}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected!");
        setConnected(true);
        addLog('Forbundet til server', 'system');
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setConnected(false);
        addLog('Mistet forbindelse til server', 'system');
        // Reconnect efter 2 sekunder
        setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          console.log("WS:", msg.type, msg);

          switch (msg.type) {
            case "welcome":
            case "state-update":
              setPlayers(msg.players || []);
              setQueue(msg.queue || []);
              setGameStarted(msg.gameStarted || false);
              break;

            case "queue-joined":
              addLog(`${msg.deviceId.slice(-6)} kom i kø (position ${msg.position})`, 'system');
              break;

            case "player-joined":
              addLog(`Wizard ${msg.wizardId + 1} klar til kamp!`, 'system');
              break;

            case "game-started":
              addLog(`🎮 KAMP STARTET med ${msg.playerCount} spillere!`, 'system');
              setWinner(null);
              break;

            case "spell-cast":
              handleSpellEffect(msg.casterId, msg.spellKey, msg.targetId, msg.results);
              break;

            case "player-killed":
              addLog(`💀 Wizard ${msg.wizardId + 1} blev dræbt af Wizard ${msg.killedBy + 1}!`, 'kill');
              break;

            case "player-disconnected":
              addLog(`⚡ Wizard ${msg.wizardId + 1} mistede forbindelse (${msg.reason})`, 'system');
              break;

            case "player-kicked":
              addLog(`Wizard ${msg.wizardId + 1} blev fjernet`, 'system');
              break;

            case "game-over":
              if (msg.winnerId !== null) {
                addLog(`🏆 WIZARD ${msg.winnerId + 1} VANDT! 🏆`, 'system');
                setWinner(msg.winnerId);
              } else {
                addLog(`💀 Uafgjort! Alle er døde!`, 'system');
              }
              break;

            case "game-reset":
              addLog('🔄 Spil nulstillet', 'system');
              setWinner(null);
              break;
          }
        } catch (e) {
          console.error("WS parse error:", e);
        }
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

const handleSpellEffect = (casterId: number, spellKey: string, targetId: number | undefined, results: unknown[]) => {
    const spell = SPELLS[spellKey];
    if (!spell) {
      console.log("Unknown spell:", spellKey);
      return;
    }

    const spellName = spell.name;

    // Add visual effect
    const effectId = Date.now() + Math.random();
    setEffects(prev => [...prev, { id: effectId, casterId, spellKey, spellName, targetId, timestamp: Date.now() }]);
    setTimeout(() => {
      setEffects(prev => prev.filter(e => e.id !== effectId));
    }, 1000);

    // Add shout over wizard
    const shoutId = Date.now() + Math.random();
    setShouts(prev => [...prev, { id: shoutId, wizardId: casterId, spellName, timestamp: Date.now() }]);
    setTimeout(() => {
      setShouts(prev => prev.filter(s => s.id !== shoutId));
    }, 1500);

    // Detailed log
    const casterName = `W${casterId + 1}`;
    
    if (spell.type === 'aoe') {
      addLog(`⚡ ${casterName} råber "${spellName}!" og rammer ALLE!`, 'damage');
      
      // Log damage to each target
      if (Array.isArray(results)) {
        results.forEach((r: unknown) => {
          const result = r as { targetId?: number; damage?: number; shielded?: boolean; killed?: boolean };
          if (result.targetId !== undefined && result.damage !== undefined) {
            const targetName = `W${result.targetId + 1}`;
            const dmgText = result.shielded ? `${Math.round(result.damage)} skade (SHIELDED!)` : `${Math.round(result.damage)} skade`;
            addLog(`   💥 ${targetName} tog ${dmgText}`, 'damage');
            if (result.killed) {
              addLog(`   💀 ${targetName} er DRÆBT!`, 'kill');
            }
          }
        });
      }
    } else if (spell.type === 'single' && targetId !== undefined) {
      const targetName = `W${targetId + 1}`;
      addLog(`🔥 ${casterName} råber "${spellName}!" mod ${targetName}!`, 'damage');
      
      // Check results for damage info
      if (Array.isArray(results)) {
        results.forEach((r: unknown) => {
          const result = r as { targetId?: number; damage?: number; shielded?: boolean; killed?: boolean; healed?: number };
          if (result.damage !== undefined) {
            const dmgText = result.shielded ? `${Math.round(result.damage)} skade (SHIELDED!)` : `${Math.round(result.damage)} skade`;
            addLog(`   💥 ${targetName} tog ${dmgText}`, 'damage');
          }
          if (result.killed) {
            addLog(`   💀 ${targetName} er DRÆBT!`, 'kill');
          }
        });
      }
    } else if (spell.effect === 'shield') {
      addLog(`🛡️ ${casterName} råber "${spellName}!" - beskyttet!`, 'info');
        } else if (spell.effect === 'boost') {
      addLog(`⚡ ${casterName} råber "${spellName}!" - POWER UP!`, 'info');
        } else if (spell.damage < 0) {
      addLog(`💚 ${casterName} råber "${spellName}!" og healer ${-spell.damage} HP!`, 'heal');
    }
  };

  // Animation loop for smooth shouts
  useEffect(() => {
    if (shouts.length === 0) return;
    
    const interval = setInterval(() => {
      // Force re-render for animation
      setShouts(prev => [...prev]);
    }, 50);
    
    return () => clearInterval(interval);
  }, [shouts.length]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    const gradient = ctx.createRadialGradient(400, 200, 50, 400, 200, 400);
    gradient.addColorStop(0, '#1a1a3e');
    gradient.addColorStop(1, '#0a0a1e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = '#2a2a4e';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw players
    players.forEach(player => {
      const pos = WIZARD_POSITIONS[player.wizardId];
      if (!pos) return;
      
      const { x, y } = pos;
      const color = WIZARD_COLORS[player.wizardId] || '#888';
      
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(x, y + 45, 25, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      if (player.alive) {
        // Shield effect
        if (player.shield) {
          ctx.strokeStyle = '#4169e1';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#4169e1';
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.arc(x, y, 45, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Boost effect
        if (player.boost) {
          ctx.fillStyle = '#9370db';
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 + Date.now() / 400;
            const px = x + Math.cos(angle) * 50;
            const py = y + Math.sin(angle) * 50;
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Body
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Hat
        ctx.beginPath();
        ctx.moveTo(x - 25, y - 10);
        ctx.lineTo(x, y - 50);
        ctx.lineTo(x + 25, y - 10);
        ctx.closePath();
        ctx.fill();

        // Face
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x - 8, y - 5, 4, 0, Math.PI * 2);
        ctx.arc(x + 8, y - 5, 4, 0, Math.PI * 2);
        ctx.fill();

        // HP bar background
        const barWidth = 60;
        const barHeight = 8;
        const barX = x - barWidth / 2;
        const barY = y + 40;
        
        ctx.fillStyle = '#222';
        ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
        
        const hpPercent = player.hp / player.maxHp;
        ctx.fillStyle = hpPercent > 0.5 ? '#32cd32' : hpPercent > 0.25 ? '#ffa500' : '#ff4500';
        ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);

        // Mana bar
        const manaBarY = y + 52;
        ctx.fillStyle = '#222';
        ctx.fillRect(barX - 1, manaBarY - 1, barWidth + 2, barHeight + 2);
        
        const manaPercent = player.mana / player.maxMana;
        ctx.fillStyle = '#4169e1';
        ctx.fillRect(barX, manaBarY, barWidth * manaPercent, barHeight);

        // Wizard label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`W${player.wizardId + 1}`, x, y + 8);
        
        // Stats text
        ctx.font = '11px Arial';
        ctx.fillText(`${Math.round(player.hp)} HP | ${Math.round(player.mana)} MP`, x, y + 73);
      } else {
        // Dead wizard
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#666';
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💀', x, y + 10);
        
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.fillText(`W${player.wizardId + 1}`, x, y + 50);
      }
    });

    // Spell effects
    effects.forEach(effect => {
      const casterPos = WIZARD_POSITIONS[effect.casterId];
      if (!casterPos) return;

      const spellColors: Record<string, string> = {
        FIREBALL: '#ff4500',
        LIGHTNING: '#ffd700',
        SHIELD: '#4169e1',
        HEAL: '#32cd32',
        POWER_BOOST: '#9370db',
        DEATH_RAY: '#8b0000'
      };
      
      const color = spellColors[effect.spellKey] || '#fff';
      
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      ctx.lineWidth = 6;

      if (effect.targetId !== undefined) {
        const targetPos = WIZARD_POSITIONS[effect.targetId];
        if (targetPos) {
          ctx.beginPath();
          ctx.moveTo(casterPos.x, casterPos.y);
          ctx.lineTo(targetPos.x, targetPos.y);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.arc(targetPos.x, targetPos.y, 20, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // AOE or self
        ctx.beginPath();
        ctx.arc(casterPos.x, casterPos.y, 50, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.shadowBlur = 0;
    });

    // Spell shouts over wizards
    shouts.forEach(shout => {
      const pos = WIZARD_POSITIONS[shout.wizardId];
      if (!pos) return;

      const age = Date.now() - shout.timestamp;
      const opacity = Math.max(0, 1 - age / 1500);
      const yOffset = -60 - (age / 30); // Float upward

      // Speech bubble background
      ctx.fillStyle = `rgba(0, 0, 0, ${opacity * 0.8})`;
      const textWidth = ctx.measureText(shout.spellName).width + 20;
      ctx.beginPath();
      ctx.roundRect(pos.x - textWidth / 2 - 5, pos.y + yOffset - 15, textWidth + 10, 30, 8);
      ctx.fill();

      // Border
      ctx.strokeStyle = `rgba(255, 215, 0, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Text
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(shout.spellName + '!', pos.x, pos.y + yOffset + 5);
    });

    // Winner overlay
    if (winner !== null) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🏆 WINNER! 🏆', canvas.width / 2, canvas.height / 2 - 20);
      
      ctx.fillStyle = WIZARD_COLORS[winner];
      ctx.font = 'bold 36px Arial';
      ctx.fillText(`Wizard ${winner + 1}`, canvas.width / 2, canvas.height / 2 + 30);
    }
  }, [players, effects, shouts, winner]);
  
  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: "'Segoe UI', Arial, sans-serif", 
      background: 'linear-gradient(135deg, #0a0a1e 0%, #1a1a3e 100%)', 
      minHeight: '100vh', 
      color: '#fff' 
    }}>
      <h1 style={{ 
        textAlign: 'center', 
        marginBottom: '20px', 
        color: '#ffd700',
        textShadow: '0 0 20px rgba(255,215,0,0.5)',
        fontSize: '2.5rem'
      }}>
        ⚡ Wizard Duel Arena ⚡
      </h1>
      
      {/* Connection status */}
      <div style={{ 
        textAlign: 'center', 
        marginBottom: '15px',
        color: connected ? '#32cd32' : '#ff4500'
      }}>
        {connected ? '🟢 Forbundet til server' : '🔴 Ikke forbundet'}
      </div>
      
      <div style={{ display: 'flex', gap: '20px', maxWidth: '1300px', margin: '0 auto' }}>
        {/* Main game area */}
        <div style={{ flex: 1 }}>
          <canvas 
            ref={canvasRef} 
            width={800} 
            height={400}
            style={{ 
              border: '3px solid #ffd700', 
              borderRadius: '12px',
              display: 'block',
              boxShadow: '0 0 30px rgba(255,215,0,0.3)'
            }}
          />
          
          {/* Controls */}
          <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={api.startGame}
              disabled={queue.length < 2 || gameStarted}
              style={{
                padding: '14px 28px',
                fontSize: '16px',
                background: gameStarted ? '#666' : 'linear-gradient(135deg, #32cd32, #228b22)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: (queue.length < 2 || gameStarted) ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                opacity: (queue.length < 2 || gameStarted) ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 15px rgba(50,205,50,0.3)'
              }}
            >
              <Play size={18} />
              Start Kamp ({queue.length} i kø)
            </button>
            
            <button
              onClick={api.newGame}
              style={{
                padding: '14px 28px',
                fontSize: '16px',
                background: 'linear-gradient(135deg, #ff4500, #cc3700)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 15px rgba(255,69,0,0.3)'
              }}
            >
              <RotateCcw size={18} />
              Ny Kamp
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: '340px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          
          {/* Queue */}
          <div style={{ 
            background: 'rgba(26,26,46,0.9)', 
            padding: '15px', 
            borderRadius: '12px', 
            border: '2px solid #4169e1'
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#4169e1', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} />
              Ventekø ({queue.length})
            </h3>
            {queue.length === 0 ? (
              <div style={{ color: '#666', fontSize: '14px', textAlign: 'center', padding: '10px' }}>
                Ingen i kø - tilslut Arduino!
              </div>
            ) : (
              queue.map((q) => (
                <div key={q.deviceId} style={{ 
                  padding: '8px 12px', 
                  background: '#2a2a4e', 
                  borderRadius: '6px',
                  marginBottom: '6px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                    {q.deviceId.slice(-8)}
                  </span>
                  <span style={{ 
                    background: '#4169e1', 
                    padding: '2px 8px', 
            borderRadius: '10px', 
                    fontSize: '12px'
                  }}>
                    #{q.position}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Players */}
          <div style={{ 
            background: 'rgba(26,26,46,0.9)', 
            padding: '15px', 
            borderRadius: '12px', 
            border: '2px solid #ffd700'
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#ffd700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} />
              I Kamp ({players.length}/4)
            </h3>
            {players.map(p => (
              <div key={p.wizardId} style={{ 
                marginBottom: '10px', 
                padding: '12px', 
                background: '#2a2a4e', 
                borderRadius: '8px',
                borderLeft: `4px solid ${WIZARD_COLORS[p.wizardId]}`,
                opacity: p.alive ? 1 : 0.5
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '15px' }}>Wizard {p.wizardId + 1}</span>
                  <span style={{ 
                    fontSize: '11px', 
                    padding: '3px 10px', 
                    borderRadius: '12px',
                    background: p.alive ? '#32cd32' : '#ff4500',
                    fontWeight: 'bold'
                  }}>
                    {p.alive ? 'ALIVE' : 'DEAD'}
                  </span>
                </div>
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ color: '#ff6b6b' }}>❤️ {Math.round(p.hp)}/{p.maxHp}</span>
                    {p.shield && <span title="Shield">🛡️</span>}
                    {p.boost && <span title="Power Boost">⚡</span>}
                  </div>
                  <div style={{ color: '#4169e1' }}>💧 {Math.round(p.mana)}/{p.maxMana}</div>
                </div>
                {/* Mini bars */}
                <div style={{ marginTop: '6px' }}>
                  <div style={{ background: '#333', borderRadius: '3px', height: '4px', marginBottom: '3px' }}>
                    <div style={{ 
                      width: `${(p.hp / p.maxHp) * 100}%`, 
                      background: p.hp > 50 ? '#32cd32' : p.hp > 25 ? '#ffa500' : '#ff4500',
                      height: '100%', 
                      borderRadius: '3px',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                  <div style={{ background: '#333', borderRadius: '3px', height: '4px' }}>
                    <div style={{ 
                      width: `${(p.mana / p.maxMana) * 100}%`, 
                      background: '#4169e1',
                      height: '100%', 
                      borderRadius: '3px',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Spells */}
          <div style={{ 
            background: 'rgba(26,26,46,0.9)', 
            padding: '15px', 
            borderRadius: '12px', 
            border: '2px solid #9370db'
          }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#9370db' }}>✨ Spells</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {Object.entries(SPELLS).map(([key, spell]) => {
                const Icon = SPELL_ICONS[key] || Sparkles;
                const colors: Record<string, string> = {
                  FIREBALL: '#ff4500',
                  LIGHTNING: '#ffd700',
                  SHIELD: '#4169e1',
                  HEAL: '#32cd32',
                  POWER_BOOST: '#9370db',
                  DEATH_RAY: '#8b0000'
                };
              return (
                <div key={key} style={{ 
                  padding: '8px', 
                  background: '#2a2a4e', 
                    borderRadius: '6px',
                    fontSize: '11px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <Icon size={14} style={{ color: colors[key] }} />
                      <span style={{ fontWeight: 'bold', fontSize: '12px' }}>{spell.name}</span>
                    </div>
                    <div style={{ color: '#888' }}>
                      {spell.damage > 0 ? `${spell.damage} dmg` : spell.damage < 0 ? `${-spell.damage} heal` : spell.effect || 'Buff'}
                      <span style={{ color: '#4169e1' }}> • {spell.manaCost} MP</span>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* Log */}
          <div style={{ 
            background: 'rgba(26,26,46,0.9)', 
            padding: '15px', 
            borderRadius: '12px', 
            border: '2px solid #666',
            maxHeight: '200px',
            overflow: 'auto'
          }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#aaa' }}>📜 Kamp Log</h3>
            {logs.map((log, i) => {
              const colors: Record<string, string> = {
                info: '#ddd',
                damage: '#ff6b6b',
                heal: '#32cd32',
                kill: '#ff4500',
                system: '#ffd700'
              };
              return (
              <div key={i} style={{ 
                fontSize: '11px', 
                  marginBottom: '4px',
                  padding: '4px 8px',
                  background: '#1a1a2e',
                  borderRadius: '4px',
                  color: colors[log.type || 'info']
              }}>
                {log.message}
              </div>
              );
            })}
          </div>

          {/* API Reference */}
          <div style={{ 
            background: 'rgba(26,26,46,0.9)', 
            padding: '15px',
            borderRadius: '12px', 
            border: '2px solid #444',
            fontSize: '11px'
          }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#888' }}>🔌 API Endpoints</h3>
            <div style={{ color: '#666' }}>
              <div style={{ marginBottom: '8px' }}>
                <div style={{ color: '#4ecdc4', fontWeight: 'bold' }}>Arduino:</div>
                <code style={{ display: 'block', padding: '2px 0' }}>POST /join-queue</code>
                <code style={{ display: 'block', padding: '2px 0' }}>POST /heartbeat</code>
                <code style={{ display: 'block', padding: '2px 0' }}>POST /cast-spell</code>
                <code style={{ display: 'block', padding: '2px 0' }}>GET /my-state/:deviceId</code>
              </div>
              <div>
                <div style={{ color: '#ff6b6b', fontWeight: 'bold' }}>Frontend:</div>
                <code style={{ display: 'block', padding: '2px 0' }}>POST /start-game</code>
                <code style={{ display: 'block', padding: '2px 0' }}>POST /new-game</code>
                <code style={{ display: 'block', padding: '2px 0' }}>GET /state</code>
                <code style={{ display: 'block', padding: '2px 0' }}>WS /ws</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
