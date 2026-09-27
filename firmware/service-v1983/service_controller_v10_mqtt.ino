/*
 * Service Controller V10 MQTT
 * Baseline: working V1983 TARGET-UART/OLED/SIM800L controller (V5 source).
 * MQTT is encoded directly over the existing SIM800L TCP transport so every
 * service publication uses QoS 1. config.h is local-only and ignored by Git.
 */
#define TINY_GSM_MODEM_SIM800
#define TINY_GSM_RX_BUFFER 512

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Preferences.h>
#include <TinyGsmClient.h>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>
#include "config.h"

namespace {
constexpr int MODEM_RX = 26;
constexpr int MODEM_TX = 27;
constexpr int MODEM_PWRKEY = 4;
constexpr int MODEM_POWER = 23;
constexpr int MODEM_RST = 14;
constexpr int I2C_SDA = 21;
constexpr int I2C_SCL = 22;
constexpr int ENC_A = 18;
constexpr int ENC_B = 19;
constexpr int ENC_PUSH = 25;
constexpr int BUTTON_BACK = 32;
constexpr int TARGET_RX = 33;
constexpr int TARGET_TX = 13;
constexpr uint8_t OLED_ADDR_PRIMARY = 0x3C;
constexpr uint8_t OLED_ADDR_ALTERNATE = 0x3D;
constexpr uint32_t HEARTBEAT_MS = 45000UL;
constexpr uint32_t NETWORK_CHECK_MS = 60000UL;
constexpr uint32_t OLED_REFRESH_MS = 1500UL;
constexpr uint32_t MAX_BACKOFF_MS = 60000UL;
constexpr char FW_VERSION[] = "service_controller_v10_mqtt";

HardwareSerial SerialAT(2);
HardwareSerial TargetSerial(1);
TinyGsm modem(SerialAT);
Adafruit_SH1106G display(128, 64, &Wire);
Preferences preferences;

volatile int32_t encoderDelta = 0;
volatile bool encoderChanged = false;
volatile bool pushEvent = false;
volatile bool backEvent = false;
bool oledReady = false;
bool modemReady = false;
bool networkReady = false;
bool gprsReady = false;
bool mqttOnline = false;
uint8_t oledAddress = OLED_ADDR_PRIMARY;
uint16_t mqttPacketId = 1;
uint32_t bootId = 0;
uint8_t failures = 0;
uint32_t retryAt = 0;
uint32_t lastHeartbeatAt = 0;
uint32_t lastNetworkCheck = 0;
uint32_t lastOledRefresh = 0;
uint32_t lastWakeCommand = 0;
String gprsIp;
String lastTargetLine;
String targetBuffer;
String recentCommandIds;
uint8_t rxBuffer[2048];
size_t rxCount = 0;

const char *menuItems[] = {"Dashboard", "Modem status", "Network / GPRS", "Main controller"};
int menuIndex = 0;

const String heartbeatTopic = String("service/") + SERVICE_CONTROLLER_ID + "/heartbeat";
const String logTopic = String("service/") + SERVICE_CONTROLLER_ID + "/log";
const String statusTopic = String("service/") + SERVICE_CONTROLLER_ID + "/status";
const String commandTopic = String("service/") + SERVICE_CONTROLLER_ID + "/command";
const String commandResultTopic = String("service/") + SERVICE_CONTROLLER_ID + "/command/result";

bool elapsed(uint32_t deadline) { return static_cast<int32_t>(millis() - deadline) >= 0; }
const char *resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_EXT: return "external";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt_watchdog";
    case ESP_RST_TASK_WDT: return "task_watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    default: return "unknown";
  }
}
void resetRx() { rxCount = 0; }
void drainRx() { while (SerialAT.available() && rxCount < sizeof(rxBuffer)) rxBuffer[rxCount++] = SerialAT.read(); }

