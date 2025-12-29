# BedJet Bluetooth Implementation Comparison

This document compares our Web Bluetooth-based BedJet control tool with three popular GitHub repositories that implement BedJet Bluetooth communication.

## Repositories Analyzed

1. **pjt0620/Home-Assistant-Bedjet** - Python MQTT bridge using pygatt
   - Language: Python
   - BLE Library: pygatt (GATTToolBackend)
   - Purpose: MQTT bridge for Home Assistant

2. **robert-friedland/ha-bedjet** - Home Assistant integration using Bleak
   - Language: Python
   - BLE Library: Bleak (asyncio-based)
   - Purpose: Native Home Assistant climate entity

3. **digitalrcs/BedJetWebSchedule** - ESP32 firmware with web UI
   - Language: Arduino C++ (ESP32)
   - BLE Library: NimBLE-Arduino
   - Purpose: Standalone scheduler with web interface

4. **Our Implementation** (bedjet-bluetooth-control.html)
   - Language: JavaScript
   - BLE API: Web Bluetooth API
   - Purpose: Browser-based control panel

---

## BLE Service & Characteristic UUIDs

All implementations use the same BedJet UUIDs:

| Service/Characteristic | UUID | Our Tool | Python (pygatt) | Python (Bleak) | ESP32 (NimBLE) |
|------------------------|------|----------|-----------------|----------------|----------------|
| **Service UUID** | `00001000-bed0-0080-aa55-4265644a6574` | ❌ Not used | ✅ Used | ❌ Not used | ✅ Used |
| **Status (Notify)** | `00002000-bed0-0080-aa55-4265644a6574` | ✅ Used | ✅ Used | ✅ Used | ✅ Used |
| **Name (Read)** | `00002001-bed0-0080-aa55-4265644a6574` | ✅ Used | ✅ Used | ✅ Used | ❌ Not used |
| **Command (Write)** | `00002004-bed0-0080-aa55-4265644a6574` | ✅ Used | ✅ Used | ✅ Used | ✅ Used |

### Key Finding:
- **Service UUID (`0x1000`)**: ESP32 and pygatt implementations use it for device discovery, while our tool and Bleak rely on name prefix filtering (`BedJet`, `BEDJET_V3`)
- Our tool provides a fallback option to show all devices if service UUID filtering fails

---

## Command Protocol

### Mode Commands (Byte 0 = 0x01)

All implementations agree on mode commands:

| Mode | Byte Sequence | Our Tool | Python | ESP32 |
|------|---------------|----------|--------|-------|
| OFF | `[0x01, 0x01]` | ✅ | ✅ | ✅ |
| COOL | `[0x01, 0x02]` | ✅ | ✅ | ✅ |
| HEAT | `[0x01, 0x03]` | ✅ | ✅ | ✅ |
| TURBO | `[0x01, 0x04]` | ✅ | ✅ | ✅ |
| DRY | `[0x01, 0x05]` | ✅ | ✅ | ✅ |
| EXT_HT | `[0x01, 0x06]` | ✅ | ✅ | ✅ |

### Memory Presets (Byte 0 = 0x01)

| Preset | Byte Sequence | Our Tool | Python | ESP32 |
|--------|---------------|----------|--------|-------|
| M1 | `[0x01, 0x20]` | ✅ | ✅ | ❌ Not shown |
| M2 | `[0x01, 0x21]` | ✅ | ✅ | ❌ Not shown |
| M3 | `[0x01, 0x22]` | ✅ | ✅ | ❌ Not shown |

### Additional Commands

| Command | Byte Sequence | Our Tool | Python | ESP32 |
|---------|---------------|----------|--------|-------|
| Set Runtime | `[0x02, hours, minutes]` | ❌ | ✅ | ✅ |
| Set Temperature | `[0x03, temp_byte]` | ✅ | ✅ | ✅ |
| Set Fan Speed | `[0x07, fan_byte]` | ✅ | ✅ | ✅ |
| Set Clock | `[0x08, hours, minutes]` | ❌ | ❌ | ✅ |
| Fan Up | `[0x01, 0x10]` | ❌ | ✅ | ❌ |
| Fan Down | `[0x01, 0x11]` | ❌ | ✅ | ❌ |
| Temp Up | `[0x01, 0x12]` | ❌ | ✅ | ❌ |
| Temp Down | `[0x01, 0x13]` | ❌ | ✅ | ❌ |

