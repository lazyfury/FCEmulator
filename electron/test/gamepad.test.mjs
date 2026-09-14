// ---------------------------------------------------------------------------
// The gamepad mapping.
//
// Reading a pad cannot be tested here: `navigator.getGamepads()` does not exist
// in Node, and on macOS calling it starts a service that makes the application
// impossible to quit (see FcBridge.gamepadEnabled). The mapping is the part
// with decisions in it, and it is a plain function for exactly that reason.
//
//   pnpm test
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapPad, PAD_INDICES } from '../src/renderer/gamepad.ts';
import { InputManager } from '../src/renderer/input.ts';
import {
    EMPTY_READING,
    GAMEPAD_BUTTONS,
    gamepadBinaryPath,
    parseGamepadLine,
    sameReading,
} from '../src/main/gamepad.ts';
import { NO_GAMEPAD_READING } from '../src/shared/api.ts';

/** A pad with nothing pressed. */
function pad({ buttons = {}, axes = [0, 0] } = {}) {
    const list = Array.from({ length: 16 }, () => ({ pressed: false }));
    for (const [index, on] of Object.entries(buttons)) {
        list[Number(index)] = { pressed: on };
    }
    return { buttons: list, axes };
}

function down(result) {
    return Object.entries(result).filter(([, on]) => on).map(([name]) => name).sort();
}

test('nothing pressed means nothing down', () => {
    assert.deepEqual(down(mapPad(pad())), []);
});

test('the d-pad is buttons 12 to 15', () => {
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.LEFT]: true } }))), ['LEFT']);
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.RIGHT]: true } }))), ['RIGHT']);
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.UP]: true } }))), ['UP']);
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.DOWN]: true } }))), ['DOWN']);
});

test('the face buttons land on A and B, not on each other', () => {
    // Index 0 is the bottom button on a modern pad, where the letter A is
    // printed; index 1 is the right hand one. Getting these the wrong way
    // round is the classic gamepad bug, and it is invisible until somebody
    // tries to jump and shoots instead.
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.A]: true } }))), ['A']);
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.B]: true } }))), ['B']);
});

test('start and select are where the spec says', () => {
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.START]: true } }))), ['START']);
    assert.deepEqual(down(mapPad(pad({ buttons: { [PAD_INDICES.SELECT]: true } }))), ['SELECT']);
});

test('the stick duplicates the d-pad', () => {
    assert.deepEqual(down(mapPad(pad({ axes: [-1, 0] }))), ['LEFT']);
    assert.deepEqual(down(mapPad(pad({ axes: [1, 0] }))), ['RIGHT']);
    // Axis 1 is positive downwards.
    assert.deepEqual(down(mapPad(pad({ axes: [0, 1] }))), ['DOWN']);
    assert.deepEqual(down(mapPad(pad({ axes: [0, -1] }))), ['UP']);
});

test('a stick at rest does not drift', () => {
    // A worn stick sits at 0.2 or so when nobody is touching it. Without a
    // deadzone the player walks into a wall and cannot work out why.
    assert.deepEqual(down(mapPad(pad({ axes: [0.2, -0.3] }))), []);
    assert.deepEqual(down(mapPad(pad({ axes: [0.49, 0] }))), []);
    assert.deepEqual(down(mapPad(pad({ axes: [0.51, 0] }))), ['RIGHT']);
});

test('buttons and a stick at once do not cancel', () => {
    // Left on the d-pad while the stick is pushed right must still be left.
    // The two are OR-ed, and OR-ing them the other way round would make the
    // stick win, which nobody expects.
    const result = mapPad(pad({ buttons: { [PAD_INDICES.LEFT]: true }, axes: [1, 0] }));
    assert.equal(result.LEFT, true);
    assert.equal(result.RIGHT, true);
});

