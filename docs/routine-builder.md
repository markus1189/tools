# Routine Builder - Developer Reference

**Context**: Single-file React app for workout routines with sets/pyramids, auto-progression, audio feedback.

## State Architecture

**Core state** (workout execution):
```javascript
idx          // Current exercise index in routine array
currentSet   // Current set index (for type: "sets")
currentRep   // Current rep within set (0-based)
isActive     // Timer running?
isResting    // In set rest? (between sets)
isRepResting // In rep rest? (between individual reps)
timer        // Countdown in seconds
```

**State hierarchy**: Exercise → Set → Rep → (Timer/Rest cycles)

## Exercise Types & Flow

### Type: "reps"
Simple counted reps. User presses Check when done.
```json
{"type": "reps", "target": "10-15 reps"}
```

### Type: "timer"
Single countdown timer.
```json
{"type": "timer", "duration": 60}
```

### Type: "sets"
Multi-set progression with auto-flow.
```json
{
  "type": "sets",
  "sets": [
    {"reps": 6, "duration": 10, "repRest": 3, "rest": 10}
  ]
}
```

**Fields**:
- `reps`: How many times to repeat (default: 1)
- `duration`: Timed hold in seconds (optional)
- `repRest`: Micro-rest BETWEEN reps in seconds (optional)
- `rest`: Recovery AFTER all reps complete (optional)

**Auto-progression flow** (single Play press):
```
Rep 1 (duration) → repRest → Rep 2 (duration) → ... → Rep N (duration)
  ↓
Set rest
  ↓
Next set starts (needs Play press)
```

## Critical Functions

### `setupEx(i)`
Initialize exercise at index `i`. Resets: currentSet, currentRep, isResting, isRepResting.

### `nextSet()`
**Most complex function**. Handles state machine:

1. **If isRepResting**: Complete micro-rest → start next rep (auto-start if timed)
2. **If mid-set** (currentRep < totalReps-1):
   - If repRest exists → enter isRepResting
   - Else → increment rep, continue
3. **If set complete**:
   - If rest exists → enter isResting
   - Else → advance to next set or exercise

Called automatically when timer hits 0.

### Timer useEffect
**Two responsibilities**:
1. Countdown (every 1s, plays beeps at 3/2/1s)
2. On completion (timer=0, isActive=true):
   - Play appropriate beep
   - Call nextSet() after 500ms delay

## Audio System

Three distinct sounds:

**Countdown beep** (600Hz, 80ms):
- Plays at 3s, 2s, 1s remaining
- Any active timer

**Completion beep** (800→1000Hz, two-tone):
- Auto-continuing transitions
- Rep complete, rest complete (when auto-advancing)

**Set complete beep** (700→900→1100Hz, three-tone):
- User action required
- After set rest (before next set)
- After final rep of final set (exercise complete)

**Detection logic** for set complete beep:
```javascript
needsUserAction = (isResting && !isLastSet) || 
                  (isLastRepOfSet && isLastSet && !isRepResting && !isResting)
```

## URL State

**Storage**: Hash fragment with LZ-String compression
```
#N4IgdghgtgpiBcIAyBWA9AZQ...
```

**Format**: `{name: "...", routine: [...], version: 1}`

**Load priority**: URL hash → localStorage → DEFAULT_ROUTINE

**On every save**: Updates both localStorage AND URL hash via `history.replaceState()`.

## AI Prompt ↔ Data Format

**CRITICAL**: The AI prompt in `copyAIPrompt()` is the schema documentation for users.

**When changing data format, MUST update AI prompt**:
- Add new exercise type → document in prompt
- Add field to sets → document field with examples
- Change validation rules → update "Important Rules" section
- Change format → add migration example

**AI prompt serves dual purpose**:
1. **User documentation** - Only place users see format specification
2. **LLM contract** - AI generates JSON matching this schema

**Location**: Search for `const copyAIPrompt` in routine-builder.html

**Test after changes**: 
1. Copy AI prompt
2. Paste to ChatGPT/Claude
3. Ask for routine with new feature
4. Verify generated JSON works with Paste button

**Format drift = broken UX**: If prompt doesn't match code, users can't generate valid routines.

## Common Modifications

### Add new exercise type:
1. Update `setupEx()` to handle new type
2. Update workout view render logic (ex.type === "newtype")
3. Update controls section with appropriate button
4. **Update AI prompt** - add type to examples, field descriptions, and rules

### Change audio feedback:
Modify `playBeep()` calls in timer useEffect. Adjust frequencies/durations in play*Beep() functions.

### Modify progression logic:
All in `nextSet()`. Test thoroughly - state machine is complex. Use skip buttons for rapid testing.

### Add state to URL:
Extend data object in `saveRoutine()`. Update load logic in first useEffect. Maintain backward compatibility (version field).

## Testing

**Use skip buttons**: "Prev Set" / "Next Set" to rapidly test state transitions without waiting for timers.

**Audio testing**: Adjust durations to 3-5s for faster iteration. Check all three beep types.

**State debugging**: Log `{idx, currentSet, currentRep, isResting, isRepResting}` in nextSet().

## Gotchas

1. **useEffect dependencies**: Timer useEffect needs all state used in nextSet(). Missing deps = stale closures.

2. **Auto-start after repRest**: Must set `isActive=true` when transitioning from repRest to next rep (if duration exists).

3. **Set complete detection**: Complex logic - needs to detect BEFORE state changes. Check both set rest AND final rep scenarios.

4. **React state batching**: Multiple setState calls in nextSet() - ensure order doesn't matter (React may batch).

5. **History API**: Use `window.history` not state variable `history` (naming collision).

## File Structure

Single file: `routine-builder.html`
- Icons (SVG components)
- Audio functions
- DEFAULT_ROUTINE
- App component (all state/logic)
  - Home view (routine editor)
  - Workout view (execution)
  - Summary view (completion)

No build step. Edit file → refresh browser.
