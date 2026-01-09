/*
 * ========================================
 * WIZARD DUEL - STUDENT STARTER KIT
 * ========================================
 * 
 * Dit mål: Programmér din Arduino Opla til at spille Wizard Duel!
 * 
 * SPILLET:
 * - Du joiner en kø og venter på at kampen starter
 * - Når kampen starter, kan du kaste spells mod andre wizards
 * - Brug mana klogt - den regenererer over tid
 * - Sidste wizard i live vinder!
 * 
 * ========================================
 * API ENDPOINTS (alle bruger JSON)
 * ========================================
 * 
 * POST /join-queue
 *   Send: { "deviceId": "DIN_ID" }
 *   Svar: { "success": true, "inQueue": true, "position": 1 }
 *      eller: { "success": true, "inGame": true, "wizardId": 0 }
 * 
 * POST /heartbeat  (VIGTIGT! Send hver 2-5 sek for at blive i spillet)
 *   Send: { "deviceId": "DIN_ID" }
 *   Svar: { "success": true, "inQueue": true, "position": 1 }
 *      eller: { 
 *        "success": true, 
 *        "inGame": true, 
 *        "wizardId": 0,
 *        "hp": 100,
 *        "mana": 75,
 *        "alive": true,
 *        "shield": false,
 *        "boost": false,
 *        "gameStarted": true
 *      }
 * 
 * POST /cast-spell
 *   Send: { "deviceId": "DIN_ID", "spellKey": "FIREBALL", "targetId": 1 }
 *   Svar: { "success": true, "manaLeft": 55 }
 *      eller: { "success": false, "message": "Not enough mana" }
 * 
 * ========================================
 * SPELLS (spellKey værdier)
 * ========================================
 * 
 * "FIREBALL"     - 25 damage, 20 mana, rammer én (targetId required)
 * "LIGHTNING"    - 15 damage, 30 mana, rammer ALLE andre
 * "SHIELD"       - 0 damage, 25 mana, halverer indkommende skade i 5 sek
 * "HEAL"         - healer 20 HP, 35 mana
 * "POWER_BOOST"  - 0 damage, 40 mana, +50% damage i 8 sek
 * "DEATH_RAY"    - 40 damage, 50 mana, rammer én (targetId required)
 * 
 * ========================================
 * TOUCH PADS PÅ OPLA (set oppefra)
 * ========================================
 * 
 *          [TOUCH4]
 *     [TOUCH0]  [TOUCH3]
 *          [TOUCH2]
 *          [TOUCH1]
 * 
 * ========================================
 */

#include <WiFiNINA.h>
#include <Arduino_JSON.h>
#include <Arduino_MKRIoTCarrier.h>

MKRIoTCarrier carrier;
WiFiClient client;

// =============================================
// KONFIGURATION - UDFYLD DETTE!
// =============================================
const char WIFI_SSID[] = "WIFI_NAVN_HER";      // WiFi navn
const char WIFI_PASS[] = "WIFI_PASSWORD_HER";  // WiFi password
const char SERVER_IP[] = "192.168.1.XXX";      // Server IP adresse
const int SERVER_PORT = 3000;                   // Server port
// =============================================

// Dit unikke device ID (genereres automatisk fra MAC adresse)
String deviceId;

// Skærm størrelse
const int SCREEN_WIDTH = 240;
const int SCREEN_HEIGHT = 240;

// =============================================
// HTTP HELPER FUNKTIONER (brug disse!)
// =============================================

// Læs HTTP response body
String httpReadBody() {
  while (client.connected()) {
    String line = client.readStringUntil('\n');
    if (line == "\r" || line.length() == 0) break;
  }
  return client.readString();
}

