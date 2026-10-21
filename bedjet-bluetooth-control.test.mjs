// Run: nix shell nixpkgs#nodejs --command node --test bedjet-bluetooth-control.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./bedjet-bluetooth-control.html', import.meta.url), 'utf8');

function script(id) {
    const match = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
    assert.ok(match, `script #${id} not found`);
    return match[1];
}

// Loads codec, sim and link into a fresh context that has no navigator or document; touching either at load time fails.
function load() {
    const touched = [];
    const context = { console, setTimeout, clearTimeout, setInterval, clearInterval };
    for (const name of ['navigator', 'document', 'window', 'localStorage']) {
        Object.defineProperty(context, name, { get() { touched.push(name); return undefined; }, configurable: true });
    }
    vm.createContext(context);
    for (const id of ['bedjet-codec', 'bedjet-sim', 'bedjet-link']) vm.runInContext(script(id), context, { filename: id });
    assert.deepEqual(touched, [], 'scripts touched browser globals at load time');
    return context;
}

const ctx = load();
const { BedJetCodec: C, BedJetSim, BedJetWebLink, BedJetDevice } = ctx;
const { Mode } = C;
const bytes = text => Array.from(C.fromHex(text));
const arr = value => Array.from(value);
const plain = value => JSON.parse(JSON.stringify(value));
const step = (mode, fan, temp, hours, minutes, clock = false) => ({ mode, fan, temp, hours, minutes, clock });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const STATUS = '01 56 1b 01 00 00 00 2e 4f 00 13 00 00 14 50 00 00 2d 00 12 01 9a 01 10 10 00 15 35 00 01 53';
const FRAGMENT = '07 08 04 04 09 2c 01 00 04 0d 31 03 00 04 09 2e 01 0f 01 04 2f 01 00 00'
    + ' 00'.repeat(43 - 24);
const NAMES = '04 05 63 68 6f 74 65 20 6d 6f 74 65 7a 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00'
    + ' 00 00 73 6c 65 65 65 65 70 00 00 00 00 00 00 00 00 00';

test('status fixture parses after merge', () => {
    const s = C.parseStatus(C.fromHex(STATUS));
    assert.equal(s.mode, Mode.STANDBY);
    assert.equal(s.actualTemp, 46);
    assert.equal(s.targetTemp, 79);
    assert.equal(s.fanStep, 19);
    assert.equal(s.fanPercent, 100);
    assert.equal(s.ambientTemp, 45);
    assert.equal(s.minTemp, 20);
    assert.equal(s.maxTemp, 80);
    assert.equal(s.maxRuntimeMinutes, 0);
    assert.equal(s.shutdownReason, 0);
    assert.equal(s.partial, true);
    assert.deepEqual(plain(s.extra), {
        flags: 0x35, connTestPassed: true, ledEnabled: true, unitsSetUp: true, beepsMuted: true,
        programStep: 0, notification: C.Notification.CLEAN_FILTER,
    });
});

test('first 20 status bytes parse without extra', () => {
    const head = C.fromHex(STATUS).slice(0, 20);
    assert.ok(C.isStatusStart(head));
    const s = C.parseStatus(head);
    assert.equal(s.targetTemp, 79);
    assert.equal(s.extra, null);
    assert.equal(C.parseStatus(head.slice(0, 19)), null);
});

test('status parsing respects DataView byteOffset', () => {
    const buffer = new ArrayBuffer(40);
    new Uint8Array(buffer).set(C.fromHex(STATUS), 5);
    const s = C.parseStatus(new DataView(buffer, 5, 31));
    assert.equal(s.targetTemp, 79);
    assert.equal(s.extra.notification, 1);
});

test('mode is byte 9 and max runtime bytes 11-12', () => {
    const b = C.fromHex(STATUS);
    b[9] = Mode.COOL;
    b[11] = 2;
    b[12] = 30;
    const s = C.parseStatus(b);
    assert.equal(s.mode, Mode.COOL);
    assert.equal(s.maxRuntimeMinutes, 150);
});

test('fragment fixture', () => {
    const reply = C.fromHex(FRAGMENT);
    assert.equal(reply.length, 43);
    const fragment = C.parseFragment(reply.slice(2), 0);
    assert.equal(fragment.total, 4);
    assert.deepEqual(plain(fragment.steps), [
        step(Mode.COOL, 9, 44, 1, 0),
        step(Mode.COOL, 13, 49, 3, 0),
        step(Mode.COOL, 9, 46, 1, 15),
        step(Mode.HEAT, 4, 47, 1, 0),
    ]);
    const frames = C.writeProgram(0, fragment.steps);
    assert.equal(frames.length, 1);
    assert.deepEqual(arr(frames[0].slice(0, 2)), [0x40, 0x07]);
    assert.deepEqual(arr(frames[0].slice(2)), arr(reply.slice(2)));
});

test('names fixture', () => {
    assert.deepEqual(plain(C.parseNames(C.fromHex(NAMES).slice(2))), ['chote motez', null, 'sleeeep']);
});

