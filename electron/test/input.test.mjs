// ---------------------------------------------------------------------------
// Tests for input.ts.
//
// These run in Node, with no Electron and no browser, because input.ts does
// not need either: it is a map and a small state machine. The parts that do
// need a window -- the event listeners -- are covered end to end by
// electron/verify.sh's input scenario.
//
//   pnpm test
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InputManager, KEY_BINDINGS, KEY_COMMANDS } from '../src/renderer/input.ts';

/** A manager that records everything it is told, so a test can see both what
 *  the console would hear and how many times it would hear it. */
function recording() {
    const calls = [];
    const manager = new InputManager((button, pressed) => calls.push([button, pressed]));
    return { manager, calls };
}

// -- the mapping ------------------------------------------------------------

test('the d-pad is on the arrows and on WASD', () => {
    assert.equal(KEY_BINDINGS.ArrowLeft, 'LEFT');
    assert.equal(KEY_BINDINGS.ArrowRight, 'RIGHT');
    assert.equal(KEY_BINDINGS.ArrowUp, 'UP');
    assert.equal(KEY_BINDINGS.ArrowDown, 'DOWN');

    assert.equal(KEY_BINDINGS.KeyA, 'LEFT');
    assert.equal(KEY_BINDINGS.KeyD, 'RIGHT');
    assert.equal(KEY_BINDINGS.KeyW, 'UP');
    assert.equal(KEY_BINDINGS.KeyS, 'DOWN');
});

test('Z and X are B and A, matching the physical pad', () => {
    // On a real controller B is the left face button and A the right one.
    assert.equal(KEY_BINDINGS.KeyZ, 'B');
    assert.equal(KEY_BINDINGS.KeyX, 'A');
    assert.equal(KEY_BINDINGS.KeyJ, 'B');
    assert.equal(KEY_BINDINGS.KeyK, 'A');
});

test('all eight buttons are reachable', () => {
    const reachable = new Set(Object.values(KEY_BINDINGS));
    for (const button of ['A', 'B', 'SELECT', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT']) {
        assert.ok(reachable.has(button), `${button} has no key`);
    }
});

test('no key is bound to two buttons', () => {
    // A Record cannot hold a duplicate key, so the danger is the reverse:
    // two different physical keys mapping to the same button is fine (Z and J
    // both mean B), but a key that appears in both maps is not.
    for (const code of Object.keys(KEY_BINDINGS)) {
        assert.ok(!(code in KEY_COMMANDS), `${code} is both a button and a command`);
    }
});

test('R resets and is not a button', () => {
    assert.equal(KEY_COMMANDS.KeyR, 'reset');
    assert.ok(!('KeyR' in KEY_BINDINGS));
});

// -- the manager ------------------------------------------------------------

test('a press reaches the console, and only once', () => {
    const { manager, calls } = recording();

    manager.set('A', true, 'keyboard');
    manager.set('A', true, 'keyboard');

    // The second press is the browser repeating a held key. The console has
    // eight switches, not a stream of events; telling it twice would be noise.
    assert.deepEqual(calls, [['A', true]]);
});

test('a release reaches the console once', () => {
    const { manager, calls } = recording();

    manager.set('A', true, 'keyboard');
    manager.set('A', false, 'keyboard');
    manager.set('A', false, 'keyboard');

    assert.deepEqual(calls, [['A', true], ['A', false]]);
});

test('two sources holding one button keep it held', () => {
    const { manager, calls } = recording();

    manager.set('A', true, 'keyboard');
    manager.set('A', true, 'gamepad');
    manager.set('A', false, 'keyboard');

    // The pad is still holding A, so the console must not be told it was
    // released. This is the whole reason the manager exists.
    assert.deepEqual(calls, [['A', true]]);
    assert.deepEqual(manager.held, ['A']);

    manager.set('A', false, 'gamepad');
    assert.deepEqual(calls, [['A', true], ['A', false]]);
});

test('losing focus releases the keyboard but not the gamepad', () => {
    const { manager, calls } = recording();

    manager.set('RIGHT', true, 'keyboard');
    manager.set('A', true, 'gamepad');

    manager.releaseAll('keyboard');

    // Right is let go; A is not. A player can alt-tab away with a pad still
    // in their hands, and the pad is still pressed.
    assert.deepEqual(calls, [['RIGHT', true], ['A', true], ['RIGHT', false]]);
    assert.deepEqual(manager.held, ['A']);
});

test('releasing a source that holds nothing says nothing', () => {
    const { manager, calls } = recording();

    manager.releaseAll('keyboard');

    assert.deepEqual(calls, []);
});

test('a button with no sources left is forgotten entirely', () => {
    const { manager } = recording();

    manager.set('B', true, 'keyboard');
    manager.set('B', false, 'keyboard');

    assert.deepEqual(manager.held, []);
});

test('releaseEverything clears without inventing releases', () => {
    const { manager, calls } = recording();

    manager.set('START', true, 'keyboard');
    manager.releaseEverything();

    // Used on shutdown, when the emulator is about to be destroyed and there
    // is nobody left to tell.
    assert.deepEqual(manager.held, []);
    assert.deepEqual(calls, [['START', true]]);
});
