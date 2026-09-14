// ---------------------------------------------------------------------------
// Input
//
// The console has two controller ports and eight switches in each. Everything
// above this file is about turning whatever the players are holding into those
// sixteen booleans, and this file is where the sources are merged.
//
// There are two sources, the keyboard and the gamepads, and more than one of
// each can be holding the same switch:
//
//   Two sources can hold the same switch at once. If each source called
//   setButton directly, letting go of a key would also let go of the button a
//   pad is still pressing, and it would only misbehave for somebody using
//   both at once -- which is nobody, until it is somebody.
//
// So each source reports its own state into the manager, the manager keeps the
// OR per (port, switch), and the console hears only the combined result, and
// only when it changes.
//
// Which port a source's switches go to is the source's business, not the
// manager's. The keyboard asks its binding map (bindings.ts); a pad asks its
// assignment. The manager only ever hears "port 1, A, down".
//
// Why `event.code` and not `event.key`
// ------------------------------------
// `code` names the physical key; `key` names the character it would produce.
// The front end is deciding where a key *is*, not what it says, so a player on
// an AZERTY keyboard keeps Z and X under the same two fingers as everybody
// else. This is the same reason a native front end binds virtual key codes
// rather than characters: it is the position that is being mapped, not the
// letter.
// ---------------------------------------------------------------------------

import type { GamepadButtonName } from '../shared/api';
import type { ResolvedBinding } from './bindings';

/**
 * The eight switches. The names are the contract with the C enum in
 * src/ffi/emulator_api.h; the numbers behind them live there and in
 * wasm/emulator.mjs's `Button`.
 */
export type ButtonName = GamepadButtonName;

/**
 * Where a switch's state came from.
 *
 * A pad is named individually -- `pad:0`, `pad:1` -- rather than all pads
 * sharing one source. The manager releases a source on its own, and two pads
 * are two things that can be unplugged independently: player 2's button must
 * not be dropped because player 1's controller ran out of battery.
 */
export type InputSource = 'keyboard' | `pad:${number}`;

/** The source name for one pad. */
export function padSource(index: number): InputSource {
    return `pad:${index}`;
}

/** One key on the keyboard, and where it goes. See bindings.ts. */
export type KeyMap = ReadonlyMap<string, ResolvedBinding>;

/** Keys that do something other than press a switch. */
export type CommandName =
    | 'pause'
    | 'reset'
    | 'screenshot'
    | 'screenshot-cover'
    | 'save1' | 'save2' | 'save3'
    | 'load1' | 'load2' | 'load3'
    | 'quicksave' | 'quickload';

export const KEY_COMMANDS: Readonly<Record<string, CommandName>> = Object.freeze({
    // Escape and P both pause. Escape is what everybody reaches for; P is what
    // everybody's hands already know.
    Escape: 'pause',
    KeyP: 'pause',

    KeyR: 'reset',

    // F12 is what every emulator has used for a screenshot since DOSBox, and
    // the screenshots section is where they end up.
    F12: 'screenshot',

    F1: 'save1',
    F2: 'save2',
    F3: 'save3',

    F5: 'quicksave',
    F6: 'quickload',
});

/**
 * Commands whose meaning is "while the key is down" rather than "when it goes
 * down".
 *
 * Rewinding is the only one. It cannot be a toggle: holding the key has to walk
 * backwards through the snapshots at a steady rate, and letting go has to stop
 * exactly where it is. That needs to know about the release, which the
 * one-shot commands above never do.
 */
export type HeldCommandName = 'rewind';

export const HELD_KEY_COMMANDS: Readonly<Record<string, HeldCommandName>> = Object.freeze({
    Backspace: 'rewind',
});

/**
 * The same keys with Shift held mean the other direction.
 *
 * F1 saves and Shift+F1 loads, which is what every emulator has done since the
 * DOS ones and what hands already expect.
 */