test('clock-time step bytes', () => {
    const s = step(Mode.COOL, 14, 36, 6, 30, true);
    const frame = C.writeProgram(0, [s])[0];
    assert.deepEqual(arr(frame.slice(3, 8)), bytes('04 0e 24 86 1e'));
    assert.deepEqual(plain(C.parseFragment(frame.slice(2), 0).steps), [s]);
});

test('name frame is padded and trimmed to 15', () => {
    const frame = C.nameFrame(5, 'A very long schedule name ✨');
    assert.equal(frame.length, 19);
    assert.deepEqual(arr(frame.slice(0, 3)), [0x40, 0x05, 0x10]);
    assert.equal(C.parseText(frame.slice(3)), 'A very long sch');
    assert.deepEqual(arr(C.nameFrame(4, 'ab').slice(3)), [0x61, 0x62, ...new Array(14).fill(0)]);
});

test('19 steps in slot 2 split into fragments 15, 16, 17', () => {
    const steps = Array.from({ length: 19 }, (_, i) => step(Mode.COOL, i, 40, 0, 30));
    const frames = C.writeProgram(2, steps);
    assert.deepEqual(arr(frames.map(f => f[1])), [15, 16, 17]);
    assert.ok(frames.every(f => f.length === 43 && f[2] === 19));
    const back = frames.flatMap((f, i) => C.parseFragment(f.slice(2), i).steps);
    assert.deepEqual(plain(back), steps);
});

test('command encoders', () => {
    assert.deepEqual(arr(C.setRuntime(150)), [0x02, 2, 30]);
    assert.deepEqual(arr(C.setTemperature(79)), [0x03, 79]);
    assert.deepEqual(arr(C.setFan(25)), [0x07, 19]);
    assert.deepEqual(arr(C.setClock(6, 5)), [0x08, 6, 5]);
    assert.deepEqual(arr(C.setMode(Mode.COOL)), [0x01, 0x02]);
    assert.deepEqual(arr(C.setMode(Mode.EXT_HEAT)), [0x01, 0x06]);
    assert.deepEqual(arr(C.setMode(Mode.STANDBY)), [0x01, 0x01]);
    assert.throws(() => C.setMode(Mode.WAIT));
    assert.deepEqual(arr(C.setLED(false)), [0x01, 0x47]);
    assert.deepEqual(arr(C.setMuted(true)), [0x01, 0x48]);
    assert.deepEqual(arr(C.ack()), [0x01, 0x52]);
    assert.deepEqual(arr(C.recallMemory(3)), [0x01, 0x22]);
    assert.deepEqual(arr(C.startProgram(2)), [0x01, 0x82]);
    assert.deepEqual(arr(C.deleteProgram(1)), [0x01, 0x84]);
    assert.deepEqual(arr(C.query(0x20, 7)), [0x41, 0x20, 7]);
});

test('factory reset can never be encoded', () => {
    assert.throws(() => C.button(0x4c), err => err.name === 'RangeError');
    assert.ok(!Object.values(C.Button).includes(0x4c));
});

test('heat table', () => {
    assert.equal(C.heatHours(Mode.HEAT, 80, 19), 1);
    assert.equal(C.heatHours(Mode.HEAT, 75, 19), 2);
    assert.equal(C.heatHours(Mode.HEAT, 80, 0), 4);
    assert.equal(C.heatHours(Mode.HEAT, 81, 0), 1);
    assert.equal(C.heatHours(Mode.HEAT, 66, 19), 12);
    assert.equal(C.heatHours(Mode.COOL, 80, 19), 12);
    assert.equal(C.longestStepMinutes(Mode.HEAT, 80, 19), 60);
    assert.equal(C.longestStepMinutes(Mode.HEAT, 66, 19), C.Limits.maxStepMinutes);
    assert.equal(C.longestStepMinutes(Mode.HEAT, 50, 19), C.Limits.maxStepMinutes);
    assert.ok(!C.fitsUnitLimits(step(Mode.HEAT, 19, 80, 2, 0)));
    assert.ok(C.fitsUnitLimits(step(Mode.HEAT, 19, 80, 1, 0)));
    assert.ok(C.fitsUnitLimits(step(Mode.WAIT, 19, 80, 6, 0, true)));
});

test('fallback temperature ranges follow the official app', () => {
    const ranges = Object.fromEntries(Object.entries(C.TEMP_RANGES).map(([m, r]) => [m, [r.min, r.max]]));
    assert.deepEqual(plain(ranges), {
        0: [80, 80], 1: [45, 80], 2: [86, 86], 3: [38, 67], 4: [38, 62], 5: [40, 62], 6: [80, 80],
    });
    const live = C.parseStatus(C.fromHex(STATUS));
    live.mode = Mode.DRY;
    live.minTemp = 40;
    live.maxTemp = 55;
    assert.deepEqual(plain(C.tempRange(Mode.DRY, live)), { min: 40, max: 55, live: true });
    assert.deepEqual(plain(C.tempRange(Mode.COOL, live)), { min: 38, max: 62, live: false });
});

test('temperature display helpers', () => {
    assert.equal(C.formatTemp(79), '39.5°C');
    assert.equal(C.formatTemp(80), '40°C');
    assert.equal(C.formatTemp(80, 'F'), '104°F');
    assert.equal(C.fromFahrenheit(104), 80);
    assert.equal(C.fromCelsius(22.5), 45);
});

