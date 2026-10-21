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

test('web link: 2006 is read before 2005 on every query, also after 2005 answered', async () => {
    const reads = [];
    const { link } = fakeLink({
        replyAlt: () => { reads.push('2006'); return [0x00, 0x00]; },
        reply: w => { reads.push('2005'); const [, id, tag] = w.at(-1).split(' ').map(h => parseInt(h, 16)); return [id, tag, 0]; },
    });
    await link.query(0x00);
    await link.query(0x20);
    assert.deepEqual(reads, ['2006', '2005', '2006', '2005']);
});

test('web link: readReplies reads both characteristics in the queue, null when missing', async () => {
    const order = [];
    let release;
    const gate = new Promise(r => { release = r; });
    const link = new BedJetWebLink({ releaseWhenHidden: false, storage: null, queryRetryMs: 1 });
    link.attach({
        command: { async writeValueWithResponse() { order.push('write'); await gate; } },
        reply: { readValue: async () => { order.push('read 2005'); return view([0x20, 0x01, 0x56]); } },
    });
    const pending = link.query(0x20);
    const replies = link.readReplies();
    await settle();
    assert.deepEqual(order, ['write'], 'readReplies waits for the running query');
    release();
    await pending;
    const r = await replies;
    assert.deepEqual(arr(r['2005']), [0x20, 0x01, 0x56]);
    assert.equal(r['2006'], null);
    assert.deepEqual(order, ['write', 'read 2005', 'read 2005']);
    await assert.rejects(new BedJetWebLink({ releaseWhenHidden: false, storage: null }).readReplies(), err => err.code === 'notConnected');
});

test('sim: readReplies holds the last answer on 2005; cutOut stops with a reason byte', async () => {
    const sim = new BedJetSim({ autoTick: false, slots: [{ name: 'Night', steps: [step(Mode.COOL, 5, 44, 2, 0)] }, null, null], clock: 3600 });
    await assert.rejects(sim.readReplies(), err => err.code === 'notConnected');
    await sim.connect();
    assert.deepEqual(plain(await sim.readReplies()), { '2005': null, '2006': null });
    await sim.query(C.Query.FIRMWARE);
    const r = await sim.readReplies();
    assert.deepEqual(arr(r['2005']).slice(0, 2), [0x20, 1]);
    assert.equal(C.parseText(r['2005'].slice(2)), 'V1.20 (demo)');
    const device = new BedJetDevice(sim, { autoAck: false });
    await device.startProgram(0);
    const seen = [];
    sim.on('status', s => seen.push(s));
    sim.cutOut(7);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].mode, Mode.STANDBY);
    assert.equal(seen[0].shutdownReason, 7);
    assert.equal(seen[0].extra.programStep, 0);
    sim.skipAhead(10);
    assert.equal(sim.status.mode, Mode.STANDBY, 'the program does not resume');
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

const cutOut = (sim, reason) => sim.cutOut(reason);

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

test('shutdown log: one Off explains one stop, not a cut-out right after switching on again', async () => {
    const { sim, device, entries, clock } = await trackedSim();
    await device.setMode(Mode.HEAT);
    clock.now += 1000;
    await device.setMode(Mode.STANDBY);
    assert.equal(entries[0].why, 'off');
    await device.setMode(Mode.HEAT);
    clock.now += 2000;
    cutOut(sim, 7);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].expected, false);
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
    assert.equal(sent.length, D.PROBE_QUERIES.length + 1, 'plus one firmware query for the 2005/2006 compare');
    assert.ok(sent.every(w => w.startsWith('41 ')), sent.join(' | '));
    assert.ok(result.results.every(r => r.source === 'sim' && r.attempts === 1));
    assert.deepEqual(result.results.find(r => r.id === 7).value, { totalSteps: 1, stepsInFragment: 1 });
    assert.equal(result.compare.chars['2005'].matches, true);
    assert.deepEqual(result.compare.chars['2006'], { missing: true, matches: false });
    assert.equal(result.summary.verdict, 'Every answered query came from sim. Read after one query, only 2005 held the reply.');
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

