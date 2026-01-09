const express = require("express");
const http = require("http");
const cors = require("cors");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

// ===========================================
// GAME CONFIGURATION
// ===========================================
const MANA_REGEN_RATE = 5;        // mana per sekund
const MANA_REGEN_INTERVAL = 1000; // ms
const HEARTBEAT_TIMEOUT = 10000;  // 10 sekunder uden heartbeat = disconnect
const MAX_PLAYERS = 4;

// Spell definitions (ingen cooldown)
const SPELLS = {
  FIREBALL:    { name: "Fireball",       damage: 10, manaCost: 20, type: "single" },
  LIGHTNING:   { name: "Lightning Storm", damage: 10, manaCost: 50, type: "aoe" },
  SHIELD:      { name: "Shield",          damage: 0,  manaCost: 25, type: "self", effect: "shield", duration: 5000 },
  HEAL:        { name: "Heal",            damage: -20, manaCost: 40, type: "self" },
  POWER_BOOST: { name: "Power Boost",     damage: 0,  manaCost: 40, type: "self", effect: "boost", duration: 10000 },
  DEATH_RAY:   { name: "Death Ray",       damage: 40, manaCost: 80, type: "single" }
};

// ===========================================
// GAME STATE
// ===========================================
const queue = [];        // Venter på at komme i spil: [{ deviceId, lastHeartbeat }]
const players = {};      // I spil: wizardId -> { deviceId, hp, mana, alive, shield, boost, lastHeartbeat }
let gameStarted = false;
let nextWizardId = 0;

// ===========================================
// HELPERS
// ===========================================
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function getQueuePosition(deviceId) {
  return queue.findIndex(q => q.deviceId === deviceId);
}

function isInQueue(deviceId) {
  return getQueuePosition(deviceId) >= 0;
}

function isPlaying(deviceId) {
  return Object.values(players).some(p => p.deviceId === deviceId);
}

function getWizardIdByDevice(deviceId) {
  for (const [wizardId, player] of Object.entries(players)) {
    if (player.deviceId === deviceId) return parseInt(wizardId);
  }
  return -1;
}

function removeFromQueue(deviceId) {
  const idx = getQueuePosition(deviceId);
  if (idx >= 0) {
    queue.splice(idx, 1);
    broadcastState();
  }
}

function disconnectPlayer(wizardId, reason = "disconnected") {
  const player = players[wizardId];
  if (player) {
    console.log(`Player ${wizardId} disconnected: ${reason}`);
    delete players[wizardId];
    broadcast({ type: "player-disconnected", wizardId, reason });
    broadcastState();
    
    // Check om spillet skal stoppe
    const alivePlayers = Object.values(players).filter(p => p.alive);
    if (gameStarted && alivePlayers.length <= 1) {
      if (alivePlayers.length === 1) {
        const winnerId = Object.entries(players).find(([_, p]) => p.alive)?.[0];
        broadcast({ type: "game-over", winnerId: parseInt(winnerId), reason: "winner" });
      } else {
        broadcast({ type: "game-over", winnerId: null, reason: "draw" });
      }
      gameStarted = false;
      broadcastState();
    }
  }
}

function createPlayer(deviceId, wizardId) {
  return {
    deviceId,
    hp: 100,
    maxHp: 100,
    mana: 100,
    maxMana: 100,
    alive: true,
    shield: false,
    boost: false,
    lastHeartbeat: Date.now()
  };
}

function broadcastState() {
  broadcast({
    type: "state-update",
    gameStarted,
    players: Object.entries(players).map(([id, p]) => ({
      wizardId: parseInt(id),
      deviceId: p.deviceId,
      hp: p.hp,
      maxHp: p.maxHp,
      mana: p.mana,
      maxMana: p.maxMana,
      alive: p.alive,
      shield: p.shield,
      boost: p.boost
    })),
    queue: queue.map((q, idx) => ({ deviceId: q.deviceId, position: idx + 1 }))
  });
}