void IRAM_ATTR onEncoderA() {
  static uint8_t last = 0;
  uint8_t now = (digitalRead(ENC_A) << 1) | digitalRead(ENC_B);
  uint8_t code = (last << 2) | now;
  if (code == 0b1101 || code == 0b0100 || code == 0b0010 || code == 0b1011) ++encoderDelta;
  if (code == 0b1110 || code == 0b0111 || code == 0b0001 || code == 0b1000) --encoderDelta;
  last = now; encoderChanged = true;
}
void IRAM_ATTR onEncoderB() { onEncoderA(); }
void IRAM_ATTR onPush() { pushEvent = true; }
void IRAM_ATTR onBack() { backEvent = true; }

void drawHeader(const char *title) {
  if (!oledReady) return;
  display.clearDisplay(); display.setTextColor(SH110X_WHITE); display.setTextSize(1);
  display.setCursor(0, 0); display.println("SERVICE V10 MQTT");
  display.drawLine(0, 10, 127, 10, SH110X_WHITE); display.setCursor(0, 15); display.println(title);
}
void drawDashboard() {
  if (!oledReady) return;
  drawHeader("DASHBOARD");
  display.setCursor(0, 26); display.print("IP: "); display.println(gprsIp.length() ? gprsIp : "offline");
  display.setCursor(0, 36); display.print("MQTT: "); display.println(mqttOnline ? "ONLINE" : "RETRYING");
  display.setCursor(0, 46); display.print("HB: "); display.print((millis() - lastHeartbeatAt) / 1000UL); display.println("s");
  display.setCursor(0, 56); display.print("TARGET: "); display.println(lastTargetLine.substring(0, 15));
  display.display();
}
void showMessage(const String &first, const String &second = "") {
  if (!oledReady) return;
  drawHeader("STATUS"); display.setCursor(0, 35); display.println(first);
  if (second.length()) { display.setCursor(0, 52); display.println(second); }
  display.display();
}
void drawMenu() {
  if (!oledReady) return;
  drawHeader("MENU");
  for (int i = 0; i < 4; ++i) { display.setCursor(0, 24 + i * 10); display.print(i == menuIndex ? "> " : "  "); display.println(menuItems[i]); }
  display.display();
}

bool waitForText(const char *expected, uint32_t timeoutMs) {
  String received; received.reserve(384); uint32_t until = millis() + timeoutMs;
  while (!elapsed(until)) {
    while (SerialAT.available()) { char c = static_cast<char>(SerialAT.read()); if (rxCount < sizeof(rxBuffer)) rxBuffer[rxCount++] = c; if (received.length() < 360) received += c; }
    if (received.indexOf(expected) >= 0) return true;
    delay(5);
  }
  return false;
}
bool at(const String &command, const char *expected = "OK", uint32_t timeoutMs = 5000) {
  resetRx(); Serial.println(String("AT >> ") + command); SerialAT.println(command);
  bool ok = waitForText(expected, timeoutMs); Serial.println(ok ? "AT << OK" : "AT << TIMEOUT"); return ok;
}
String atResponse(const String &command, uint32_t timeoutMs) {
  resetRx(); SerialAT.println(command); uint32_t until = millis() + timeoutMs; String response;
  while (!elapsed(until)) { while (SerialAT.available()) { char c = SerialAT.read(); if (rxCount < sizeof(rxBuffer)) rxBuffer[rxCount++] = c; if (response.length() < 512) response += c; } delay(5); }
  return response;
}