// Send POST request med JSON - returnerer true hvis success
// Eksempel: httpPost("/join-queue", "{\"deviceId\":\"test\"}", response);
bool httpPost(const char* endpoint, String jsonBody, String& responseBody) {
  Serial.print("POST ");
  Serial.print(endpoint);
  Serial.print(" -> ");
  
  if (!client.connect(SERVER_IP, SERVER_PORT)) {
    Serial.println("CONNECTION FAILED!");
    return false;
  }

  client.print("POST ");
  client.print(endpoint);
  client.println(" HTTP/1.1");
  client.print("Host: ");
  client.println(SERVER_IP);
  client.println("Content-Type: application/json");
  client.print("Content-Length: ");
  client.println(jsonBody.length());
  client.println("Connection: close");
  client.println();
  client.print(jsonBody);

  String statusLine = client.readStringUntil('\n');
  responseBody = httpReadBody();
  client.stop();
  
  // Find JSON i response
  int jsonStart = responseBody.indexOf('{');
  if (jsonStart >= 0) {
    responseBody = responseBody.substring(jsonStart);
  }
  
  bool success = statusLine.indexOf("200") > 0;
  Serial.println(success ? "OK" : "FAILED");
  return success;
}

// =============================================
// DISPLAY HELPER FUNKTIONER (brug disse!)
// =============================================

// Tegn tekst centreret på skærmen
// Eksempel: drawCentered("Hello!", 100, 2, ST77XX_WHITE);
void drawCentered(const char* text, int y, int size, uint16_t color) {
  carrier.display.setTextSize(size);
  carrier.display.setTextColor(color);
  
  int charWidth = 6 * size;
  int textWidth = strlen(text) * charWidth;
  int x = (SCREEN_WIDTH - textWidth) / 2;
  
  carrier.display.setCursor(x, y);
  carrier.display.print(text);
}

// Tegn tekst centreret (String version)
void drawCentered(String text, int y, int size, uint16_t color) {
  drawCentered(text.c_str(), y, size, color);
}

// Ryd skærmen med en farve
// Eksempel: clearScreen(ST77XX_BLACK);
void clearScreen(uint16_t color) {
  carrier.display.fillScreen(color);
}

// Tegn en progress bar
// Eksempel: drawProgressBar(50, 200, 100, 100, ST77XX_RED);  // 50% HP bar
void drawProgressBar(int x, int y, int width, int height, 
                     int value, int maxValue, uint16_t fillColor) {
  // Baggrund
  carrier.display.fillRect(x, y, width, height, ST77XX_BLACK);
  carrier.display.drawRect(x, y, width, height, ST77XX_WHITE);
  
  // Fill
  int fillWidth = (width - 2) * value / maxValue;
  carrier.display.fillRect(x + 1, y + 1, fillWidth, height - 2, fillColor);
}

// =============================================
// FARVER DU KAN BRUGE
// =============================================
// ST77XX_BLACK, ST77XX_WHITE, ST77XX_RED, ST77XX_GREEN, 
// ST77XX_BLUE, ST77XX_YELLOW, ST77XX_CYAN, ST77XX_MAGENTA

