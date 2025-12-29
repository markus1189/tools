# BedJet Documentation

This directory contains technical documentation related to the BedJet Bluetooth Control tool.

## Contents

### Implementation Analysis
- **[BEDJET_IMPLEMENTATIONS.md](BEDJET_IMPLEMENTATIONS.md)** - Cross-reference of BedJet control implementations across various open-source projects, validating the fan speed fix
- **[BEDJET_BIORHYTHM_RESEARCH.md](BEDJET_BIORHYTHM_RESEARCH.md)** - Research into BedJet biorhythm sequences: what's possible, what's not, and potential workarounds

### Comparison and Improvements
- **[BEDJET_BLUETOOTH_COMPARISON.md](BEDJET_BLUETOOTH_COMPARISON.md)** - Comparison of BedJet Bluetooth implementations
- **[BEDJET_IMPROVEMENTS_SUMMARY.md](BEDJET_IMPROVEMENTS_SUMMARY.md)** - Summary of improvements made to the BedJet tool

## Key Findings

The BedJet device uses a specific formula for fan speed control:

```
fan_speed_percent = fan_byte * 5 + 5
```

Where:
- `fan_byte` ranges from 0-19 (protocol value)
- `fan_speed_percent` ranges from 5%-100% (user-facing value)

This formula has been validated against multiple open-source implementations including ESPHome (official C++ implementation) and BedJetWebSchedule (ESP32/Arduino).

## Related Files

- [bedjet-bluetooth-control.html](../bedjet-bluetooth-control.html) - Main BedJet control tool
- [tools.json](../tools.json) - Tool registry

## External Resources

- [ESPHome BedJet Component](https://github.com/esphome/esphome/tree/dev/esphome/components/bedjet)
- [BedJet Web Scheduler](https://github.com/digitalrcs/BedJetWebSchedule)
- [Home Assistant Integrations](https://github.com/robert-friedland/ha-bedjet)