### Key Findings:
- **Missing in Our Tool**: Runtime setting, clock setting, and increment/decrement buttons
- **ESP32 Unique**: Clock setting command (`0x08`)
- **Python Unique**: Increment/decrement button emulation

---

## Temperature Conversion

### Our Implementation (JavaScript)
```javascript
// Encoding (F → byte):
const tempOffset = temp - 66;
const tempByte = Math.round(tempOffset + (tempOffset / 9) + 0x26);

// Decoding (byte → F):
const rawTemp = byte - 0x26;
const tempF = Math.round((rawTemp + 66) - (rawTemp / 9));
```

### Python Implementations (pygatt & Bleak)
```python
# Encoding (F → byte):
temp_byte = (int((temp - 60) / 9) + (temp - 66)) + 0x26

# Decoding (byte → F):
raw = int(value[7]) - 0x26
temp_f = round(((raw + 66) - (raw / 9)))
```

### ESP32 Implementation (NimBLE)
```cpp
// DIFFERENT APPROACH - Uses linear formula!
// Encoding (F → step):
float step = (f - 32.0f) / 0.9f;  // F = 0.9 * step + 32

// Decoding (byte → F):
int x = (int)byte - 0x26;
float f = (float)(x + 66) - ((float)x / 9.0f);
```

### Key Findings:
- **Encoding Discrepancy**: Our tool and Python use slightly different formulas
  - **Our Tool**: `(temp - 66) + (temp - 66) / 9 + 0x26`
  - **Python**: `(temp - 60) / 9 + (temp - 66) + 0x26`
  - **ESP32**: Uses completely different linear formula `(f - 32) / 0.9`
- **Decoding**: All use the same formula for reading temperature from status
- **This could cause slight temperature inaccuracies in our tool!**

---

## Fan Speed Conversion

### All Implementations (Consistent)

**Encoding (% → byte):**
```
fan_byte = round(fan_percent / 5) - 1
```
- Range: 5% to 100% (steps of 5%)
- Byte range: 0 to 19

**Decoding (byte → %):**
```
fan_percent = byte * 5
```

✅ **Our tool matches perfectly**

---

## Status Packet Parsing

All implementations parse a 15-20 byte status packet:

| Byte Index | Field | Our Tool | Python | ESP32 | Value |
|------------|-------|----------|--------|-------|-------|
| **[4]** | Hours remaining | ✅ | ✅ | ✅ | Direct value |
| **[5]** | Minutes remaining | ✅ | ✅ | ✅ | Direct value |
| **[6]** | Seconds remaining | ✅ | ✅ | ✅ | Direct value |
| **[7]** | Current temp (encoded) | ✅ | ✅ | ✅ | Needs decoding |
| **[8]** | Target temp (encoded) | ✅ | ✅ | ✅ | Needs decoding |
| **[9]** | Mode index | ❌ | ❌ | ✅ | 0-5 (ESP32 only) |
| **[10]** | Fan step (0-19) | ✅ | ✅ | ✅ | Multiply by 5 for % |
| **[13]** | Mode byte 1 | ✅ | ✅ | ❌ | Used with byte[14] |
| **[14]** | Mode byte 2 | ✅ | ✅ | ❌ | Used with byte[13] |

### Mode Detection Methods

**Our Tool & Python (bytes 13-14):**
```javascript
if (byte[14] === 0x50 && byte[13] === 0x14) mode = "off";
if (byte[14] === 0x34) mode = "cool";
if (byte[14] === 0x56) mode = "turbo";
if (byte[14] === 0x50 && byte[13] === 0x2d) mode = "heat";
if (byte[14] === 0x3e) mode = "dry";
if (byte[14] === 0x43) mode = "ext_ht";
```