bool formatUtc(time_t value, char *output, size_t size) {
  tm utc{}; return value > 1767225600 && gmtime_r(&value, &utc) && strftime(output, size, "%Y-%m-%dT%H:%M:%SZ", &utc) == 20;
}
bool utcNow(char *output, size_t size) { return formatUtc(time(nullptr), output, size); }
int64_t daysFromCivil(int year, unsigned month, unsigned day) {
  year -= month <= 2; const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(year - era * 400);
  const unsigned doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return static_cast<int64_t>(era) * 146097 + doe - 719468;
}
bool syncClock() {
  if (!at("AT+SAPBR=3,1,\"Contype\",\"GPRS\"")) return false;
  if (!at(String("AT+SAPBR=3,1,\"APN\",\"") + GPRS_APN + "\"")) return false;
  if (!at("AT+SAPBR=1,1", "OK", 85000) || !at("AT+CNTPCID=1") ||
      !at(String("AT+CNTP=\"") + NTP_SERVER + "\",0") || !at("AT+CNTP", "+CNTP: 1", 90000)) return false;
  String value = atResponse("AT+CCLK?", 3000); at("AT+SAPBR=0,1", "OK", 30000);
  int q1 = value.indexOf('"'); int q2 = value.indexOf('"', q1 + 1); if (q1 < 0 || q2 < 0) return false;
  String t = value.substring(q1 + 1, q2); if (t.length() < 17) return false;
  int year = 2000 + t.substring(0, 2).toInt(), month = t.substring(3, 5).toInt(), day = t.substring(6, 8).toInt();
  int hour = t.substring(9, 11).toInt(), minute = t.substring(12, 14).toInt(), second = t.substring(15, 17).toInt();
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  time_t epoch = static_cast<time_t>(daysFromCivil(year, month, day) * 86400LL + hour * 3600LL + minute * 60LL + second); if (epoch < 1767225600) return false;
  timeval now{epoch, 0}; settimeofday(&now, nullptr); return true;
}

bool startModem() {
  SerialAT.begin(9600, SERIAL_8N1, MODEM_RX, MODEM_TX); delay(300);
  for (uint8_t attempt = 0; attempt < 4; ++attempt) { if (at("AT", "OK", 1200)) { modemReady = true; break; } delay(500); }
  if (!modemReady) {
    digitalWrite(MODEM_POWER, HIGH); digitalWrite(MODEM_RST, HIGH); digitalWrite(MODEM_PWRKEY, LOW); delay(1500); digitalWrite(MODEM_PWRKEY, HIGH); delay(8000);
    for (uint8_t attempt = 0; attempt < 15 && !modemReady; ++attempt) { if (at("AT", "OK", 1200)) modemReady = true; else delay(500); }
  }
  if (!modemReady) { showMessage("SIM800L AT FAILED"); return false; }
  at("ATE0"); at("AT+CSCLK=0", "OK", 1000); at("AT+IFC=0,0"); showMessage("SIM800L AT: OK"); return true;
}
bool checkNetwork() {
  if (!modemReady) return false; networkReady = false;
  if (!at("AT+CPIN?", "READY", 2000)) return false;
  uint32_t until = millis() + 30000UL;
  while (!elapsed(until)) { String creg = atResponse("AT+CREG?", 1200); if (creg.indexOf(",1") >= 0 || creg.indexOf(",5") >= 0) { networkReady = true; return true; } delay(1200); }
  return false;
}
bool connectGprs() {
  gprsReady = false; gprsIp = ""; if (!networkReady && !checkNetwork()) return false;
  if (!at("AT+CIPSHUT", "SHUT OK", 20000) || !at("AT+CIPMUX=0") || !at("AT+CIPRXGET=0") || !at("AT+CIPQSEND=0")) return false;
  String cstt = String("AT+CSTT=\"") + GPRS_APN + "\",\"" + GPRS_USERNAME + "\",\"" + GPRS_PASSWORD + "\"";
  if (!at(cstt, "OK", 10000) || !at("AT+CIICR", "OK", 85000)) return false;
  gprsIp = atResponse("AT+CIFSR", 10000); gprsIp.trim(); gprsReady = gprsIp.indexOf('.') >= 0; return gprsReady;
}