// ---- app-core without a page: shared state, hash routing ----

async function loadCore() {
    const context = { console, setTimeout, clearTimeout, setInterval, clearInterval };
    vm.createContext(context);
    for (const id of ['bedjet-codec', 'bedjet-sim', 'bedjet-link', 'app-core']) vm.runInContext(script(id), context, { filename: id });
    return context;
}

const waitFor = async (predicate, ms = 3000) => {
    const end = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise(r => setTimeout(r, 20));
    }
};

test('core: tabFromHash accepts only the three tabs', async () => {
    const { App } = await loadCore();
    assert.equal(App.tabFromHash('#programs'), 'programs');
    assert.equal(App.tabFromHash('device'), 'device');
    assert.equal(App.tabFromHash('#remote'), 'remote');
    assert.equal(App.tabFromHash(''), null);
    assert.equal(App.tabFromHash('#settings'), null);
    assert.equal(App.tabFromHash(undefined), null);
});

test('core: memory names live in App.state, follow a rename and are cleared on disconnect', async () => {
    const { App } = await loadCore();
    App.set({ haptics: false });
    await App.setDemo(true, { persist: false });
    await waitFor(() => App.state.memoryNames);
    assert.deepEqual(plain(App.state.memoryNames), ['Cool down', 'Warm up', 'Dry sheets']);
    assert.equal(App.state.firmware, 'V1.20 (demo)');
    assert.equal(App.state.replySource, 'sim');

    await App.device.rename(C.NameParam.memory(2), 'Toasty');
    const changes = [];
    App.subscribe((s, changed) => { if ('memoryNames' in changed) changes.push(plain(s.memoryNames)); });
    await App.reloadMemoryNames();
    assert.deepEqual(changes, [['Cool down', 'Toasty', 'Dry sheets']]);

    await App.link.disconnect();
    assert.equal(App.state.link, 'disconnected');
    assert.equal(App.state.memoryNames, null);
    assert.equal(App.state.firmware, null);
    assert.equal(App.state.replySource, null);
    assert.equal(App.state.deviceName, null);
});

// Captured on a BedJet 3, firmware V1.20, Chrome 155 on Android (probe 2026-10-21): 2005 stops at 22 bytes.
test('web link: real unit, truncated 2005 vs full 2006 reply', async () => {
    const full2006 = C.fromHex('20 25 56 31 2e 32 30 20 28 31 34 30 29 00 00 00 00 00 56 31 2e 32 30 20 28 34 31 32 29 00 00 00 00 00 56 31 2e 32 30 20 28 31 38 32 29 00 00 00 00 00');
    const cut = bytes => Array.from(bytes).slice(0, 22);
    const { link } = fakeLink({
        reply: w => { const [, , tag] = w.at(-1).split(' ').map(h => parseInt(h, 16)); return cut([0x20, tag, ...full2006.slice(2)]); },
        replyAlt: w => { const [, , tag] = w.at(-1).split(' ').map(h => parseInt(h, 16)); return [0x20, tag, ...full2006.slice(2)]; },
    });
    assert.equal(await new BedJetDevice(link).firmware(), 'V1.20 (140) · V1.20 (412) · V1.20 (182)');
    assert.equal(link.replySource, '2006');
    const fragment2005 = C.fromHex('05 01 09 4c 00 05 01 07 3c 00 14 05 04 36 01 00 03 04 32 84');
    assert.equal(C.parseFragment(fragment2005, 0), null, '5 steps cannot fit in a 22-byte read');
});

// ---- Programs: schedule backup ----