**ESP32 (byte 9):**
```cpp
switch (modeIdx) {
  case 0: mode = "off";
  case 1: mode = "heat";
  case 2: mode = "cool";
  case 3: mode = "turbo";
  case 4: mode = "dry";
  case 5: mode = "ext_ht";
}
```

### Key Findings:
- **ESP32 uses a simpler mode index** (byte 9) while Python/JS use complex byte patterns
- Our tool matches Python implementations perfectly for status parsing
- **Potential improvement**: Could use byte[9] as primary method with bytes[13-14] as fallback

---

## Connection & Discovery

### Our Implementation (Web Bluetooth)
- **Filters**: Name prefix (`BedJet`, `BEDJET`) OR Service UUID
- **Fallback**: Option to show all devices
- **Connection**: Direct GATT connection
- **Auto-reconnect**: ❌ Not implemented

### Python - pygatt (MQTT Bridge)
- **Discovery**: Direct MAC address connection
- **Connection**: GATTTool backend with 4 retry attempts
- **Auto-reconnect**: ❌ Manual reconnect on failure

### Python - Bleak (Home Assistant)
- **Discovery**: Bluetooth integration service info OR MAC address
- **Filters**: Device name = "BEDJET_V3"
- **Connection**: Bleak async with exponential backoff (10 retries, 3s interval)
- **Auto-reconnect**: ✅ Implemented with disconnected callback

### ESP32 - NimBLE
- **Discovery**: Service UUID match OR MAC address match
- **Connection**: NimBLE with 6 retry attempts
- **Auto-reconnect**: Periodic reconnection logic
- **Timeout**: 15 seconds

### Key Findings:
- **Our tool lacks auto-reconnect** - a significant limitation
- **Bleak has the best retry logic** with exponential backoff
- **ESP32 uses service UUID discovery** as primary method

---

## Features Comparison Matrix

| Feature | Our Tool | pygatt | Bleak | ESP32 |
|---------|----------|--------|-------|-------|
| **Basic Modes** (Heat/Cool/Off/Turbo/Dry) | ✅ | ✅ | ✅ | ✅ |
| **Extended Heat Mode** | ✅ | ✅ | ✅ | ✅ |
| **Memory Presets** (M1/M2/M3) | ✅ | ✅ | ❌ | ❌ |
| **Temperature Control** | ✅ | ✅ | ✅ | ✅ |
| **Fan Speed Control** | ✅ | ✅ | ✅ | ✅ |
| **Runtime/Timer Control** | ❌ | ✅ | ✅ | ✅ |
| **Clock Setting** | ❌ | ❌ | ❌ | ✅ |
| **Temp/Fan Increment Buttons** | ❌ | ✅ | ❌ | ❌ |
| **Status Display** | ✅ | ✅ (MQTT) | ✅ (HA) | ✅ (JSON) |
| **Live Updates** | ✅ | ✅ | ✅ | ✅ |
| **Auto-Reconnect** | ❌ | ❌ | ✅ | ✅ |
| **Debug Logging** | ✅ Excellent | ❌ | ✅ Good | ✅ Excellent |
| **Multiple Devices** | ❌ | ❌ | ✅ | ❌ |
| **Scheduling** | ❌ | ❌ | ❌ | ✅ |
| **Web Interface** | ✅ | ❌ | ❌ | ✅ |

---

## Temperature Formula Issue - CRITICAL FINDING

### The Problem
There are **three different temperature encoding formulas** in the wild:

1. **Our Tool:**
   ```javascript
   tempByte = Math.round((temp - 66) + ((temp - 66) / 9) + 0x26)
   ```

2. **Python (pygatt/Bleak):**
   ```python
   temp_byte = (int((temp - 60) / 9) + (temp - 66)) + 0x26
   ```

3. **ESP32:**
   ```cpp
   step = (f - 32.0f) / 0.9f
   ```