// ===========================================
// MANA REGENERATION
// ===========================================
setInterval(() => {
  if (!gameStarted) return;
  
  let changed = false;
  for (const player of Object.values(players)) {
    if (player.alive && player.mana < player.maxMana) {
      player.mana = Math.min(player.maxMana, player.mana + MANA_REGEN_RATE);
      changed = true;
    }
  }
  
  if (changed) {
    broadcastState();
  }
}, MANA_REGEN_INTERVAL);

// ===========================================
// HEARTBEAT CHECK - Disconnect inactive players
// ===========================================
setInterval(() => {
  const now = Date.now();
  
  // Check queue
  for (let i = queue.length - 1; i >= 0; i--) {
    if (now - queue[i].lastHeartbeat > HEARTBEAT_TIMEOUT) {
      console.log(`Queue player ${queue[i].deviceId} timed out`);
      queue.splice(i, 1);
      broadcastState();
    }
  }
  
  // Check players
  for (const [wizardId, player] of Object.entries(players)) {
    if (now - player.lastHeartbeat > HEARTBEAT_TIMEOUT) {
      disconnectPlayer(parseInt(wizardId), "timeout");
    }
  }
}, 2000);

// ===========================================
// API ENDPOINTS
// ===========================================

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Arduino joins queue
app.post("/join-queue", (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ success: false, message: "Missing deviceId" });
  }

  // Allerede i kø?
  if (isInQueue(deviceId)) {
    const pos = getQueuePosition(deviceId);
    // Opdater heartbeat
    queue[pos].lastHeartbeat = Date.now();
    return res.json({ success: true, inQueue: true, position: pos + 1 });
  }

  // Allerede i spil?
  if (isPlaying(deviceId)) {
    const wizardId = getWizardIdByDevice(deviceId);
    players[wizardId].lastHeartbeat = Date.now();
    return res.json({ success: true, inGame: true, wizardId });
  }

  // Tilføj til kø
  queue.push({ deviceId, lastHeartbeat: Date.now() });
  const position = queue.length;
  
  console.log(`${deviceId} joined queue at position ${position}`);
  broadcast({ type: "queue-joined", deviceId, position });
  broadcastState();
  
  res.json({ success: true, inQueue: true, position });
});

// Arduino heartbeat - holder forbindelse i live
app.post("/heartbeat", (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) {
    return res.status(400).json({ success: false, message: "Missing deviceId" });
  }

  // I kø?
  const queuePos = getQueuePosition(deviceId);
  if (queuePos >= 0) {
    queue[queuePos].lastHeartbeat = Date.now();
    return res.json({ success: true, inQueue: true, position: queuePos + 1 });
  }

  // I spil?
  const wizardId = getWizardIdByDevice(deviceId);
  if (wizardId >= 0) {
    const player = players[wizardId];
    player.lastHeartbeat = Date.now();
    return res.json({
      success: true,
      inGame: true,
      wizardId,
      hp: player.hp,
      mana: player.mana,
      alive: player.alive,
      shield: player.shield,
      boost: player.boost,
      gameStarted
    });
  }

  // Ikke fundet - skal joine igen
  res.json({ success: false, message: "Not in queue or game. Please join." });
});