// =============================================
// SETUP - Kører én gang ved start
// =============================================
void setup() {
  Serial.begin(9600);
  delay(1000);
  
  Serial.println("================");
  Serial.println("WIZARD DUEL");
  Serial.println("================");
  
  // Initialiser Opla carrier
  carrier.noCase();  // Brug carrier.withCase() hvis du har casen på
  carrier.begin();
  carrier.display.setRotation(0);
  carrier.display.fillScreen(ST77XX_BLACK);
  carrier.display.setTextWrap(false);
  
  // Generer unikt device ID fra MAC adresse
  byte mac[6];
  WiFi.macAddress(mac);
  char buf[20];
  snprintf(buf, sizeof(buf), "OPLA_%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceId = String(buf);
  
  Serial.print("Device ID: ");
  Serial.println(deviceId);
  
  // Vis WiFi status på skærm
  clearScreen(ST77XX_BLACK);
  drawCentered("Connecting", 80, 2, ST77XX_WHITE);
  drawCentered("to WiFi...", 110, 2, ST77XX_WHITE);
  
  // Forbind til WiFi
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println(" Connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  
  // Vis success
  clearScreen(ST77XX_GREEN);
  drawCentered("WiFi OK!", 100, 2, ST77XX_BLACK);
  delay(1000);
  
  // Klar til at starte!
  clearScreen(ST77XX_BLACK);
  drawCentered("WIZARD DUEL", 60, 2, ST77XX_YELLOW);
  drawCentered("Ready!", 120, 2, ST77XX_GREEN);
  drawCentered("Press a button", 180, 1, ST77XX_WHITE);
  
  Serial.println("");
  Serial.println("=== READY! ===");
  Serial.println("Server: " + String(SERVER_IP) + ":" + String(SERVER_PORT));
  Serial.println("");
}

// =============================================
// LOOP - Kører igen og igen
// =============================================
void loop() {
  // VIGTIGT: Opdater knap-status hver loop
  carrier.Buttons.update();
  
  // =============================================
  // DIN KODE HER!
  // =============================================
  // 
  // Tips:
  // 
  // 1. Check om en knap bliver rørt:
  //    if (carrier.Buttons.getTouch(TOUCH0)) { ... }
  //    if (carrier.Buttons.getTouch(TOUCH1)) { ... }
  //    if (carrier.Buttons.getTouch(TOUCH2)) { ... }
  //    if (carrier.Buttons.getTouch(TOUCH3)) { ... }
  //    if (carrier.Buttons.getTouch(TOUCH4)) { ... }
  //
  // 2. Send JSON til server:
  //    JSONVar doc;
  //    doc["deviceId"] = deviceId;
  //    doc["spellKey"] = "FIREBALL";
  //    doc["targetId"] = 1;
  //    String json = JSON.stringify(doc);
  //    
  //    String response;
  //    if (httpPost("/cast-spell", json, response)) {
  //      JSONVar res = JSON.parse(response);
  //      if ((bool)res["success"]) {
  //        Serial.println("Spell cast!");
  //      }
  //    }
  //
  // 3. Læs værdier fra JSON response:
  //    int hp = (int)res["hp"];
  //    bool alive = (bool)res["alive"];
  //    String msg = (const char*)res["message"];
  //
  // 4. Husk at sende heartbeat regelmæssigt!
  //    Brug millis() til at tracke tid:
  //    unsigned long now = millis();
  //    if (now - lastHeartbeat > 3000) { ... }
  //
  // 5. Tilføj delay efter knaptryk for at undgå spam:
  //    delay(300);
  //
  // =============================================

  // EKSEMPEL: Print hvilken knap der trykkes (fjern dette når du laver din egen kode)
  if (carrier.Buttons.getTouch(TOUCH0)) {
    Serial.println("TOUCH0 pressed!");
    delay(300);
  }
  if (carrier.Buttons.getTouch(TOUCH1)) {
    Serial.println("TOUCH1 pressed!");
    delay(300);
  }
  if (carrier.Buttons.getTouch(TOUCH2)) {
    Serial.println("TOUCH2 pressed!");
    delay(300);
  }
  if (carrier.Buttons.getTouch(TOUCH3)) {
    Serial.println("TOUCH3 pressed!");
    delay(300);
  }
  if (carrier.Buttons.getTouch(TOUCH4)) {
    Serial.println("TOUCH4 pressed!");
    delay(300);
  }

  delay(50);  // Lille pause for stabilitet
}

// =============================================
// EKSTRA HJÆLPEFUNKTIONER DU KAN BRUGE
// =============================================

// Konverter HP/Mana procent til farve (rød/grøn gradient)
uint16_t getHealthColor(int current, int max) {
  float percent = (float)current / (float)max;
  if (percent > 0.5) return ST77XX_GREEN;
  if (percent > 0.25) return ST77XX_YELLOW;
  return ST77XX_RED;
}

// Vis en besked i midten af skærmen
void showMessage(const char* line1, const char* line2, uint16_t bgColor) {
  clearScreen(bgColor);
  drawCentered(line1, 100, 2, ST77XX_WHITE);
  if (strlen(line2) > 0) {
    drawCentered(line2, 140, 2, ST77XX_WHITE);
  }
}