const library = () => [
    { id: 'a', name: 'Cool drift', steps: [step(Mode.COOL, 11, 44, 0, 45), step(Mode.COOL, 5, 44, 5, 0)], start: null },
    { id: 'b', name: 'Until 6:30', steps: [step(Mode.TURBO, 19, 86, 0, 5), step(Mode.COOL, 4, 44, 6, 30, true)], start: '22:30' },
];
const slotsRead = () => [{ name: 'Cool night', steps: [step(Mode.COOL, 7, 40, 6, 30)] }, null, null];
const strip = list => plain(list.map(s => ({ name: s.name, start: s.start ?? null, steps: s.steps })));

test('backup: export round trip, with and without the BedJet slots', () => {
    const backup = P.buildBackup(library(), { appVersion: '2026-10-21 23:00', now: new Date('2026-10-21T21:00:00Z') });
    assert.equal(backup.app, 'jetcommand');
    assert.equal(backup.kind, 'schedules');
    assert.equal(backup.format, 1);
    assert.equal(backup.exported, '2026-10-21T21:00:00.000Z');
    assert.equal(backup.appVersion, '2026-10-21 23:00');
    assert.equal('deviceSlots' in backup, false, 'slots only when they were read');
    const back = P.parseBackup(JSON.stringify(backup));
    assert.deepEqual(strip(back.schedules), strip(library()));
    assert.equal(back.deviceSlots, null);
    assert.equal(back.empty, 0);

    const withSlots = P.parseBackup(JSON.stringify(P.buildBackup(library(), { deviceSlots: slotsRead() })));
    assert.deepEqual(plain(withSlots.deviceSlots), plain(slotsRead()));
});

test('backup: a bare array of schedules is accepted, startTime too', () => {
    const parsed = P.parseBackup(JSON.stringify([{ name: 'Old', startTime: '7:05', steps: [{ mode: '4', fan: 5, temp: 40, hours: 1, minutes: 0 }] }]));
    assert.deepEqual(plain(parsed.schedules), [{ name: 'Old', start: '07:05', steps: [step(Mode.COOL, 5, 40, 1, 0)] }]);
    assert.equal(parsed.deviceSlots, null);
});

test('backup: garbage and other files are refused with a message', () => {
    const refuses = (text, pattern) => assert.throws(() => P.parseBackup(text), e => pattern.test(e.message), text);
    refuses('{oops', /not valid JSON/);
    refuses('"hello"', /not a JetCommand backup/);
    refuses('null', /not a JetCommand backup/);
    refuses(JSON.stringify({ schedules: [] }), /not a JetCommand backup/);
    refuses(JSON.stringify({ app: 'jetcommand', kind: 'shutdowns', format: 1, schedules: [] }), /“shutdowns”, not schedules/);
    refuses(JSON.stringify({ app: 'jetcommand', kind: 'schedules', format: 2, schedules: [] }), /newer JetCommand/);
    refuses(JSON.stringify({ app: 'jetcommand', kind: 'schedules', format: 1 }), /no list of schedules/);
    refuses(JSON.stringify({ app: 'jetcommand', kind: 'schedules', format: 1, schedules: [] }), /holds no schedules/);
    refuses(JSON.stringify([{ name: 'x' }]), /Schedule 1 has no list of steps/);
    refuses(JSON.stringify([{ name: 'x', steps: [{ mode: 4, fan: 'lots', temp: 40, hours: 1, minutes: 0 }] }]), /Schedule 1, step 1: fan is not a number/);
    refuses(JSON.stringify([{ name: 'x', steps: [{ mode: 4, fan: null, temp: 40, hours: 1, minutes: 0 }] }]), /fan is not a number/);
});

test('backup: empty schedules are counted, long names cut and counted', () => {
    const parsed = P.parseBackup(JSON.stringify([
        { name: 'Nothing', steps: [] },
        { name: 'A name that is far too long', steps: [step(Mode.COOL, 5, 40, 1, 0)] },
    ]));
    assert.equal(parsed.empty, 1);
    assert.equal(parsed.shortened, 1);
    assert.deepEqual(plain(parsed.schedules.map(s => s.name)), ['A name that is ']);
});