// Arduino caster spell
app.post("/cast-spell", (req, res) => {
  const { deviceId, spellKey, targetId } = req.body || {};
  
  if (!deviceId || !spellKey) {
    return res.status(400).json({ success: false, message: "Missing deviceId or spellKey" });
  }

  if (!gameStarted) {
    return res.json({ success: false, message: "Game not started" });
  }

  const wizardId = getWizardIdByDevice(deviceId);
  if (wizardId < 0) {
    return res.json({ success: false, message: "Not in game" });
  }

  const caster = players[wizardId];
  if (!caster || !caster.alive) {
    return res.json({ success: false, message: "You are dead" });
  }

  const spell = SPELLS[spellKey];
  if (!spell) {
    return res.json({ success: false, message: "Unknown spell" });
  }

  if (caster.mana < spell.manaCost) {
    return res.json({ success: false, message: "Not enough mana", mana: caster.mana, required: spell.manaCost });
  }

  // Træk mana
  caster.mana -= spell.manaCost;
  caster.lastHeartbeat = Date.now();

  // Apply spell
  const results = [];
  
  switch (spell.type) {
    case "single":
      if (targetId !== undefined && players[targetId] && players[targetId].alive) {
        const target = players[targetId];
        const damage = spell.damage * (caster.boost ? 1.5 : 1);
        const actualDamage = target.shield ? damage * 0.5 : damage;
        target.hp = Math.max(0, target.hp - actualDamage);
        results.push({ targetId, damage: actualDamage, shielded: target.shield });
        
        if (target.hp <= 0) {
          target.alive = false;
          results.push({ targetId, killed: true });
          broadcast({ type: "player-killed", wizardId: targetId, killedBy: wizardId });
        }
      }
      break;
      
    case "aoe":
      for (const [id, target] of Object.entries(players)) {
        const tid = parseInt(id);
        if (tid !== wizardId && target.alive) {
          const damage = spell.damage * (caster.boost ? 1.5 : 1);
          const actualDamage = target.shield ? damage * 0.5 : damage;
          target.hp = Math.max(0, target.hp - actualDamage);
          
          const result = { targetId: tid, damage: actualDamage, shielded: target.shield, killed: false };
          
          if (target.hp <= 0) {
            target.alive = false;
            result.killed = true;
            broadcast({ type: "player-killed", wizardId: tid, killedBy: wizardId });
          }
          
          results.push(result);
        }
      }
      break;
      
    case "self":
      if (spell.effect === "shield") {
        caster.shield = true;
        setTimeout(() => {
          if (players[wizardId]) {
            players[wizardId].shield = false;
            broadcastState();
          }
        }, spell.duration);
        results.push({ effect: "shield", duration: spell.duration });
      } else if (spell.effect === "boost") {
        caster.boost = true;
        setTimeout(() => {
          if (players[wizardId]) {
            players[wizardId].boost = false;
            broadcastState();
          }
        }, spell.duration);
        results.push({ effect: "boost", duration: spell.duration });
      } else if (spell.damage < 0) {
        // Heal
        const healAmount = -spell.damage;
        caster.hp = Math.min(caster.maxHp, caster.hp + healAmount);
        results.push({ healed: healAmount });
      }
      break;
  }

  broadcast({ 
    type: "spell-cast", 
    casterId: wizardId, 
    spellKey, 
    targetId,
    results 
  });
  
  broadcastState();

  // Check for winner
  const alivePlayers = Object.entries(players).filter(([_, p]) => p.alive);
  if (alivePlayers.length <= 1) {
    if (alivePlayers.length === 1) {
      const winnerId = parseInt(alivePlayers[0][0]);
      broadcast({ type: "game-over", winnerId, reason: "winner" });
    } else {
      broadcast({ type: "game-over", winnerId: null, reason: "draw" });
    }
    gameStarted = false;
    broadcastState();
  }

  res.json({ 
    success: true, 
    manaLeft: caster.mana, 
    results 
  });
});

// Frontend: Start game
app.post("/start-game", (_req, res) => {
  if (gameStarted) {
    return res.json({ success: false, message: "Game already started" });
  }

  if (queue.length < 2) {
    return res.json({ success: false, message: "Need at least 2 players in queue" });
  }

  // Tag op til 4 spillere fra køen
  const playersToAdd = queue.splice(0, MAX_PLAYERS);
  
  // Reset og tilføj spillere
  for (const [idx, queuedPlayer] of playersToAdd.entries()) {
    players[idx] = createPlayer(queuedPlayer.deviceId, idx);
    broadcast({ type: "player-joined", wizardId: idx, deviceId: queuedPlayer.deviceId });
  }
  
  nextWizardId = playersToAdd.length;
  gameStarted = true;
  
  console.log(`Game started with ${playersToAdd.length} players`);
  broadcast({ type: "game-started", playerCount: playersToAdd.length });
  broadcastState();
  
  res.json({ success: true, playerCount: playersToAdd.length });
});

