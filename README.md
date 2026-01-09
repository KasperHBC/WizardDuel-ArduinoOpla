# ⚡ Wizard Duel - Arduino Opla Edition

Et multiplayer troldmandskamp-spil hvor 2-4 spillere kæmper mod hinanden med magi! Spillerne styrer deres wizard med en Arduino Opla IoT Kit, mens kampen vises live på en webbaseret arena.

<img width="2752" height="1536" alt="unnamed" src="https://github.com/user-attachments/assets/c3c089b9-c248-494e-9f81-e47cac893035" />


## 🎮 Sådan fungerer spillet

- Hver spiller forbinder deres **Arduino Opla** til bridge-serveren
- Spillerne kommer i en ventekø indtil spillet startes
- I kampen har hver wizard **100 HP** og **100 Mana**
- Cast spells for at skade modstandere eller heale dig selv
- **Sidste wizard i live vinder!**

### ✨ Tilgængelige Spells

| Spell | Skade | Mana | Type |
|-------|-------|------|------|
| 🔥 Fireball | 10 dmg | 20 | Single target |
| ⚡ Lightning Storm | 10 dmg | 50 | Alle modstandere |
| 🛡️ Shield | - | 25 | Halverer indkommende skade i 5 sek |
| 💚 Heal | +20 HP | 40 | Healer dig selv |
| ✨ Power Boost | - | 40 | +50% skade i 10 sek |
| 💀 Death Ray | 40 dmg | 80 | Single target |

---

## 🚀 Hurtig Start (Windows)

### Forudsætninger
- [Node.js](https://nodejs.org/) (v18 eller nyere)
- Arduino IDE med Arduino Opla libraries

### Installation

1. **Klon repository:**
   ```bash
   git clone https://github.com/[dit-brugernavn]/WizardDuel-ArduinoOpla.git
   cd WizardDuel-ArduinoOpla
   ```

2. **Installer dependencies:**
   ```bash
   cd opla-wizard-bridge
   npm install
   cd ../wizard-duel
   npm install
   cd ..
   ```

3. **Start spillet:**
   
   Dobbeltklik på `START_WIZARD_DUEL.bat` eller kør:
   ```bash
   START_WIZARD_DUEL.bat
   ```

   Dette starter automatisk:
   - **Bridge Server** på `http://[din-ip]:3000`
   - **Frontend** på `http://localhost:5173`

4. **Upload Arduino kode:**
   - Åbn `ArduinoKode/WizardDuel_Student/WizardDuel_START.ino` i Arduino IDE
   - Upload til din Arduino Opla

---

## 📁 Projektstruktur

```
WizardDuel-ArduinoOpla/
├── ArduinoKode/
│   └── WizardDuel_Student/     # Arduino kode til Opla
├── opla-wizard-bridge/         # Node.js bridge server
│   └── bridge.js               # Server der forbinder Arduino ↔ Frontend
├── wizard-duel/                # React frontend
│   └── src/
│       └── WizardDuel.tsx      # Hovedkomponent med spilvisning
├── START_WIZARD_DUEL.bat       # Windows launcher script
└── README.md
```

---

## 🔌 Arkitektur

```
┌─────────────┐     HTTP/REST      ┌─────────────────┐     WebSocket     ┌─────────────┐
│   Arduino   │ ◄────────────────► │  Bridge Server  │ ◄───────────────► │   Frontend  │
│    Opla     │    /join-queue     │   (Port 3000)   │       /ws         │ (Port 5173) │
│             │    /cast-spell     │                 │                   │             │
│             │    /heartbeat      │                 │                   │             │
└─────────────┘                    └─────────────────┘                   └─────────────┘
```

### API Endpoints

**Arduino → Bridge:**
- `POST /join-queue` - Tilmeld dig køen
- `POST /heartbeat` - Hold forbindelsen i live
- `POST /cast-spell` - Cast en spell
- `GET /my-state/:deviceId` - Hent din nuværende status

**Frontend → Bridge:**
- `POST /start-game` - Start spil med spillere fra køen
- `POST /new-game` - Nulstil og start nyt spil
- `GET /state` - Hent fuld spiltilstand
- `WS /ws` - WebSocket til real-time opdateringer

---

## 🎯 Spilgang

1. **Tilslut Arduino:** Upload koden og forbind til WiFi
2. **Join kø:** Arduino sender automatisk `/join-queue`
3. **Vent på spillere:** Minimum 2 spillere skal være i køen
4. **Start kamp:** Tryk "Start Kamp" i frontend
5. **Kæmp!** Brug Arduino'ens knapper til at caste spells
6. **Vinder:** Sidste wizard med HP > 0 vinder

---

## 🛠️ Manuel Start (hvis .bat ikke virker)

**Terminal 1 - Bridge Server:**
```bash
cd opla-wizard-bridge
npm start
```

**Terminal 2 - Frontend:**
```bash
cd wizard-duel
npm run dev
```

---

## 📝 Licens

MIT License - frit at bruge og modificere.

---

**God kamp, wizard! ⚡🧙‍♂️**