test('clock time is only allowed for wait, ext. heat and cool', () => {
    const allowed = [0, 1, 2, 3, 4, 5, 6].filter(m => C.clockTimeAllowed(m));
    assert.deepEqual(allowed, [Mode.EXT_HEAT, Mode.COOL, Mode.WAIT]);
});

test('validateProgram applies the editor rules', () => {
    const at = (h, m) => new Date(2026, 9, 21, h, m);
    const ok = [
        step(Mode.TURBO, 19, 86, 0, 5),
        step(Mode.WAIT, 19, 80, 0, 10),
        step(Mode.COOL, 5, 40, 0, 20),
        step(Mode.COOL, 4, 40, 6, 30, true),
    ];
    assert.deepEqual(plain(C.validateProgram(ok, at(23, 0))), []);

    const codes = (steps, now = at(23, 0)) => plain(C.validateProgram(steps, now)).map(e => [e.index, e.code]);
    assert.deepEqual(codes([]), [[-1, 'invalidProgram']]);
    assert.deepEqual(codes(Array.from({ length: 33 }, () => step(Mode.COOL, 5, 40, 0, 10))), [[-1, 'invalidProgram']]);
    // Clock time on heat is not offered by the official editor.
    assert.deepEqual(codes([step(Mode.HEAT, 5, 60, 6, 0, true)]), [[0, 'invalidProgram']]);
    // 06:30 is 7.5 h after 23:00 but 16.5 h after 14:00.
    assert.deepEqual(codes(ok, at(14, 0)), [[3, 'stepTooLong']]);
    assert.deepEqual(codes([step(Mode.WAIT, 19, 80, 23, 0, true)], at(23, 0)), [[0, 'stepTooLong']]);
    assert.deepEqual(codes([step(Mode.WAIT, 19, 70, 1, 0)]), [[0, 'invalidProgram']]);
    assert.deepEqual(codes([step(Mode.TURBO, 19, 86, 0, 11)]), [[0, 'invalidProgram']]);
    assert.deepEqual(codes([step(Mode.HEAT, 19, 80, 2, 0)]), [[0, 'stepTooLong']]);
    assert.deepEqual(codes([step(Mode.COOL, 5, 40, 12, 0)]), [[0, 'stepTooLong']]);
    assert.deepEqual(codes([step(Mode.DRY, 5, 70, 1, 0)]), [[0, 'invalidProgram']]);
    assert.deepEqual(codes([step(Mode.COOL, 5, 40, 0, 0)]), [[0, 'invalidProgram']]);
});

test('sim: runtime follows the mode limit', async () => {
    const sim = new BedJetSim({ autoTick: false });
    await sim.connect();
    let latest = null;
    sim.on('status', s => { latest = s; });
    const device = new BedJetDevice(sim);
    await device.setMode(Mode.HEAT);
    assert.equal(latest.mode, Mode.HEAT);
    assert.equal(latest.remainingSeconds, 3600);
    await device.setRuntime(150);
    assert.equal(latest.remainingSeconds, 150 * 60);
    await device.setRuntime(600);
    assert.equal(latest.remainingSeconds, 240 * 60);
    assert.equal(latest.maxRuntimeMinutes, 240);
    sim.tick();
    assert.equal(latest.remainingSeconds, 240 * 60 - 1);
});

test('device: store and read back through the sim', async () => {
    const sim = new BedJetSim({ autoTick: false, slots: [{ name: 'old', steps: [step(Mode.DRY, 1, 50, 1, 0)] }, null, null] });
    await sim.connect();
    const device = new BedJetDevice(sim);
    const steps = Array.from({ length: 11 }, (_, i) => step(i % 2 ? Mode.HEAT : Mode.COOL, i, 50, 0, 20 + i));
    const saved = await device.store({ name: 'Deep Sleep', steps }, 1);
    assert.equal(saved.name, 'Deep Sleep');
    assert.deepEqual(plain(await device.storedPrograms()), [
        { name: 'old', steps: [step(Mode.DRY, 1, 50, 1, 0)] },
        { name: 'Deep Sleep', steps },
        null,
    ]);
    assert.equal(await device.firmware(), 'V1.20 (demo)');
    assert.equal(await device.deviceName(), 'BEDJET-DEMO');
});

test('device: a step past the heat cut-off is not stored', async () => {
    const sim = new BedJetSim({ autoTick: false });
    await sim.connect();
    const device = new BedJetDevice(sim);
    await assert.rejects(
        device.store({ name: 'too hot', steps: [step(Mode.HEAT, 19, 80, 3, 0)] }, 0),
        err => err.code === 'stepTooLong' && /Step 1/.test(err.message),
    );
    assert.equal(sim.slots[0], null);
});