bool appendBytes(uint8_t *frame, size_t capacity, size_t &atPos, const uint8_t *data, size_t length) { if (atPos + length > capacity) return false; memcpy(frame + atPos, data, length); atPos += length; return true; }
bool appendString(uint8_t *frame, size_t capacity, size_t &atPos, const String &value) { uint16_t len = value.length(); uint8_t prefix[] = {static_cast<uint8_t>(len >> 8), static_cast<uint8_t>(len)}; return appendBytes(frame, capacity, atPos, prefix, 2) && appendBytes(frame, capacity, atPos, reinterpret_cast<const uint8_t *>(value.c_str()), len); }
bool appendRemaining(uint8_t *frame, size_t capacity, size_t &atPos, size_t remaining) { do { if (atPos >= capacity) return false; uint8_t value = remaining % 128; remaining /= 128; if (remaining) value |= 0x80; frame[atPos++] = value; } while (remaining); return true; }
bool sendTcp(const uint8_t *frame, size_t length) { resetRx(); SerialAT.print("AT+CIPSEND="); SerialAT.println(length); if (!waitForText(">", 5000)) return false; if (SerialAT.write(frame, length) != length) return false; SerialAT.flush(); return waitForText("SEND OK", 30000); }
bool waitPacket(uint8_t header, uint32_t timeoutMs) { uint32_t until = millis() + timeoutMs; while (!elapsed(until)) { drainRx(); for (size_t i = 0; i < rxCount; ++i) if (rxBuffer[i] == header) return true; delay(5); } return false; }
uint16_t nextPacketId() { if (++mqttPacketId == 0) ++mqttPacketId; return mqttPacketId; }

bool mqttPublish(const String &topic, const String &payload, bool retained) {
  if (!mqttOnline) return false; uint8_t frame[1024] = {}; size_t pos = 0; uint16_t id = nextPacketId();
  size_t remaining = 2 + topic.length() + 2 + payload.length(); frame[pos++] = retained ? 0x33 : 0x32;
  if (!appendRemaining(frame, sizeof(frame), pos, remaining) || !appendString(frame, sizeof(frame), pos, topic)) return false;
  uint8_t idBytes[] = {static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(id)}; if (!appendBytes(frame, sizeof(frame), pos, idBytes, 2) || !appendBytes(frame, sizeof(frame), pos, reinterpret_cast<const uint8_t *>(payload.c_str()), payload.length())) return false;
  if (!sendTcp(frame, pos) || !waitPacket(0x40, 20000)) return false; return true;
}
String jsonEscape(String input) { input.replace("\\", "\\\\"); input.replace("\"", "\\\""); input.replace("\n", " "); input.replace("\r", " "); return input; }
String eventId(const char *kind) { return String("boot-") + String(bootId, HEX) + ":" + kind + ":" + String(millis()); }
bool publishStatus(const char *state, bool retained = true) { char now[24] = {}; if (!utcNow(now, sizeof(now))) return false; return mqttPublish(statusTopic, String("{\"controllerId\":\"") + SERVICE_CONTROLLER_ID + "\",\"statusId\":\"" + eventId(state) + "\",\"reportedAt\":\"" + now + "\",\"state\":\"" + state + "\"}", retained); }
bool publishLog(const char *level, const String &message) { char now[24] = {}; if (!mqttOnline || !utcNow(now, sizeof(now))) return false; return mqttPublish(logTopic, String("{\"controllerId\":\"") + SERVICE_CONTROLLER_ID + "\",\"logId\":\"" + eventId("log") + "\",\"reportedAt\":\"" + now + "\",\"level\":\"" + level + "\",\"message\":\"" + jsonEscape(message) + "\"}", false); }
int readSignal();
bool publishHeartbeat() {
  char now[24] = {}; if (!utcNow(now, sizeof(now))) return false;
  String ip = gprsIp.length() ? String("\"") + jsonEscape(gprsIp) + "\"" : "null";
  String body = String("{\"controllerId\":\"") + SERVICE_CONTROLLER_ID + "\",\"heartbeatId\":\"" + eventId("heartbeat") + "\",\"reportedAt\":\"" + now + "\",\"ip\":" + ip + ",\"simSignal\":" + String(readSignal()) + ",\"modemState\":\"" + (modemReady ? "ready" : "down") + "\",\"gprsConnected\":" + (gprsReady ? "true" : "false") + ",\"firmwareVersion\":\"" + FW_VERSION + "\",\"uptimeSeconds\":" + String(millis() / 1000UL) + ",\"freeHeapBytes\":" + String(ESP.getFreeHeap()) + ",\"flashBytes\":" + String(ESP.getFlashChipSize()) + ",\"psramBytes\":" + String(ESP.getPsramSize()) + ",\"resetReason\":\"" + resetReasonText() + "\",\"uartConnected\":true}";
  bool ok = mqttPublish(heartbeatTopic, body, false); if (ok) lastHeartbeatAt = millis(); return ok;
}
int readSignal() { String csq = atResponse("AT+CSQ", 1200); int comma = csq.indexOf(','); int colon = csq.indexOf(':'); if (comma < 0 || colon < 0) return 0; int rssi = csq.substring(colon + 1, comma).toInt(); return rssi >= 0 && rssi <= 31 ? rssi : 0; }