export const KEY_COMMANDS_SHIFTED: Readonly<Record<string, CommandName>> = Object.freeze({
    F1: 'load1',
    F2: 'load2',
    F3: 'load3',

    // Shift+F12 takes a screenshot *and* puts it on the game's card, which is
    // the difference between keeping a picture and replacing the one people
    // see.
    F12: 'screenshot-cover',
});

/**
 * The single place that decides what the sixteen switches are doing.
 *
 * `apply` is called with the combined state of one (port, switch), and only
 * when it changes, so the emulator is never told the same thing twice and never
 * told something that one source contradicts.
 */
export class InputManager {
    /** Keyed by `${port}:${button}`, so the port is part of the identity. */
    readonly #held = new Map<string, Set<InputSource>>();
    readonly #apply: (port: number, button: ButtonName, pressed: boolean) => void;

    constructor(apply: (port: number, button: ButtonName, pressed: boolean) => void) {
        this.#apply = apply;
    }

    /** Press or release one switch on one port, for one source. */
    set(port: number, button: ButtonName, pressed: boolean, from: InputSource): void {
        const key = `${port}:${button}`;
        const sources = this.#held.get(key) ?? new Set<InputSource>();
        const wasDown = sources.size > 0;

        if (pressed) {
            sources.add(from);
        } else {
            sources.delete(from);
        }

        const isDown = sources.size > 0;
        if (isDown) {
            this.#held.set(key, sources);
        } else {
            this.#held.delete(key);
        }

        // Only when the *combined* state changed. A source letting go of a
        // button it was never holding -- a gamepad-only button during a
        // keyboard focus loss, say -- must not be reported to the console as
        // a press, and a key repeating while held must not be reported at
        // all. Comparing against the previous combined state is what makes
        // both of those fall out for free, instead of being special cases
        // somebody has to remember.
        if (isDown !== wasDown) {
            this.#apply(port, button, isDown);
        }
    }

