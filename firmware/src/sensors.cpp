#include "sensors.h"
#include "pins.h"
#include <DHT.h>
#include <SPI.h>
#include <MFRC522.h>

static DHT dht(DHT_PIN, DHT_TYPE);
static MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

static String sLastUid;
static uint32_t sLastEventAt = 0;
static uint32_t sLastVersionAt = 0;
static uint32_t sLastReinitAt = 0;
static bool sRfidFault = false;

void sensorsBegin() {
  pinMode(FLAME_PIN, INPUT);
  dht.begin();
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(50);
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  sRfidFault = (v == 0x00 || v == 0xFF);
  Serial.printf("[STATUS] sensors ready (DHT11 GPIO%d, flame GPIO%d, RC522 GPIO%d, version=0x%02X)\n",
                DHT_PIN, FLAME_PIN, RFID_SS_PIN, v);
  if (sRfidFault) Serial.println("[ERROR] RC522 not responding at boot (check 3.3V + SPI pins)");
}

bool sensorsReadDht(float& tempC, float& rh) {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) return false;
  tempC = t;
  rh = h;
  return true;
}

bool sensorsReadFlame() {
  int raw = digitalRead(FLAME_PIN);
  return FLAME_ACTIVE_LOW ? (raw == LOW) : (raw == HIGH);
}

bool rfidHealthy() { return !sRfidFault; }

static void rfidHealthCheck(uint32_t now) {
  if (now - sLastVersionAt < 500) return;
  sLastVersionAt = now;
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  bool bad = (v == 0x00 || v == 0xFF);
  if (bad != sRfidFault) {
    sRfidFault = bad;
    if (bad) Serial.println("[ERROR] RC522 SPI read failed");
    else Serial.println("[STATUS] RC522 recovered");
  }
  if (bad && now - sLastReinitAt > 3000) {
    sLastReinitAt = now;
    rfid.PCD_Init();
  }
}

bool rfidPoll(String& uid) {
  uint32_t now = millis();

  if (!rfid.PICC_IsNewCardPresent()) {
    rfidHealthCheck(now);
    return false;
  }
  if (!rfid.PICC_ReadCardSerial()) return false;

  String s;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) s += "0";
    s += String(rfid.uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  sRfidFault = false;
  // PICC_HaltA puts the card in HALT state, so the RC522 will not report it as
  // "new" again until it is physically removed and re-entered. The short
  // cooldown suppresses re-reads of the same UID within one tap.
  if (s == sLastUid && now - sLastEventAt < 1500) return false;

  sLastUid = s;
  sLastEventAt = now;
  uid = s;
  return true;
}