test('backup: merge skips duplicates, renames clashes within 15 chars, never touches existing entries', () => {
    const existing = library();
    const before = plain(existing);
    const incoming = [
        { name: 'Cool drift', steps: library()[0].steps, start: null },
        { name: 'Cool drift', steps: [step(Mode.COOL, 3, 40, 2, 0)], start: null },
        { name: 'New one', steps: [step(Mode.HEAT, 5, 60, 1, 0)], start: '23:00' },
    ];
    const m = P.mergeSchedules(existing, incoming);
    assert.deepEqual(plain(existing), before, 'existing list untouched');
    assert.deepEqual(plain(m.library.slice(0, 2)), before, 'existing entries kept first, unchanged');
    assert.deepEqual(plain(m.skipped), ['Cool drift']);
    assert.deepEqual(plain(m.added.map(s => s.name)), ['Cool drift 2', 'New one']);
    assert.deepEqual(plain(m.renamed), [{ from: 'Cool drift', to: 'Cool drift 2' }]);
    assert.equal(m.added[1].start, '23:00');
    assert.equal(new Set(m.library.map(s => s.id)).size, m.library.length, 'fresh ids');

    // The same file again: everything is a duplicate, including the renamed copy.
    const again = P.mergeSchedules(m.library, incoming);
    assert.equal(again.added.length, 0);
    assert.equal(again.skipped.length, 3);

    // A full 15-character name gives up its tail for the suffix.
    const long = 'Neutral <26 +WC';
    const clash = P.mergeSchedules([{ id: 'x', name: long, steps: [step(Mode.COOL, 5, 40, 1, 0)] }, { id: 'y', name: 'Neutral <26 + 2', steps: [step(Mode.COOL, 6, 40, 1, 0)] }],
        [{ name: long, steps: [step(Mode.COOL, 9, 40, 1, 0)] }]);
    assert.equal(clash.added[0].name, 'Neutral <26 + 3');
    for (const s of clash.library) assert.ok(s.name.length <= 15 && PC.sanitizeName(s.name) === s.name, s.name);
});

test('backup: a program the unit would refuse is imported unchanged and flagged', () => {
    const bad = [{ name: 'Too hot', steps: [step(Mode.HEAT, 19, 80, 6, 0), step(Mode.COOL, 5, 120, 1, 0)] }];
    const parsed = P.parseBackup(JSON.stringify(bad));
    assert.deepEqual(plain(parsed.schedules[0].steps), bad[0].steps, 'no clamping on import');
    const m = P.mergeSchedules([], parsed.schedules);
    assert.equal(m.added.length, 1);
    const errors = PC.validateProgram(m.added[0].steps, at(22, 30));
    assert.deepEqual(plain(errors.map(e => e.index)), [0, 1]);
    // And it survives the library's own load, which used to cut programs over 32 steps.
    const long = Array.from({ length: 33 }, () => step(Mode.COOL, 5, 40, 0, 10));
    const stored = P.parseLibrary(JSON.stringify([{ id: 'l', name: 'Long', steps: long }]));
    assert.equal(stored[0].steps.length, 33);
    assert.ok(PC.validateProgram(stored[0].steps, at(22, 30)).some(e => e.index === -1));
});

test('backup: device slots are parsed with empty slots kept as null', () => {
    const file = P.buildBackup([], { deviceSlots: [null, { name: '', steps: [step(Mode.COOL, 5, 40, 1, 0)] }, { name: 'Empty', steps: [] }] });
    const parsed = P.parseBackup(JSON.stringify(file));
    assert.deepEqual(parsed.schedules.length, 0, 'slots alone are enough to import');
    assert.deepEqual(plain(parsed.deviceSlots), [null, { name: '', steps: [step(Mode.COOL, 5, 40, 1, 0)] }, null]);
    assert.throws(() => P.parseBackup(JSON.stringify({ ...file, deviceSlots: [null, null, null, null] })), /not readable/);
    assert.throws(() => P.parseBackup(JSON.stringify({ ...file, deviceSlots: [null, null, null] })), /holds no schedules/);
});