    /**
     * Let go of everything one source was holding, and leave the other
     * sources alone. Losing keyboard focus must not drop a gamepad button:
     * the player is still holding the pad.
     */
    releaseAll(from: InputSource): void {
        // Copy the keys first. `set` mutates the map, and a Map cannot be
        // iterated while it is being changed.
        for (const key of [...this.#held.keys()]) {
            const [port, button] = split(key);
            this.set(port, button, false, from);
        }
    }

    /** Let go of everything on every source and both ports. */
    releaseEverything(): void {
        this.#held.clear();
    }

    /**
     * What is down right now, across both ports.
     *
     * The union, without saying who is holding it: the status line is a
     * diagnostic and "A LEFT" is more readable than "1P A, 2P LEFT". The
     * settings screen is where the per-port detail belongs, and it reads the
     * assignments rather than the live state.
     */
    get held(): ButtonName[] {
        const seen = new Set<ButtonName>();
        for (const key of this.#held.keys()) {
            seen.add(split(key)[1]);
        }
        return [...seen];
    }

    /** What is down on one port, for a per-player display. */
    heldOn(port: number): ButtonName[] {
        const seen = new Set<ButtonName>();
        for (const key of this.#held.keys()) {
            const [keyPort, button] = split(key);
            if (keyPort === port) {
                seen.add(button);
            }
        }
        return [...seen];
    }
}

/** Split a `${port}:${button}` map key back into its two halves. */
function split(key: string): [number, ButtonName] {
    const colon = key.indexOf(':');
    return [Number(key.slice(0, colon)), key.slice(colon + 1) as ButtonName];
}

export interface KeyboardHandlers {
    /**
     * The key map in force, read afresh for every event.
     *
     * A function rather than a map so that rebinding takes effect immediately:
     * the listeners are installed once, at mount, and the player may change
     * the bindings an hour later.
     */
    bindings: () => KeyMap;
    /** A key that does something once, when it goes down. */
    onCommand?: (command: CommandName) => void;
    /** A key that does something for as long as it is held. */
    onCommandState?: (command: HeldCommandName, held: boolean) => void;
}

/**
 * Listen for keys, for as long as the returned function is not called.
 *
 * Nothing in here has a repeat rate, a debounce, or a turbo mode. The hardware
 * has none of those, and a front end that invents them is a front end that
 * makes one game feel wrong to fix another.
 */
export function attachKeyboard(manager: InputManager, handlers: KeyboardHandlers): () => void {
    // Which held commands are down, so that the browser repeating a held key --
    // which it does thirty times a second -- is reported once rather than
    // thirty times.
    const heldCommands = new Set<HeldCommandName>();

    // Which binding each held key went down with. Kept so that a keyup
    // releases exactly the switch its keydown pressed: the player may change
    // the keyboard mode, or rebind the key, while it is still down -- and
    // resolving the keyup against the *new* map would leave the old port's
    // switch held forever.
    const pressed = new Map<string, ResolvedBinding>();

    /**
     * Whether the key event belongs to a text field rather than the console.
     *
     * The library has a search box, and typing "wasd" into it must search for
     * those letters, not walk Mario left. Without this the listener would
     * swallow the keystroke -- `preventDefault` and all -- and the player
     * could not type the name of a game. Every other element in the page is a
     * button or a label, where the game bindings are still what is wanted.
     */
    const isTyping = (target: EventTarget | null): boolean => {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        return target.isContentEditable
            || target.tagName === 'INPUT'
            || target.tagName === 'TEXTAREA'
            || target.tagName === 'SELECT';
    };

    const bindingFor = (event: KeyboardEvent): ResolvedBinding | undefined =>
        handlers.bindings().get(event.code);

    const onKeyDown = (event: KeyboardEvent): void => {
        if (isTyping(event.target)) {
            return;
        }

        // Commands first, so a rebinding cannot take Escape or a function key
        // away from the application. The two lists are kept disjoint by the
        // settings screen anyway; this is the second lock on the same door.
        const held = HELD_KEY_COMMANDS[event.code];
        if (held !== undefined) {
            event.preventDefault();
            if (!heldCommands.has(held)) {
                heldCommands.add(held);
                handlers.onCommandState?.(held, true);
            }
            return;
        }

        const command = (event.shiftKey ? KEY_COMMANDS_SHIFTED[event.code] : undefined)
            ?? KEY_COMMANDS[event.code];
        if (command !== undefined) {
            event.preventDefault();
            handlers.onCommand?.(command);
            return;
        }

        const binding = bindingFor(event);
        if (binding !== undefined) {
            // Space and the arrows do things to a web page -- scrolling it --
            // and a game screen must not scroll.
            event.preventDefault();
            pressed.set(event.code, binding);
            manager.set(binding.port, binding.button, true, 'keyboard');
        }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
        if (isTyping(event.target)) {
            return;
        }

        const held = HELD_KEY_COMMANDS[event.code];
        if (held !== undefined) {
            event.preventDefault();
            if (heldCommands.delete(held)) {
                handlers.onCommandState?.(held, false);
            }
            return;
        }

        // The binding it went down with, not the one in force now. See the
        // note on `pressed` above.
        const binding = pressed.get(event.code);
        if (binding !== undefined) {
            event.preventDefault();
            pressed.delete(event.code);
            manager.set(binding.port, binding.button, false, 'keyboard');
        }
    };

    // The important one. Without this, a key held while the player switches to
    // another application stays held forever: the keyup goes to whatever has
    // focus now, and the game keeps running with the d-pad stuck down.
    //
    // Only the keyboard is released. A gamepad is a different source and the
    // player may still be holding it.
    const onBlur = (): void => {
        pressed.clear();
        manager.releaseAll('keyboard');

        // And anything that was being held down. Losing focus mid rewind would
        // otherwise leave the machine walking backwards forever.
        for (const command of heldCommands) {
            handlers.onCommandState?.(command, false);
        }
        heldCommands.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        manager.releaseAll('keyboard');
    };
}