test('a pad reports into the input manager once per change', () => {
    // The manager is what keeps a pad and a keyboard from clobbering each
    // other. This is the same pad read twice, which is what polling does
    // sixty times a second, and it must not produce sixty events.
    const calls = [];
    const manager = new InputManager((button, pressed) => calls.push([button, pressed]));

    const state = mapPad(pad({ buttons: { [PAD_INDICES.A]: true } }));
    for (const [button, on] of Object.entries(state)) {
        manager.set(button, on, 'gamepad');
    }
    for (const [button, on] of Object.entries(state)) {
        manager.set(button, on, 'gamepad');
    }

    assert.deepEqual(calls, [['A', true]]);
    assert.deepEqual(manager.held, ['A']);
});

// ---------------------------------------------------------------------------
// The native helper's protocol.
//
// This is the half of the native path that can be tested from Node: the
// helper's stdout is a pipe of JSON lines, and what to do with those lines is
// a plain function. Reading a real pad cannot be tested here -- that needs a
// pad and an operating system -- but the parser multiplying that reading can,
// and the cases that matter are the malformed ones.
//
//   pnpm test
// ---------------------------------------------------------------------------

test('the hello line is not a reading', () => {
    assert.equal(parseGamepadLine('{"pid":42,"type":"hello","version":1}'), null);
});

test('anything that is not JSON is dropped, not guessed at', () => {
    assert.equal(parseGamepadLine(''), null);
    assert.equal(parseGamepadLine('Swift runtime warning'), null);
    assert.equal(parseGamepadLine('{"type":"pad"oops}'), null);
    assert.equal(parseGamepadLine('null'), null);
    assert.equal(parseGamepadLine('[]'), null);
});

test('a pad line carries exactly the eight switches', () => {
    const reading = parseGamepadLine(JSON.stringify({
        type: 'pad',
        connected: true,
        id: 'Xbox Wireless Controller',
        buttons: { A: true, START: true },
    }));

    assert.equal(reading.connected, true);
    assert.equal(reading.id, 'Xbox Wireless Controller');
    assert.deepEqual(
        Object.keys(reading.buttons).sort(),
        [...GAMEPAD_BUTTONS].sort(),
    );
    assert.deepEqual(
        down(reading.buttons),
        ['A', 'START'],
    );
});

test('a button that is missing or not true is not pressed', () => {
    // The helper always writes all eight, but a reader that treats a missing
    // key as "pressed" is one that sticks a button down for the rest of the
    // session. Exact true, or nothing.
    const reading = parseGamepadLine(JSON.stringify({
        type: 'pad',
        connected: true,
        buttons: { A: 1, B: 'true', LEFT: null, RIGHT: false },
    }));
    assert.deepEqual(down(reading.buttons), []);
});

test('a disconnected pad is a reading, and an important one', () => {
    // It is how a pad that ran out of battery gets let go of. Dropping the
    // line would leave the jump button held forever.
    const reading = parseGamepadLine('{"type":"pad","connected":false}');
    assert.notEqual(reading, null);
    assert.equal(reading.connected, false);
    assert.deepEqual(down(reading.buttons), []);
});

test('a nameless pad is still a pad', () => {
    const reading = parseGamepadLine('{"type":"pad","connected":true}');
    assert.equal(reading.connected, true);
    assert.equal(reading.id, 'Gamepad');
});

test('the empty reading is one value, written twice', () => {
    // Written out in src/main/gamepad.ts because Node cannot resolve an
    // extensionless import of shared/api at run time. If the two ever drift,
    // the main process and the renderer would disagree about "nothing is
    // connected", so they are compared here rather than trusted.
    assert.deepEqual(EMPTY_READING, NO_GAMEPAD_READING);
});

test('sameReading notices a button, a name, and a connection', () => {
    const idle = parseGamepadLine('{"type":"pad","connected":true,"id":"pad A"}');
    assert.equal(sameReading(idle, idle), true);
    assert.equal(sameReading(idle, parseGamepadLine(
        '{"type":"pad","connected":true,"id":"pad A","buttons":{"A":true}}',
    )), false);
    assert.equal(sameReading(idle, parseGamepadLine(
        '{"type":"pad","connected":true,"id":"pad B"}',
    )), false);
    assert.equal(sameReading(idle, EMPTY_READING), false);
});

test('the helper binary is looked for where the build script puts it', () => {
    assert.equal(
        gamepadBinaryPath('/app'),
        '/app/native/bin/fc-gamepad',
    );
});