bool mqttSubscribe() { uint8_t frame[256] = {}; size_t pos = 0; uint16_t id = nextPacketId(); size_t remaining = 2 + 2 + commandTopic.length() + 1; frame[pos++] = 0x82; if (!appendRemaining(frame, sizeof(frame), pos, remaining)) return false; uint8_t idBytes[] = {static_cast<uint8_t>(id >> 8), static_cast<uint8_t>(id)}; if (!appendBytes(frame, sizeof(frame), pos, idBytes, 2) || !appendString(frame, sizeof(frame), pos, commandTopic)) return false; frame[pos++] = 1; return sendTcp(frame, pos) && waitPacket(0x90, 15000); }
bool connectMqtt() {
  if (!networkReady && !checkNetwork()) return false;
  char timeCheck[24] = {};
  if (!utcNow(timeCheck, sizeof(timeCheck)) && !syncClock()) return false;
  if (!gprsReady && !connectGprs()) return false;
  resetRx(); SerialAT.print("AT+CIPSTART=\"TCP\",\""); SerialAT.print(MQTT_HOST); SerialAT.print("\",\""); SerialAT.print(MQTT_PORT); SerialAT.println("\""); if (!waitForText("CONNECT OK", 30000)) return false;
  char now[24] = {}; if (!utcNow(now, sizeof(now))) return false;
  String clientId = String("service-") + String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX); String will = String("{\"controllerId\":\"") + SERVICE_CONTROLLER_ID + "\",\"statusId\":\"" + eventId("offline") + "\",\"reportedAt\":\"" + now + "\",\"state\":\"offline\"}";
  uint8_t frame[1024] = {}; size_t pos = 0; size_t remaining = 10 + 2 + clientId.length() + 2 + statusTopic.length() + 2 + will.length() + 2 + strlen(MQTT_USERNAME) + 2 + strlen(MQTT_PASSWORD); frame[pos++] = 0x10; if (!appendRemaining(frame, sizeof(frame), pos, remaining)) return false; const uint8_t variableHeader[] = {0,4,'M','Q','T','T',4,0xEE,0,60}; if (!appendBytes(frame, sizeof(frame), pos, variableHeader, sizeof(variableHeader)) || !appendString(frame, sizeof(frame), pos, clientId) || !appendString(frame, sizeof(frame), pos, statusTopic) || !appendString(frame, sizeof(frame), pos, will) || !appendString(frame, sizeof(frame), pos, MQTT_USERNAME) || !appendString(frame, sizeof(frame), pos, MQTT_PASSWORD)) return false;
  if (!sendTcp(frame, pos) || !waitPacket(0x20, 15000)) return false;
  bool accepted = false; for (size_t i = 0; i + 3 < rxCount; ++i) if (rxBuffer[i] == 0x20 && rxBuffer[i + 1] == 0x02 && rxBuffer[i + 2] == 0 && rxBuffer[i + 3] == 0) accepted = true;
  if (!accepted) return false; mqttOnline = true; if (!mqttSubscribe() || !publishStatus("online")) { mqttOnline = false; return false; } publishLog("INFO", "MQTT connected"); return true;
}