// Frontend: New game (kick all, take next from queue)
app.post("/new-game", (_req, res) => {
  // Disconnect alle nuværende spillere
  for (const wizardId of Object.keys(players)) {
    broadcast({ type: "player-kicked", wizardId: parseInt(wizardId) });
  }
  
  // Clear players
  for (const key of Object.keys(players)) {
    delete players[key];
  }
  
  gameStarted = false;
  nextWizardId = 0;
  
  broadcast({ type: "game-reset" });
  broadcastState();
  
  res.json({ success: true, queueLength: queue.length });
});

// Get full state
app.get("/state", (_req, res) => {
  res.json({
    success: true,
    gameStarted,
    players: Object.entries(players).map(([id, p]) => ({
      wizardId: parseInt(id),
      deviceId: p.deviceId,
      hp: p.hp,
      maxHp: p.maxHp,
      mana: p.mana,
      maxMana: p.maxMana,
      alive: p.alive,
      shield: p.shield,
      boost: p.boost
    })),
    queue: queue.map((q, idx) => ({ deviceId: q.deviceId, position: idx + 1 })),
    spells: SPELLS
  });
});

// Arduino: Get my state
app.get("/my-state/:deviceId", (req, res) => {
  const { deviceId } = req.params;
  
  // I kø?
  const queuePos = getQueuePosition(deviceId);
  if (queuePos >= 0) {
    queue[queuePos].lastHeartbeat = Date.now();
    return res.json({ 
      success: true, 
      status: "queue", 
      position: queuePos + 1,
      totalInQueue: queue.length
    });
  }
  
  // I spil?
  const wizardId = getWizardIdByDevice(deviceId);
  if (wizardId >= 0) {
    const player = players[wizardId];
    player.lastHeartbeat = Date.now();
    return res.json({
      success: true,
      status: player.alive ? "playing" : "dead",
      wizardId,
      hp: player.hp,
      maxHp: player.maxHp,
      mana: player.mana,
      maxMana: player.maxMana,
      alive: player.alive,
      shield: player.shield,
      boost: player.boost,
      gameStarted
    });
  }
  
  res.json({ success: false, status: "not_connected" });
});

// ===========================================
// HTTP SERVER + WEBSOCKET
// ===========================================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  
  // Send current state
  ws.send(JSON.stringify({
    type: "welcome",
    gameStarted,
    players: Object.entries(players).map(([id, p]) => ({
      wizardId: parseInt(id),
      deviceId: p.deviceId,
      hp: p.hp,
      maxHp: p.maxHp,
      mana: p.mana,
      maxMana: p.maxMana,
      alive: p.alive,
      shield: p.shield,
      boost: p.boost
    })),
    queue: queue.map((q, idx) => ({ deviceId: q.deviceId, position: idx + 1 })),
    spells: SPELLS
  }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("===========================================");
  console.log("   WIZARD DUEL BRIDGE SERVER");
  console.log("===========================================");
  console.log(`   HTTP:      http://0.0.0.0:${PORT}`);
  console.log(`   WebSocket: ws://0.0.0.0:${PORT}/ws`);
  console.log("");
  console.log("   ARDUINO ENDPOINTS:");
  console.log("   ------------------");
  console.log("   POST /join-queue     - Join the waiting queue");
  console.log("   POST /heartbeat      - Keep connection alive");
  console.log("   POST /cast-spell     - Cast a spell");
  console.log("   GET  /my-state/:id   - Get your current state");
  console.log("");
  console.log("   FRONTEND ENDPOINTS:");
  console.log("   --------------------");
  console.log("   POST /start-game     - Start game with queued players");
  console.log("   POST /new-game       - Reset and start new game");
  console.log("   GET  /state          - Get full game state");
  console.log("   GET  /health         - Health check");
  console.log("===========================================");
  console.log("");
});