test('device: start program syncs the clock and runs step 1', async () => {
    const sim = new BedJetSim({ autoTick: false });
    await sim.connect();
    const device = new BedJetDevice(sim);
    await device.store({ name: 'Night', steps: [step(Mode.COOL, 5, 44, 2, 0), step(Mode.WAIT, 19, 80, 0, 30)] }, 0);
    assert.equal(sim.clock, null);
    const status = await device.startProgram(0, { date: new Date(2026, 9, 21, 22, 15) });
    assert.equal(sim.clock, (22 * 60 + 15) * 60);
    assert.equal(status.mode, Mode.COOL);
    assert.equal(status.fanStep, 5);
    assert.equal(status.targetTemp, 44);
    assert.equal(status.extra.programStep, 1);
    sim.skipAhead(125);
    assert.equal(device.status.extra.programStep, 2);
    assert.equal(device.status.mode, Mode.WAIT);
    await device.stopProgram();
    assert.equal(device.status.extra.programStep, 0);
    assert.equal(device.status.mode, Mode.STANDBY);
});

test('device: refused program raises the typed error and the notification is acknowledged', async () => {
    const sim = new BedJetSim({ autoTick: false, slots: [{ name: 'too hot', steps: [step(Mode.HEAT, 19, 80, 3, 0)] }, null, null] });
    await sim.connect();
    const device = new BedJetDevice(sim);
    const shown = [];
    device.on('notification', n => shown.push(n.code));
    const sent = [];
    sim.on('raw', r => { if (r.dir === 'tx') sent.push(C.hex(r.bytes)); });
    await assert.rejects(device.startProgram(0), err => err.code === 'stepTooLong' && err.message === C.NOTIFICATION_TEXT[5]);
    assert.deepEqual(shown, [5]);
    assert.ok(sent.includes('01 80') && sent.includes('01 52'), sent.join(' | '));
    assert.equal(sim.status.notification, 0);
    assert.equal(device.status.extra.notification, 0);
    assert.equal(device.status.extra.programStep, 0);
});

test('device: notifications are acknowledged automatically and shown once per code', async () => {
    const sim = new BedJetSim({ autoTick: false });
    await sim.connect();
    const device = new BedJetDevice(sim);
    const shown = [];
    device.on('notification', n => shown.push(n));
    sim.status.notification = 1;
    sim.tick();
    await settle();
    assert.equal(sim.status.notification, 0);
    assert.deepEqual(plain(shown), [{ code: 1, text: C.NOTIFICATION_TEXT[1] }]);
});

// ---- Web link with fake characteristics ----

function view(values, offset = 3) {
    const buffer = new ArrayBuffer(values.length + offset + 2);
    new Uint8Array(buffer).set(values, offset);
    return new DataView(buffer, offset, values.length);
}

function fakeLink({ reply, replyAlt }) {
    const link = new BedJetWebLink({ releaseWhenHidden: false, storage: null, queryRetryMs: 1 });
    const writes = [];
    const command = { async writeValueWithResponse(b) { writes.push(C.hex(b)); } };
    const chars = { command };
    if (reply) chars.reply = { readValue: async () => view(reply(writes)) };
    if (replyAlt) chars.replyAlt = { readValue: async () => view(replyAlt(writes)) };
    link.attach(chars);
    return { link, writes };
}

test('web link: stale reply is retried with the same tag', async () => {
    const answer = [0x20, 0x01, ...Array.from('V1.20', ch => ch.charCodeAt(0)), 0];
    const { link, writes } = fakeLink({
        reply: w => (w.length < 3 ? [0x04, 0x09, 0xaa] : answer),
    });
    const device = new BedJetDevice(link);
    assert.equal(await device.firmware(), 'V1.20');
    assert.deepEqual(writes, ['41 20 01', '41 20 01', '41 20 01']);
    assert.equal(link.replySource, '2005');
    await device.deviceName().catch(() => {});
    assert.equal(writes.at(-1).slice(0, 8), '41 00 02', 'a new request gets a new tag');
});

test('web link: falls back to 2006 and remembers it', async () => {
    const { link, writes } = fakeLink({
        reply: () => [0x00, 0x00],
        replyAlt: w => { const [, id, tag] = w.at(-1).split(' ').map(h => parseInt(h, 16)); return [id, tag, 0x42, 0x4a, 0]; },
    });
    assert.deepEqual(arr(await link.query(0x00)), [0x42, 0x4a, 0]);
    assert.equal(link.replySource, '2006');
    assert.equal(writes.length, 1);
});

test('web link: gives up after 8 attempts', async () => {
    const { link, writes } = fakeLink({ reply: () => [0x00, 0x00] });
    await assert.rejects(link.query(0x20), err => err.code === 'badResponse');
    assert.equal(writes.length, 8);
    assert.ok(writes.every(w => w === '41 20 01'));
});

test('web link: partial status reads the remainder and merges it', async () => {
    const full = C.fromHex(STATUS);
    let reads = 0;
    const listeners = [];
    const status = {
        addEventListener: (_, cb) => listeners.push(cb),
        removeEventListener() {},
        async readValue() { reads += 1; return view(full.slice(20)); },
    };
    let now = 10000;
    const link = new BedJetWebLink({ releaseWhenHidden: false, storage: null, now: () => now });
    link.attach({ command: { async writeValueWithResponse() {} }, status });
    const seen = [];
    link.on('status', s => seen.push(s));
    const notify = values => listeners.forEach(cb => cb({ target: { value: view(values) } }));
    notify(full.slice(0, 20));
    await settle();
    assert.equal(reads, 1);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].extra, null);
    assert.equal(seen[0].extraFresh, false);
    assert.equal(seen[1].extra.notification, 1);
    assert.equal(seen[1].extraFresh, true);
    now += 500;
    notify(full.slice(0, 20));
    await settle();
    assert.equal(reads, 1, 'remainder is read at most every 2 s');
    assert.equal(seen[2].extra.notification, 1, 'last known extra is carried over');
    assert.equal(seen[2].extraFresh, false);
});