String jsonField(const String &payload, const char *field) { String marker = String("\"") + field + "\":\""; int start = payload.indexOf(marker); if (start < 0) return ""; start += marker.length(); int end = payload.indexOf('"', start); return end < 0 ? "" : payload.substring(start, end); }
bool safeCommandId(const String &id) { if (!id.length() || id.length() > 96) return false; for (size_t i = 0; i < id.length(); ++i) if (!isAlphaNumeric(id[i]) && id[i] != '-' && id[i] != '_' && id[i] != ':' && id[i] != '.') return false; return true; }
bool commandWasSeen(const String &id) { return (String("|") + recentCommandIds + "|").indexOf(String("|") + id + "|") >= 0; }
void rememberCommand(const String &id) {
  recentCommandIds += (recentCommandIds.length() ? "|" : "") + id;
  uint8_t count = 1; for (size_t i = 0; i < recentCommandIds.length(); ++i) if (recentCommandIds[i] == '|') ++count;
  while (count > 8) { int separator = recentCommandIds.indexOf('|'); if (separator < 0) break; recentCommandIds.remove(0, separator + 1); --count; }
  preferences.putString("command-ids", recentCommandIds);
}
void publishCommandResult(const String &id, const char *result, const String &message) { char now[24] = {}; if (!utcNow(now, sizeof(now))) return; mqttPublish(commandResultTopic, String("{\"controllerId\":\"") + SERVICE_CONTROLLER_ID + "\",\"commandId\":\"" + id + "\",\"reportedAt\":\"" + now + "\",\"result\":\"" + result + "\",\"message\":\"" + jsonEscape(message) + "\"}", false); }
void processCommand(const String &payload) { String controller = jsonField(payload, "controllerId"); String id = jsonField(payload, "commandId"); String command = jsonField(payload, "command"); if (controller != SERVICE_CONTROLLER_ID || !safeCommandId(id) || (command != "SERVICE PING" && command != "SERVICE STATUS" && command != "SERVICE INFO")) { publishLog("WARN", "Rejected service command"); return; } if (commandWasSeen(id)) { publishCommandResult(id, "ok", "duplicate command ignored"); return; } TargetSerial.println(command); rememberCommand(id); publishLog("INFO", String("TARGET >> ") + command); publishCommandResult(id, "ok", "command forwarded to TARGET UART"); }
void pumpMqtt() {
  if (!mqttOnline) return; drainRx();
  for (size_t i = 0; i + 2 < rxCount; ++i) {
    if ((rxBuffer[i] & 0xF0) != 0x30) continue;
    size_t atPos = i + 1, remaining = 0; uint32_t multiplier = 1; uint8_t encoded;
    do { if (atPos >= rxCount || multiplier > 2097152UL) return; encoded = rxBuffer[atPos++]; remaining += (encoded & 127) * multiplier; multiplier *= 128; } while (encoded & 128);
    const size_t variableStart = atPos, frameEnd = variableStart + remaining;
    if (frameEnd > rxCount || remaining < 2) return;
    uint16_t topicLen = (rxBuffer[atPos] << 8) | rxBuffer[atPos + 1]; atPos += 2;
    if (atPos + topicLen > frameEnd) return;
    String topic; for (uint16_t n = 0; n < topicLen; ++n) topic += char(rxBuffer[atPos++]);
    uint8_t qos = (rxBuffer[i] >> 1) & 3; uint16_t packetId = 0;
    if (qos == 1) { if (atPos + 2 > frameEnd) return; packetId = (rxBuffer[atPos] << 8) | rxBuffer[atPos + 1]; atPos += 2; }
    String payload; for (size_t n = atPos; n < frameEnd; ++n) payload += char(rxBuffer[n]);
    if (qos == 1) { uint8_t ack[] = {0x40, 0x02, static_cast<uint8_t>(packetId >> 8), static_cast<uint8_t>(packetId)}; sendTcp(ack, sizeof(ack)); }
    if (topic == commandTopic) processCommand(payload); resetRx(); return;
  }
  if (rxCount > sizeof(rxBuffer) / 2) resetRx();
}