### Testing Results
For **temp = 72°F**:
- **Our tool**: `72-66=6`, `6+6/9+0x26` = `6+0.67+38` = **44.67 → 45 (0x2D)**
- **Python**: `(72-60)/9 + 72-66 + 0x26` = `1.33+6+38` = **45.33 → 45 (0x2D)**
- **ESP32**: `(72-32)/0.9` = `40/0.9` = **44.44 → 44 (0x2C)**

### Testing for **temp = 90°F**:
- **Our tool**: `90-66=24`, `24+24/9+0x26` = `24+2.67+38` = **64.67 → 65 (0x41)**
- **Python**: `(90-60)/9 + 90-66 + 0x26` = `3.33+24+38` = **65.33 → 65 (0x41)**
- **ESP32**: `(90-32)/0.9` = `58/0.9` = **64.44 → 64 (0x40)**

### Conclusion
- **Our tool and Python produce similar results** (within 1 byte difference due to rounding)
- **ESP32 uses a completely different formula** that produces consistently different byte values
- **Recommendation**: Test with actual BedJet hardware to determine which is correct

---

## Potential Improvements for Our Tool

### High Priority
1. **✅ COMPLETED**: Add comprehensive debug logging
2. **✅ COMPLETED**: Add fallback device discovery option
3. **❌ TODO**: Implement auto-reconnect with exponential backoff
4. **❌ TODO**: Add runtime/timer setting functionality
5. **❌ TODO**: Fix temperature encoding formula (use Python approach)

### Medium Priority
6. **❌ TODO**: Add temp/fan increment/decrement buttons
7. **❌ TODO**: Add connection timeout handling
8. **❌ TODO**: Store last connected device MAC for quick reconnect
9. **❌ TODO**: Add mode detection using byte[9] as fallback

### Low Priority
10. **❌ TODO**: Multiple device support
11. **❌ TODO**: Scheduling features
12. **❌ TODO**: Clock setting functionality

---

## Code Quality Observations

### Our Tool
- ✅ Excellent UI/UX design
- ✅ Comprehensive debug logging
- ✅ Good error handling
- ✅ Clean, readable code
- ❌ Lacks auto-reconnect
- ❌ No timeout handling

### Python - Bleak (Best Practices)
- ✅ Excellent retry logic with exponential backoff
- ✅ Auto-reconnect implementation
- ✅ Async/await patterns
- ✅ Good separation of concerns
- ✅ Multiple device support
- ❌ Complex codebase

### ESP32 (Most Complete)
- ✅ Most features (scheduling, clock setting)
- ✅ Robust connection handling
- ✅ Comprehensive logging
- ✅ Both service UUID and MAC discovery
- ✅ Web UI + API
- ❌ Arduino code harder to maintain

---

## Summary & Recommendations

### What Our Tool Does Well
1. ✅ **Best-in-class UI/UX** - Most user-friendly interface
2. ✅ **Excellent debug logging** - Matches or exceeds other implementations
3. ✅ **Browser-based** - No installation required
4. ✅ **Fallback discovery** - Flexible device scanning
5. ✅ **Memory presets** - Unique among the implementations reviewed

### Critical Issues to Fix
1. ❌ **Temperature encoding formula** - May not match BedJet expectations
2. ❌ **No auto-reconnect** - Poor user experience on disconnect
3. ❌ **Missing runtime control** - Can't set timer duration

### Next Steps
1. **Test temperature encoding** with real BedJet hardware
2. **Implement auto-reconnect** using Bleak's pattern as reference
3. **Add runtime control** (set hours/minutes for operation)
4. **Consider adding service UUID to discovery filters** for better reliability

---

## References

- **pjt0620/Home-Assistant-Bedjet**: https://github.com/pjt0620/Home-Assistant-Bedjet
- **robert-friedland/ha-bedjet**: https://github.com/robert-friedland/ha-bedjet
- **digitalrcs/BedJetWebSchedule**: https://github.com/digitalrcs/BedJetWebSchedule
- **Web Bluetooth API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API

---

*Analysis Date: 2025-12-29*
*Tool Version: bedjet-bluetooth-control.html (latest)*