test('web link: commands need a connection', async () => {
    const link = new BedJetWebLink({ releaseWhenHidden: false, storage: null });
    await assert.rejects(link.send(C.ack()), err => err.code === 'notConnected');
    assert.equal(BedJetWebLink.isSupported(), false);
});

// ---- Device tab diagnostics (app-device, loaded without a DOM) ----

vm.runInContext(script('app-device'), ctx, { filename: 'app-device' });
const D = ctx.BedJetDiagnostics;

function memoryStorage() {
    const map = new Map();
    return { map, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

// A sim whose statuses and sent frames feed a tracker, with a clock the test moves.
async function trackedSim({ storage = memoryStorage(), clock = { now: Date.UTC(2026, 9, 21, 1, 0) }, shutdown = 0 } = {}) {
    const sim = new BedJetSim({ autoTick: false });
    sim.status.shutdown = shutdown;
    const tracker = new D.ShutdownTracker({ storage, now: () => clock.now });
    sim.on('raw', r => { if (r.dir === 'tx') tracker.tx(r.bytes); });
    const entries = [];
    sim.on('status', s => { const e = tracker.status(s); if (e) entries.push(plain(e)); });
    await sim.connect();
    return { sim, tracker, device: new BedJetDevice(sim, { autoAck: false }), entries, storage, clock };
}

// What the real unit does when it cuts out: standby with a reason byte, no command from anyone.
function cutOut(sim, reason) {
    Object.assign(sim.status, { mode: Mode.STANDBY, remainingSeconds: 0, maxRuntime: 0, shutdown: reason });
    sim.skipAhead(0);
}

test('app-device defines BedJetDiagnostics without touching the DOM', () => {
    assert.equal(typeof D.probe, 'function');
    assert.equal(typeof D.ShutdownTracker, 'function');
    assert.equal(ctx.App, undefined);
});

test('shutdown log: a stop with time left is unexpected, timer end and Off are expected', async () => {
    const { sim, device, entries, clock, tracker } = await trackedSim();
    await device.setMode(Mode.HEAT);
    clock.now += 5 * 60000;
    sim.skipAhead(5);
    cutOut(sim, 7);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'live');
    assert.equal(entries[0].fromMode, Mode.HEAT);
    assert.equal(entries[0].remainingSeconds, 55 * 60);
    assert.equal(entries[0].shutdownReason, 7);
    assert.equal(entries[0].expected, false);

    await device.setMode(Mode.COOL);
    await device.setRuntime(1);
    clock.now += 60000;
    sim.skipAhead(1);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].fromMode, Mode.COOL);
    assert.equal(entries[1].expected, true);
    assert.equal(entries[1].why, 'timer');

    await device.setMode(Mode.HEAT);
    clock.now += 1000;
    await device.setMode(Mode.STANDBY);
    assert.equal(entries.length, 3);
    assert.equal(entries[2].expected, true);
    assert.equal(entries[2].why, 'off');

    // Off sent long ago no longer explains a stop.
    await device.setMode(Mode.HEAT);
    clock.now += D.OFF_WINDOW_MS + 1000;
    cutOut(sim, 3);
    assert.equal(entries[3].expected, false);

    // Byte 18 is the *last* shutdown reason, so it sticks until the next cut-out.
    assert.deepEqual(plain(tracker.entries).map(e => e.shutdownReason), [3, 7, 7, 7], 'newest first');
    assert.deepEqual(plain(D.reasonCounts(tracker.entries)), [
        { code: 3, total: 1, unexpected: 1 },
        { code: 7, total: 3, unexpected: 1 },
    ]);
});

test('shutdown log: a program cut short records its step; staying in standby records nothing', async () => {
    const { sim, device, entries } = await trackedSim();
    sim.slots[0] = { name: 'Night', steps: [step(Mode.COOL, 5, 44, 2, 0), step(Mode.WAIT, 19, 80, 1, 0)] };
    await device.startProgram(0, { date: new Date(2026, 9, 21, 22, 0) });
    sim.skipAhead(125);
    cutOut(sim, 9);
    sim.skipAhead(1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fromMode, Mode.WAIT);
    assert.equal(entries[0].programStep, 2);
    assert.equal(entries[0].expected, false);
});

