# BedJet Biorhythm/Sequence Research

Research into BedJet's biorhythm (sequence) programs and whether custom builders or decoders exist in the open-source community.

## Summary

**Status**: ⚠️ **Partially Documented** - Biorhythm sequences can be **started** but not yet **created** or **decoded** programmatically

### Key Findings

1. **No custom biorhythm builder found** - All implementations can only trigger pre-programmed M1/M2/M3 presets
2. **Biorhythm data exists in protocol** but full encoding/decoding is **not yet implemented**
3. **Only the official BedJet app** can create/edit biorhythm sequences
4. **Scheduling workarounds** exist using ESP32 or Home Assistant to trigger modes at specific times

---

## What Are BedJet Biorhythms?

BedJet biorhythm sequences are multi-step temperature/fan programs that run throughout the night. Example:
- **Step 1**: Turbo heat for 10 minutes
- **Step 2**: Wait (idle) for 20 minutes
- **Step 3**: Heat at 90°F for 7 hours

These can be programmed via the official BedJet mobile app and stored in the device's memory as presets M1, M2, or M3.

**Official Documentation**:
- [BedJet Biorhythm Information](https://bedjet.com/pages/biorhythm)
- [Circadian Sleep Cycles & Biorhythm Technology](https://bedjet.com/pages/circadian-sleep-rhythm-101)

---

## Protocol Analysis

### Known Bluetooth Characteristics

| UUID | Purpose | Access |
|------|---------|--------|
| `00001000-bed0-0080-aa55-4265644a6574` | Service | - |
| `00002000-bed0-0080-aa55-4265644a6574` | Status notifications | Read/Notify |
| `00002001-bed0-0080-aa55-4265644a6574` | Device name | Read |
| `00002004-bed0-0080-aa55-4265644a6574` | Commands | Write |
| `00002005-bed0-0080-aa55-4265644a6574` | Version | Read |
| `00002006-bed0-0080-aa55-4265644a6574` | Version (alt) | Read |

### Status Packet Structure

From [ESPHome bedjet_codec.h](https://github.com/esphome/esphome/blob/dev/esphome/components/bedjet/bedjet_codec.h):

```cpp
struct BedjetStatusPacket {
  // ... other fields ...

  uint8_t bio_sequence_step : 8;  // Byte 28: Biorhythm sequence step number
  BedjetNotification notify_code : 8;  // Byte 29: Notification codes

  // ... more fields ...
} __attribute__((packed));
```

**Byte 28** contains the current biorhythm sequence step number, confirming that biorhythm data is transmitted but not fully decoded.

### Biorhythm-Related Notifications

The protocol includes error notifications for biorhythm failures:

```cpp
enum BedjetNotification : uint8_t {
  NOTIFY_NONE = 0,
  NOTIFY_FILTER = 1,
  NOTIFY_UPDATE = 2,
  NOTIFY_UPDATE_FAIL = 3,
  NOTIFY_BIO_FAIL_CLOCK_NOT_SET = 4,  // Clock must be set to run sequences
  NOTIFY_BIO_FAIL_TOO_LONG = 5,        // Sequence steps too long from current time
  // ...
};
```

### Biorhythm Control Commands

All implementations can **start** pre-programmed biorhythm presets:

```cpp
enum BedjetButton : uint8_t {
  BTN_M1 = 0x20,  // Start M1 biorhythm preset
  BTN_M2 = 0x21,  // Start M2 biorhythm preset
  BTN_M3 = 0x22,  // Start M3 biorhythm preset
  // ...
};
```

**Command format**: `[0x01, 0x20]` to start M1, `[0x01, 0x21]` for M2, `[0x01, 0x22]` for M3

### Missing: Sequence Creation/Editing

**No characteristic or command has been discovered** for:
- Reading biorhythm sequence definitions from the device
- Writing/programming new biorhythm sequences
- Editing existing M1/M2/M3 programs

This suggests:
1. Sequences may be uploaded via a different mechanism (app-specific protocol)
2. Encoding format is proprietary and undocumented
3. May require Bluetooth pairing/bonding and encrypted channels

---

## Existing Implementations

### 1. ESPHome (C++) - Official Component

**Repository**: [esphome/esphome](https://github.com/esphome/esphome/tree/dev/esphome/components/bedjet)

**Status**: ✅ Can trigger M1/M2/M3 | ❌ Cannot create/decode sequences

**Capabilities**:
- Start biorhythm presets M1, M2, M3 via button commands
- Read current sequence step from status packet (byte 28)
- Detect MODE_WAIT (idle step during biorhythm)
- Handle biorhythm failure notifications

**Limitations**:
- TODO comment in code: `"TODO: Get biorhythm data to determine which preset (M1-3) is running, if any."`
- Cannot determine which preset is active
- Cannot read or write biorhythm sequences

**Code Reference**:
```cpp
// bedjet_const.h
MODE_WAIT = 6,  // BedJet is in "wait" mode, a step during a biorhythm program

// climate/bedjet_climate.cpp:246
// TODO: Get biorhythm data to determine which preset (M1-3) is running, if any.
```

---

### 2. BedJetWebSchedule (ESP32/Arduino)

**Repository**: [digitalrcs/BedJetWebSchedule](https://github.com/digitalrcs/BedJetWebSchedule)

**Status**: ⚠️ **Workaround** - Implements own scheduler, doesn't use BedJet biorhythms

**Approach**:
- ESP32-based web interface with on-device time-of-day scheduler
- Triggers BedJet modes at specific times via BLE commands
- Stores schedule in ESP32 NVS (not in BedJet device)

**Why this exists**:
>  "The BedJet application lets you transmit a schedule in one shot... you could turbo heat for 10 mins, wait for 20 mins, then heat for 7 hours."

However, the BedJet app only supports duration-based timing, not absolute wake times. BedJetWebSchedule solves this by implementing a scheduler externally.

**Notable**:
- Uses Bluetooth packet capture (HCI snoop) for reverse engineering
- Confirms no public API for biorhythm sequence programming exists

---

### 3. Home-Assistant-Bedjet (Python)

**Repository**: [pjt0620/Home-Assistant-Bedjet](https://github.com/pjt0620/Home-Assistant-Bedjet)

**Status**: ✅ Can trigger M1/M2/M3 | ❌ No schedule support

**GitHub Issue**: [Support for schedules #1](https://github.com/pjt0620/Home-Assistant-Bedjet/issues/1)

Quote from maintainer:
> "I personally have a Bluetooth sniffer so I did direct packet capture... The BedJet application lets you transmit a schedule in one shot."

**Suggests**: The official app may use additional characteristics or a proprietary upload mechanism not visible in standard Bluetooth reverse engineering.

---

### 4. Our Implementation (JavaScript/HTML)

**Repository**: This repository - `bedjet-bluetooth-control.html`

**Status**: ✅ Can trigger M1/M2/M3 | ❌ No biorhythm builder

**Capabilities**:
- Trigger presets via buttons (0x20, 0x21, 0x22)
- Read biorhythm step from status packet (byte 28) - not yet implemented
- Could display "Biorhythm Step X" in UI

**Potential Enhancement**:
```javascript
// Parse biorhythm step (byte 28)
const bioStepEl = document.getElementById('bioStep');
if (data[28] > 0) {
    bioStepEl.textContent = `Step ${data[28]}`;
} else {
    bioStepEl.textContent = '--';
}
```

---

## Research Methods Used by Community

### 1. Bluetooth Packet Capture (Most Common)

**Android**: Enable HCI snoop log in Developer Options
- Settings → Developer Options → Enable Bluetooth HCI snoop log
- Use BedJet app, then extract `/data/log/bt/btsnoop_hci.log`
- Analyze with Wireshark

**Hardware**: Dedicated Bluetooth sniffer (e.g., Ubertooth One, nRF52840)

### 2. BLE Scanner Apps

Apps like nRF Connect (Nordic Semiconductor) can:
- Discover all characteristics
- Read/write values manually
- Monitor notifications

### 3. Source Code Analysis

Review official ESPHome implementation for documented packet structures.

---

## What We Know About Biorhythm Sequences

### From Status Packets

✅ **Confirmed in Protocol**:
- Byte 28: Current sequence step number
- MODE_WAIT (0x06): Idle state during biorhythm
- Notifications for biorhythm failures
- Clock must be set for biorhythms to run

❌ **Unknown**:
- Total number of steps in sequence
- Temperature/fan/mode for each step
- Duration of each step
- Whether step uses duration or absolute time
- Sequence encoding format
- Which preset (M1/M2/M3) is currently running

### From Official BedJet App

Users can program sequences with:
- **Modes**: Turbo, Heat, Cool, Dry, Extended Heat, Wait (idle)
- **Per-step settings**: Temperature, fan speed, duration or end time
- **Personalization**: Age, sex, body type inputs (affect recommended temps)
- **Storage**: Up to 3 presets (M1, M2, M3)

**App Download**:
- [Android](https://play.google.com/store/apps/details?id=com.bedjet)
- iOS: Available on App Store

---

## Potential Future Work

### Option 1: Deeper Protocol Reverse Engineering

**Required**:
1. Bluetooth packet capture while using official app to:
   - Create a new biorhythm sequence
   - Edit an existing sequence
   - Delete a sequence
2. Analyze packets to identify:
   - Additional characteristics used
   - Sequence data format/encoding
   - Upload/download commands

**Tools**:
- Android HCI snoop log
- Wireshark with Bluetooth LE plugin
- nRF Connect app for manual characteristic exploration

### Option 2: Alternative Scheduling Solutions

**Already Implemented** (BedJetWebSchedule approach):
- External ESP32/Raspberry Pi scheduler
- Triggers standard BedJet commands at specified times
- More flexible than built-in biorhythms (can use absolute times, variable wake times, etc.)

**Home Assistant Automation**:
- Use `ha-bedjet` integration
- Create time-based automations to call BedJet services
- More complex logic possible (sunrise/sunset, presence detection, etc.)

### Option 3: Hybrid Approach

1. Use official BedJet app to program M1/M2/M3 presets
2. Use custom tools to trigger those presets at appropriate times
3. Read status packet byte 28 to display current biorhythm step

---

## Conclusion

### Current Capabilities

✅ **What Works**:
- Triggering pre-programmed biorhythm presets (M1, M2, M3)
- Reading current biorhythm step number from status
- Detecting biorhythm-related modes and errors

❌ **What Doesn't Work**:
- Creating custom biorhythm sequences programmatically
- Reading biorhythm sequence definitions from device
- Editing stored M1/M2/M3 programs
- Determining which preset is currently running

### Recommended Approach

**For most users**: Use the official BedJet app to create biorhythm sequences, then trigger them via:
- ESPHome automation
- Home Assistant automation
- BedJetWebSchedule
- Our bedjet-bluetooth-control.html tool

**For advanced scheduling**: Use BedJetWebSchedule or Home Assistant automations for more flexible time-of-day control than built-in biorhythms provide.

**For researchers**: Bluetooth packet capture of the official app is the most promising path to decode the biorhythm sequence format.

---

## References

### Official BedJet Resources
- [BedJet Biorhythm](https://bedjet.com/pages/biorhythm)
- [Circadian Sleep Cycles & Biorhythm Technology](https://bedjet.com/pages/circadian-sleep-rhythm-101)
- [BedJet 3 Product Page](https://bedjet.com/products/bedjet-3-climate-comfort-system-with-biorhythm-sleep-technology)

### Open Source Implementations
- [ESPHome BedJet Component](https://github.com/esphome/esphome/tree/dev/esphome/components/bedjet)
- [ESPHome BedJet Documentation](https://esphome.io/components/climate/bedjet/)
- [BedJetWebSchedule (ESP32 Scheduler)](https://github.com/digitalrcs/BedJetWebSchedule)
- [Home-Assistant-Bedjet (Python)](https://github.com/pjt0620/Home-Assistant-Bedjet)
- [robert-friedland/ha-bedjet](https://github.com/robert-friedland/ha-bedjet)

### GitHub Issues
- [Support for schedules #1](https://github.com/pjt0620/Home-Assistant-Bedjet/issues/1)
- [Bedjet V2 support](https://github.com/esphome/feature-requests/issues/1789)

### Community Blogs
- [Bedjetting with ESPHome](https://hsmalley.github.io/blog/Bedjet%20with%20ESP%20Home/)

---

*Last updated: 2025-12-29*
*Research Status: Active - biorhythm encoding remains undocumented*
