#include "sensors.h"
#include "pins.h"
#include <DHT.h>
#include <SPI.h>
#include <MFRC522.h>

static DHT dht(DHT_PIN, DHT_TYPE);
static MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
static float lastT = NAN, lastH = NAN;
static String lastUid = "";
static uint32_t lastUidTime = 0;

void sensorsBegin() {
  pinMode(FLAME_PIN, INPUT);
  dht.begin();
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  rfid.PCD_Init();
  Serial.println("[sensors] DHT11 + flame + RC522 initialized");
}

SensorData sensorsRead() {
  SensorData d;
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) lastT = t;
  if (!isnan(h)) lastH = h;
  d.temperature = lastT;
  d.humidity = lastH;
  d.valid = !isnan(lastT) && !isnan(lastH);
  int raw = digitalRead(FLAME_PIN);
  d.flame = FLAME_ACTIVE_LOW ? (raw == LOW) : (raw == HIGH);
  return d;
}

bool rfidPoll(String& uid) {
  if (!rfid.PICC_IsNewCardPresent()) return false;
  if (!rfid.PICC_ReadCardSerial()) return false;
  String s;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) s += "0";
    s += String(rfid.uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  uint32_t now = millis();
  if (s == lastUid && (now - lastUidTime) < 3000) return false;  // debounce
  lastUid = s;
  lastUidTime = now;
  uid = s;
  return true;
}