test('shutdown log: stop while away is found on reconnect', async () => {
    const storage = memoryStorage();
    const clock = { now: Date.UTC(2026, 9, 21, 0, 0) };
    const first = await trackedSim({ storage, clock });
    await first.device.setMode(Mode.HEAT);
    assert.equal(first.sim.status.remainingSeconds, 3600);
    await first.sim.disconnect();
    first.tracker.disconnected();

    // The app comes back 10 minutes later (new page load, same storage); the unit is in standby.
    clock.now += 10 * 60000;
    const second = await trackedSim({ storage, clock, shutdown: 4 });
    assert.equal(second.entries.length, 1);
    const entry = second.entries[0];
    assert.equal(entry.kind, 'away');
    assert.equal(entry.expected, false);
    assert.equal(entry.fromMode, Mode.HEAT);
    assert.equal(entry.remainingSeconds, 3600);
    assert.equal(entry.awaySeconds, 600);
    assert.equal(entry.shutdownReason, 4);
    assert.equal(plain(JSON.parse(storage.getItem('bedjet-bluetooth-control_shutdowns')))[0].kind, 'away');

    const last = plain(first.tracker.last);
    const standby = C.parseStatus(second.sim.packet());
    const at = minutes => ({ time: last.time + minutes * 60000 });
    assert.equal(D.detectAwayStop(last, standby, at(59.5)), null, 'timer had (nearly) run out anyway');
    assert.equal(D.detectAwayStop({ ...last, offAt: last.time + 500 }, standby, at(10)), null, 'Off was sent before leaving');
    assert.ok(D.detectAwayStop({ ...last, offAt: last.time - 3600000 }, standby, at(10)), 'an old Off does not count');
    assert.equal(D.detectAwayStop(last, { ...standby, mode: Mode.COOL }, at(10)), null, 'still running');
});

test('shutdown log: capped at 50 and persisted', () => {
    const storage = memoryStorage();
    let now = Date.UTC(2026, 9, 21);
    const tracker = new D.ShutdownTracker({ storage, now: () => now });
    const running = { mode: Mode.HEAT, remainingSeconds: 1800, shutdownReason: 0, extra: null };
    const standby = { mode: Mode.STANDBY, remainingSeconds: 0, shutdownReason: 2, extra: null };
    tracker.status(standby);
    for (let i = 0; i < 60; i++) {
        now += 1000;
        tracker.status(running);
        tracker.status(standby);
    }
    assert.equal(tracker.entries.length, D.SHUTDOWN_CAP);
    const reloaded = new D.ShutdownTracker({ storage });
    assert.equal(reloaded.entries.length, D.SHUTDOWN_CAP);
    assert.equal(reloaded.entries[0].time, new Date(now).toISOString());
});

const NAME_BLOCK = [...Array.from('M1', ch => ch.charCodeAt(0)), ...new Array(14).fill(0), 0x01, ...new Array(31).fill(0)];
function payloadFor(id) {
    if (id === 0x01 || id === 0x04) return NAME_BLOCK;
    if (id === 0x00 || id === 0x20) return [...Array.from(id ? 'V1.20' : 'BEDJET', ch => ch.charCodeAt(0)), 0];
    return [0, ...new Array(40).fill(0)];
}

test('probe over the web link: only 41 queries are written, sources and retries are recorded', async () => {
    const lastQuery = writes => {
        const [op, id, tag] = writes.at(-1).split(' ').map(h => parseInt(h, 16));
        assert.equal(op, 0x41);
        return { id, tag, attempts: writes.filter(w => w === writes.at(-1)).length };
    };
    const { link, writes } = fakeLink({
        reply: w => {
            const { id, tag, attempts } = lastQuery(w);
            if ([0x01, 0x04, 0x0f].includes(id) || (id === 0x07 && attempts < 3)) return [0x04, 0x09, 0xaa];
            return [id, tag, ...payloadFor(id)];
        },
        replyAlt: w => {
            const { id, tag } = lastQuery(w);
            return [0x01, 0x04, 0x20].includes(id) ? [id, tag, ...payloadFor(id)] : [0x00, 0x00];
        },
    });
    const result = plain(await D.probe(link));
    assert.ok(writes.length > 0);
    assert.ok(writes.every(w => /^41 [0-9a-f]{2} [0-9a-f]{2}$/.test(w)), writes.join(' | '));

    const byId = Object.fromEntries(result.results.map(r => [r.id, r]));
    assert.deepEqual(Object.keys(byId).map(Number), [0x00, 0x01, 0x04, 0x07, 0x0b, 0x0f, 0x20].sort((a, b) => a - b));
    assert.equal(byId[0x00].source, '2005');
    assert.equal(byId[0x00].value, 'BEDJET');
    assert.equal(byId[0x01].source, '2006');
    assert.deepEqual(byId[0x01].value, ['M1', null, '']);
    assert.equal(byId[0x20].value, 'V1.20');
    assert.equal(byId[0x07].source, '2005');
    assert.equal(byId[0x07].attempts, 3);
    assert.deepEqual(byId[0x07].value, { totalSteps: 0, stepsInFragment: 0 });
    assert.equal(byId[0x0f].source, null);
    assert.equal(byId[0x0f].attempts, 8);
    assert.ok(byId[0x0f].error);
    assert.equal(result.compare.chars['2005'].matches, true);
    assert.equal(result.compare.chars['2006'].matches, true);
    assert.equal(result.summary.answered, 6);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.summary.maxAttempts, 8);
    assert.deepEqual(result.summary.compareHolding, ['2005', '2006']);
    assert.match(result.summary.verdict, /2005 \(\d×\) and 2006 \(\d×\)/);
});

