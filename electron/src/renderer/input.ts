// ---------------------------------------------------------------------------
// Input
//
// The NES controller is eight switches, not eight events.
//
// Everything above this file is about turning whatever the player is holding
// into those eight booleans, and this file is where the sources are merged.
// There is one source today, the keyboard; a gamepad will be the second, and
// the merging is written now because retrofitting it later is the bug:
//
//   Two sources can hold the same switch at once. If each source called
//   setButton directly, letting go of a key would also let go of the button a
//   pad is still pressing, and it would only misbehave for somebody using
//   both at once -- which is nobody, until it is somebody.
//
// So each source reports its own state into the manager, the manager keeps the
// OR, and the console hears only the combined result, and only when it
// changes.
//
// Why `event.code` and not `event.key`
// ------------------------------------
// `code` names the physical key; `key` names the character it would produce.
// The front end is deciding where a key *is*, not what it says, so a player on
// an AZERTY keyboard keeps Z and X under the same two fingers as everybody
// else. This is the same reason the Swift front end binds macOS virtual key
// codes rather than characters.
// ---------------------------------------------------------------------------

/**
 * The eight switches. The names are the contract with the C enum in
 * src/ffi/emulator_api.h; the numbers behind them live there and in
 * wasm/emulator.mjs's `Button`.
 */
export type ButtonName = 'A' | 'B' | 'SELECT' | 'START' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** Where a switch's state came from. */
export type InputSource = 'keyboard' | 'gamepad';

/**
 * Keyboard to button.
 *
 * Two full sets, because there is no single answer to "which key is A". The
 * arrows and WASD are both there so a left hand can sit on WASD while the
 * right is on J/K; Z/X mirrors the pad (left button on the left) and J/K is
 * where the right hand already is.
 */
export const KEY_BINDINGS: Readonly<Record<string, ButtonName>> = Object.freeze({
    // d-pad, arrows
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
    ArrowDown: 'DOWN',
    ArrowUp: 'UP',

    // d-pad, WASD
    KeyA: 'LEFT',
    KeyD: 'RIGHT',
    KeyS: 'DOWN',
    KeyW: 'UP',

    // B is the left face button and A the right one, as on a real pad
    KeyZ: 'B',
    KeyJ: 'B',
    KeyX: 'A',
    KeyK: 'A',

    // Start and Select
    Enter: 'START',
    Space: 'START',
    Tab: 'SELECT',
    ShiftRight: 'SELECT',
});

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
    // the screenshots section is where they end up. Nothing else on the
    // keyboard was free: every letter is a button, a save slot, or both.
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
 * DOS ones and what hands already expect. Note that Shift is also bound to
 * Select: pressing Shift affects both, and that is fine, because a game reading
 * Select at the moment somebody saves is a game that was going to do something
 * odd anyway.
 */
export const KEY_COMMANDS_SHIFTED: Readonly<Record<string, CommandName>> = Object.freeze({
    F1: 'load1',
    F2: 'load2',
    F3: 'load3',

    // Shift+F12 takes a screenshot *and* puts it on the game's card, which is
    // the difference between keeping a picture and replacing the one people
    // see. It is Shift rather than a third key because the pattern is already
    // here: F1 saves and Shift+F1 loads.
    //
    // Shift is also Select, but only the *right* Shift is bound to it (see
    // KEY_BINDINGS), so a left-handed Shift+F12 does not press anything on
    // the console.
    F12: 'screenshot-cover',
});

/**
 * The single place that decides what the eight buttons are doing.
 *
 * `apply` is called with the combined state, and only when it changes, so the
 * emulator is never told the same thing twice and never told something that
 * one source contradicts.
 */
export class InputManager {
    readonly #held = new Map<ButtonName, Set<InputSource>>();
    readonly #apply: (button: ButtonName, pressed: boolean) => void;

    constructor(apply: (button: ButtonName, pressed: boolean) => void) {
        this.#apply = apply;
    }

    /** Press or release one button for one source. */
    set(button: ButtonName, pressed: boolean, from: InputSource): void {
        const sources = this.#held.get(button) ?? new Set<InputSource>();
        const wasDown = sources.size > 0;

        if (pressed) {
            sources.add(from);
        } else {
            sources.delete(from);
        }

        const isDown = sources.size > 0;
        if (isDown) {
            this.#held.set(button, sources);
        } else {
            this.#held.delete(button);
        }

        // Only when the *combined* state changed. A source letting go of a
        // button it was never holding -- a gamepad-only button during a
        // keyboard focus loss, say -- must not be reported to the console as
        // a press, and a key repeating while held must not be reported at
        // all. Comparing against the previous combined state is what makes
        // both of those fall out for free, instead of being special cases
        // somebody has to remember.
        if (isDown !== wasDown) {
            this.#apply(button, isDown);
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
        for (const button of [...this.#held.keys()]) {
            this.set(button, false, from);
        }
    }

    /** Let go of everything on every source. */
    releaseEverything(): void {
        this.#held.clear();
    }

    /** What is down right now, for the status line. */
    get held(): ButtonName[] {
        return [...this.#held.keys()];
    }
}

export interface KeyboardHandlers {
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
export function attachKeyboard(manager: InputManager, handlers: KeyboardHandlers = {}): () => void {
    // Which held commands are down, so that the browser repeating a held key --
    // which it does thirty times a second -- is reported once rather than
    // thirty times.
    const heldCommands = new Set<HeldCommandName>();

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

    const onKeyDown = (event: KeyboardEvent): void => {
        if (isTyping(event.target)) {
            return;
        }

        const held = HELD_KEY_COMMANDS[event.code];
        if (held !== undefined) {
            event.preventDefault();
            if (!heldCommands.has(held)) {
                heldCommands.add(held);
                handlers.onCommandState?.(held, true);
            }
            return;
        }

        const button = KEY_BINDINGS[event.code];
        if (button !== undefined) {
            // Space and the arrows do things to a web page -- scrolling it --
            // and a game screen must not scroll.
            event.preventDefault();
            manager.set(button, true, 'keyboard');
            return;
        }

        const command = (event.shiftKey ? KEY_COMMANDS_SHIFTED[event.code] : undefined)
            ?? KEY_COMMANDS[event.code];
        if (command !== undefined) {
            event.preventDefault();
            handlers.onCommand?.(command);
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

        const button = KEY_BINDINGS[event.code];
        if (button !== undefined) {
            event.preventDefault();
            manager.set(button, false, 'keyboard');
        }
    };

    // The important one. Without this, a key held while the player switches to
    // another application stays held forever: the keyup goes to whatever has
    // focus now, and the game keeps running with the d-pad stuck down.
    //
    // Only the keyboard is released. A gamepad is a different source and the
    // player may still be holding it.
    const onBlur = (): void => {
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
