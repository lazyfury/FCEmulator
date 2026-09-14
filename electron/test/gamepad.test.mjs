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