test('probe over the simulator never calls send and only queries', async () => {
    const sim = new BedJetSim({ autoTick: false, slots: [{ name: 'Night', steps: [step(Mode.COOL, 5, 44, 2, 0)] }, null, null] });
    await sim.connect();
    const sent = [];
    sim.on('raw', r => { if (r.dir === 'tx') sent.push(C.hex(r.bytes)); });
    const send = sim.send.bind(sim);
    let sendCalls = 0;
    sim.send = bytes => { sendCalls += 1; return send(bytes); };
    const result = plain(await D.probe(sim));
    assert.equal(sendCalls, 0);
    assert.equal(sent.length, D.PROBE_QUERIES.length);
    assert.ok(sent.every(w => w.startsWith('41 ')), sent.join(' | '));
    assert.ok(result.results.every(r => r.source === 'sim' && r.attempts === 1));
    assert.deepEqual(result.results.find(r => r.id === 7).value, { totalSteps: 1, stepsInFragment: 1 });
    assert.ok(result.compare.skipped);
    assert.equal(result.summary.verdict, 'Every answered query came from sim.');
});

test('probe summary of an empty or failed run', () => {
    assert.equal(D.summarizeProbe({ results: [] }).verdict, 'No query was answered.');
    const s = plain(D.summarizeProbe({
        results: [{ source: '2006', attempts: 1 }, { source: null, attempts: 8 }],
        compare: { chars: { '2005': { matches: false }, '2006': { matches: true } } },
    }));
    assert.equal(s.verdict, 'Every answered query came from 2006. 1 unanswered. 1 needed retries (max 8 attempts). Read after one query, only 2006 held the reply.');
});

// ---- Programs tab: pure helpers ----

function loadPrograms() {
    const touched = [];
    const context = { console, setTimeout, clearTimeout, setInterval, clearInterval };
    for (const name of ['navigator', 'document', 'window', 'localStorage', 'App']) {
        Object.defineProperty(context, name, { get() { touched.push(name); return undefined; }, configurable: true });
    }
    vm.createContext(context);
    for (const id of ['bedjet-codec', 'bedjet-sim', 'bedjet-link']) vm.runInContext(script(id), context, { filename: id });
    touched.length = 0;
    vm.runInContext(script('app-programs'), context, { filename: 'app-programs' });
    assert.deepEqual(touched.filter(n => n !== 'document' && n !== 'App'), [], 'app-programs touched browser globals at load time');
    return context;
}

const pctx = loadPrograms();
const P = pctx.BedJetPrograms;
const PC = pctx.BedJetCodec;
const at = (h, m) => new Date(2026, 9, 21, h, m);

test('programs: timeline and end time, clock-time steps across midnight', () => {
    const steps = [step(Mode.COOL, 5, 40, 1, 0), step(Mode.WAIT, 19, 80, 1, 30, true), step(Mode.COOL, 3, 40, 2, 0)];
    const tl = P.timeline(steps, 22 * 60);
    assert.deepEqual(plain(tl.segments.map(s => [s.start, s.end])), [[0, 60], [60, 210], [210, 330]]);
    assert.deepEqual(plain(P.endTime(steps, 22 * 60)), { total: 330, minute: 3 * 60 + 30, days: 1 });
    assert.deepEqual(plain(P.endTime([step(Mode.COOL, 5, 40, 2, 0)], 9 * 60)), { total: 120, minute: 11 * 60, days: 0 });
    // Same program planned for 14:00: "until 01:30" now lasts 10.5 h.
    assert.equal(P.timeline(steps, 14 * 60).segments[1].minutes, 630);
    assert.equal(P.formatHM(1500), '01:00');
    assert.equal(P.parseHM('22:30'), 1350);
    assert.equal(P.parseHM('24:00'), null);
});

test('programs: run position follows the status step and time left', () => {
    const steps = [step(Mode.TURBO, 19, 86, 0, 10), step(Mode.COOL, 5, 40, 1, 0)];
    assert.deepEqual(plain(P.runPosition(steps, 0, 2, 15 * 60)), { index: 1, elapsed: 55 });
    assert.deepEqual(plain(P.runPosition(steps, 0, 1, 99999)), { index: 0, elapsed: 0 });
});

test('programs: coerceStep clamps like the official editor', () => {
    const c = s => plain(P.coerceStep(s));
    assert.deepEqual(c(step(Mode.HEAT, 19, 40, 6, 0)), step(Mode.HEAT, 19, 80, 1, 0), 'heat: out of range → max, then the cut-off');
    assert.deepEqual(c(step(Mode.COOL, 5, 80, 3, 0)), step(Mode.COOL, 5, 38, 3, 0), 'cool: out of range → min');
    assert.deepEqual(c(step(Mode.TURBO, 19, 40, 1, 0)), step(Mode.TURBO, 19, 86, 0, 10));
    assert.deepEqual(c(step(Mode.TURBO, 19, 86, 0, 0)), step(Mode.TURBO, 19, 86, 0, 1));
    assert.deepEqual(c(step(Mode.WAIT, 4, 40, 2, 0)), step(Mode.WAIT, 4, 80, 2, 0));
    assert.deepEqual(c(step(Mode.HEAT, 5, 60, 6, 0, true)), step(Mode.HEAT, 5, 60, 6, 0), 'heat has no clock time');
    assert.deepEqual(c(step(Mode.COOL, 5, 40, 12, 0)), step(Mode.COOL, 5, 40, 11, 59));
    assert.deepEqual(c(step(Mode.STANDBY, 5, 80, 1, 0)).mode, Mode.WAIT);
    assert.equal(P.heatLimit(step(Mode.HEAT, 19, 75, 1, 0)), 120);
    assert.equal(P.heatLimit(step(Mode.HEAT, 19, 50, 1, 0)), null);
});