void scheduleFailure(const char *reason) { mqttOnline = false; gprsReady = false; ++failures; uint8_t shift = min<uint8_t>(failures - 1, 4); uint32_t delayMs = min<uint32_t>(5000UL << shift, MAX_BACKOFF_MS); retryAt = millis() + delayMs; at("AT+CIPCLOSE", "CLOSE OK", 5000); Serial.printf("[MQTT] %s; retry in %lus\n", reason, delayMs / 1000UL); }
void readTargetController() { while (TargetSerial.available()) { char c = TargetSerial.read(); if (c == '\r') continue; if (c == '\n') { if (targetBuffer.length()) { lastTargetLine = targetBuffer; Serial.print("TARGET << "); Serial.println(lastTargetLine); publishLog("INFO", String("TARGET << ") + lastTargetLine); targetBuffer = ""; } } else if (targetBuffer.length() < 120) targetBuffer += c; } }
void mqttTask() { if (!elapsed(retryAt)) return; if (!modemReady && !startModem()) { scheduleFailure("modem not ready"); return; } if (!mqttOnline && !connectMqtt()) { scheduleFailure("GPRS/MQTT connect failed"); return; } pumpMqtt(); if (millis() - lastHeartbeatAt >= HEARTBEAT_MS && !publishHeartbeat()) scheduleFailure("heartbeat PUBACK failed"); else { failures = 0; retryAt = millis(); } }
void showSelectedItem() { if (menuIndex == 0) drawDashboard(); else if (menuIndex == 1) showMessage("SIM800L", modemReady ? "AT: OK" : "AT: FAILED"); else if (menuIndex == 2) showMessage("GPRS", gprsReady ? gprsIp : "Not connected"); else showMessage("TARGET", lastTargetLine.length() ? lastTargetLine : "UART waiting"); }
} // namespace

void setup() {
  Serial.begin(115200); delay(500); Serial.println("=== SERVICE CONTROLLER V10 MQTT ===");
  TargetSerial.begin(115200, SERIAL_8N1, TARGET_RX, TARGET_TX); preferences.begin("service-v10", false); recentCommandIds = preferences.getString("command-ids", ""); bootId = esp_random();
  pinMode(MODEM_POWER, OUTPUT); pinMode(MODEM_RST, OUTPUT); pinMode(MODEM_PWRKEY, OUTPUT); digitalWrite(MODEM_POWER, HIGH); digitalWrite(MODEM_RST, HIGH); digitalWrite(MODEM_PWRKEY, HIGH);
  pinMode(ENC_A, INPUT_PULLUP); pinMode(ENC_B, INPUT_PULLUP); pinMode(ENC_PUSH, INPUT_PULLUP); pinMode(BUTTON_BACK, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(ENC_A), onEncoderA, CHANGE); attachInterrupt(digitalPinToInterrupt(ENC_B), onEncoderB, CHANGE); attachInterrupt(digitalPinToInterrupt(ENC_PUSH), onPush, FALLING); attachInterrupt(digitalPinToInterrupt(BUTTON_BACK), onBack, FALLING);
  Wire.begin(I2C_SDA, I2C_SCL); oledReady = display.begin(OLED_ADDR_PRIMARY, true); if (!oledReady) { oledAddress = OLED_ADDR_ALTERNATE; oledReady = display.begin(OLED_ADDR_ALTERNATE, true); } if (oledReady) { Serial.printf("OLED: OK at 0x%02X\n", oledAddress); drawDashboard(); } else Serial.println("OLED: NOT FOUND");
  retryAt = millis();
}
void loop() {
  readTargetController(); mqttTask();
  if (encoderChanged) { noInterrupts(); int32_t move = encoderDelta; encoderDelta = 0; encoderChanged = false; interrupts(); if (move > 0) menuIndex = (menuIndex + 1) % 4; if (move < 0) menuIndex = (menuIndex + 3) % 4; drawMenu(); }
  if (pushEvent) { noInterrupts(); pushEvent = false; interrupts(); showSelectedItem(); }
  if (backEvent) { noInterrupts(); backEvent = false; interrupts(); drawDashboard(); }
  if (modemReady && millis() - lastWakeCommand > 10000UL) { lastWakeCommand = millis(); at("AT+CSCLK=0", "OK", 700); }
  if (millis() - lastOledRefresh > OLED_REFRESH_MS) { lastOledRefresh = millis(); drawDashboard(); }
  if (millis() - lastNetworkCheck > NETWORK_CHECK_MS && !mqttOnline) { lastNetworkCheck = millis(); checkNetwork(); }
  delay(5);
}
