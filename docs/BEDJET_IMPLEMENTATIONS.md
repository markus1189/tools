# BedJet Bluetooth Control Implementations

This document cross-references various BedJet control implementations found in the open-source community to validate the fan speed fix applied to this tool.

## Fan Speed Issue Summary

### The Problem
BedJet devices use the formula: **`fan_speed_percent = fan_byte * 5 + 5`**

Where:
- `fan_byte` ranges from 0-19 (device protocol value)
- `fan_speed_percent` ranges from 5%-100% (user-facing percentage)

This means:
- `fan_byte = 0` → 5%
- `fan_byte = 19` → 100%

### Common Implementation Errors

Many implementations have struggled with the 5% offset, leading to two common bugs:

1. **Reading Status**: Using `fan_speed = fan_byte * 5` instead of `fan_speed = fan_byte * 5 + 5`
   - Results in displaying 0%-95% instead of 5%-100%

2. **Sending Commands**: Using `fan_byte = fan_speed / 5` instead of `fan_byte = (fan_speed - 5) / 5`
   - Results in the device receiving values 1-20 instead of 0-19
   - Causes the device to show 5% higher than requested

## Cross-Reference with Other Implementations

### 1. ESPHome (Official - C++)
**Repository**: [esphome/esphome](https://github.com/esphome/esphome)

**Location**: `esphome/components/bedjet/bedjet_codec.h`

**Implementation** (Line 62-63):
```cpp
uint8_t fan_step : 8;  ///< BedJet fan speed; value is in the 0-19 range,
                       ///< representing 5% increments (5%-100%): `5 + 5 * fan_step`
```

**Status**: ✅ **Correct** - Explicitly documents the formula as `5 + 5 * fan_step`

**Historical Bug**: ESPHome had an off-by-one error where it was passing values 1-20 instead of 0-19. This was fixed in [PR #4292](https://github.com/esphome/esphome/pull/4292) which addressed [Issue #3873](https://github.com/esphome/issues/issues/3873).

---

### 2. BedJetWebSchedule (ESP32/Arduino - C++)
**Repository**: [digitalrcs/BedJetWebSchedule](https://github.com/digitalrcs/BedJetWebSchedule)

**Implementation** (Line 903):
```cpp
int fanPct = 5 + 5 * (int)fanStep; // 0->5%, 19->100%
```

**Status**: ✅ **Correct** - Explicitly shows the conversion with inline comment

**Notes**: This ESP32-based scheduler provides Web UI and Bluetooth control with proper fan speed handling.

---

### 3. Home-Assistant-Bedjet (Python)
**Repository**: [pjt0620/Home-Assistant-Bedjet](https://github.com/pjt0620/Home-Assistant-Bedjet)

**Reading Status** (Line 75):
```python
self.fan = int(value[10]) * 5
```
**Status**: ❌ **INCORRECT** - Missing the `+ 5` offset, displays 0%-95% instead of 5%-100%

**Sending Command** (Line 106):
```python
self.device.char_write('00002004-bed0-0080-aa55-4265644a6574', [0x07, round(fanPercent/5)-1])
```
**Status**: ✅ **Correct** - Using `fanPercent/5 - 1` is mathematically equivalent to `(fanPercent - 5) / 5`

**Notes**: This Python implementation has the reading bug but the writing formula is correct.

---

### 4. Our Implementation (JavaScript/HTML)
**Repository**: This repository

**Before Fix**:
- **Reading**: `fanSpeed = data[10] * 5` ❌
- **Sending**: `fanByte = Math.round(speed / 5)` ❌

**After Fix** (Current):
- **Reading**: `fanSpeed = data[10] * 5 + 5` ✅
- **Sending**: `fanByte = Math.round((speed - 5) / 5)` ✅

**Status**: ✅ **Fixed** - Both formulas now correctly handle the 5% offset

---

## Additional Resources

### Home Assistant Integrations
- [robert-friedland/ha-bedjet](https://github.com/robert-friedland/ha-bedjet) - BedJet Home Assistant Integration using climate entity
- [asheliahut/ha-bedjet](https://github.com/asheliahut/ha-bedjet) - Alternative HA integration
- [samwaxxawmas/ha-bedjet](https://github.com/samwaxxawmas/ha-bedjet) - Fork with additional features

### NodeJS Implementations
- [vimalb/BedJetController](https://github.com/vimalb/BedJetController) - Raspberry Pi/NodeJS-based BedJet v3 controller (not officially endorsed)

### Community Documentation
- [ESPHome BedJet Component Docs](https://esphome.io/components/climate/bedjet/)
- [Bedjetting with ESPHome Blog Post](https://hsmalley.github.io/blog/Bedjet%20with%20ESP%20Home/)

---

## Validation Summary

The fix applied to this tool has been validated against multiple implementations:

1. ✅ **ESPHome** (official C++ implementation) - Uses identical formula
2. ✅ **BedJetWebSchedule** (ESP32 C++) - Uses identical formula
3. ⚠️ **Home-Assistant-Bedjet** (Python) - Has reading bug, but sending is correct
4. ✅ **Our Tool** - Now matches the correct implementations

## Protocol Documentation

### BedJet Bluetooth Characteristics

- **Service UUID**: `00001000-bed0-0080-aa55-4265644a6574`
- **Status Characteristic**: `00002000-bed0-0080-aa55-4265644a6574` (notifications)
- **Command Characteristic**: `00002004-bed0-0080-aa55-4265644a6574` (write)
- **Name Characteristic**: `00002001-bed0-0080-aa55-4265644a6574` (read)

### Fan Speed Command Format

```
[0x07, fan_byte]
```

Where `fan_byte` = `(fan_speed_percent - 5) / 5` and must be in range 0-19.

### Fan Speed in Status Packet

Status packet byte 10 contains `fan_byte` (0-19).

To convert to percentage: `fan_speed_percent = fan_byte * 5 + 5`

---

## Commit Reference

The fan speed fix was implemented in commit `062c584` on branch `claude/fix-bedjet-fan-speed-13C9z`.

**Changes**:
- Fixed reading formula at lines 1444-1451
- Fixed sending formula at lines 1564-1578
- Added inline documentation explaining the formula

---

*Last updated: 2025-12-29*