test('programs: template options Sleep + Wake and Cloud Sheet', () => {
    const base = P.expandTemplate('neutral-15');
    assert.equal(base.name, 'Neutral <26');
    assert.deepEqual(plain(base.steps.map(s => [s.mode, PC.fanPercent(s.fan), s.temp, s.hours * 60 + s.minutes])),
        [[Mode.TURBO, 100, 86, 5], [Mode.TURBO, 50, 86, 4], [Mode.WAIT, 50, 80, 10], [Mode.COOL, 40, 40, 20], [Mode.COOL, 25, 40, 390]]);
    const wake = P.expandTemplate('neutral-15', { sleepWake: true });
    assert.equal(wake.steps.length, 8);
    assert.deepEqual(plain(wake.steps.slice(5).map(s => [s.mode, PC.fanPercent(s.fan), s.temp, s.minutes])),
        [[Mode.HEAT, 35, 70, 10], [Mode.HEAT, 40, 76, 10], [Mode.HEAT, 45, 80, 10]]);
    const both = P.expandTemplate('neutral-15', { sleepWake: true, cloudSheet: true });
    assert.equal(both.name, 'Neutral <26 +WC');
    assert.deepEqual(plain(both.steps.map(s => PC.fanPercent(s.fan))), [100, 60, 60, 50, 35, 45, 50, 55]);
    assert.throws(() => P.expandTemplate('nope'));
});

function allTemplatePrograms() {
    const out = [];
    for (const t of P.templates()) {
        const variants = t.kind === 'official'
            ? [{}, { sleepWake: true }, { cloudSheet: true }, { sleepWake: true, cloudSheet: true }] : [{}];
        for (const opts of variants) out.push(P.expandTemplate(t.id, opts));
    }
    return out;
}

test('programs: every template is valid and survives store + read back on the sim', async () => {
    const programs = allTemplatePrograms();
    assert.equal(programs.length, 6 * 4 + 4);
    const sim = new pctx.BedJetSim({ autoTick: false });
    await sim.connect();
    const device = new pctx.BedJetDevice(sim);
    for (const program of programs) {
        assert.ok(program.name.length >= 1 && program.name.length <= 15, program.name);
        assert.equal(PC.sanitizeName(program.name), program.name);
        assert.deepEqual(plain(PC.validateProgram(program.steps, at(22, 30))), [], program.name);
        await device.store(program, 1, { now: at(22, 30) });
        const back = (await device.storedPrograms())[1];
        assert.deepEqual(plain(back), plain({ name: program.name, steps: program.steps }), program.name);
    }
    const seeded = P.seedLibrary();
    assert.ok(seeded.length >= 3);
    for (const s of seeded) assert.deepEqual(plain(PC.validateProgram(s.steps, s.start ? at(...s.start.split(':').map(Number)) : at(22, 30))), [], s.name);
});

test('programs: library parsing', () => {
    assert.equal(P.parseLibrary(null).length, P.seedLibrary().length);
    assert.equal(P.parseLibrary('{oops'), null);
    const list = P.parseLibrary(JSON.stringify([{ id: 'a', name: 'Långt namn som är för långt', steps: [step(Mode.COOL, 5, 40, 1, 0)], start: '7:05' }, { name: 'empty', steps: [] }]));
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Lngt namn som r');
    assert.equal(list[0].start, '07:05');
});

test('programs: curve points', () => {
    const steps = [step(Mode.COOL, 9, 40, 1, 0), step(Mode.WAIT, 19, 80, 1, 0), step(Mode.HEAT, 9, 70, 1, 0)];
    const m = P.curveModel(steps, 23 * 60, { width: 304, height: 100, padX: 2, padTop: 0, padBottom: 0 });
    assert.deepEqual(plain(m.segments.map(s => [s.x0, s.x1])), [[2, 102], [102, 202], [202, 302]]);
    assert.equal(m.segments[1].y, null, 'wait is a gap');
    assert.equal(m.tempPaths.length, 2);
    assert.equal(m.fanPaths.length, 2);
    assert.ok(m.segments[2].y < m.segments[0].y, 'warmer is higher');
    assert.deepEqual(plain(m.ticks.map(t => t.label)), ['23:00', '00:00', '01:00', '02:00']);
    const svg = P.curveSVG(steps, 23 * 60, { highlight: 2, marker: 150, label: '<x>' });
    assert.match(svg, /^<svg class="pg-curve"/);
    assert.match(svg, /aria-label="&lt;x&gt;"/);
    assert.match(svg, /<circle/);
});
