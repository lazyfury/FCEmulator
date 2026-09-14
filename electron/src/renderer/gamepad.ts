// ---------------------------------------------------------------------------
// Gamepads, through the browser's Gamepad API.
//
// The JavaScript twin of frontend/Sources/Input.swift's GamepadInput, and the
// second source the InputManager was built for in M3. It reports into the same
// manager as the keyboard, so a button held on a pad is not released by
// letting go of a key.
//
// The one structural difference from the keyboard
// ----------------------------------------------
// The Gamepad API has no events for button changes. There is no "the A button
// went down" callback; there is a snapshot of where every control is right
// now, and it is your job to look. So this is polled once per animation frame,
// which is also why it lives next to the frame loop rather than next to the
// keyboard listeners.
//
// The one thing that *is* an event is connect and disconnect, and that matters
// more than it looks. A pad that runs out of battery mid jump must not leave
// the jump button held forever: there is nobody left to release it.
//
// Mapping
// -------
// The standard mapping is a browser guarantee -- `gamepad.mapping` says
// 'standard' when the browser recognises the device and has arranged the
// buttons the way the spec says. That layout is:
//
//   0 south (A on an Xbox pad)   8 back / select     12 d-pad up
//   1 east  (B)                  9 start             13 d-pad down
//   2 west  (X)                                      14 d-pad left
//   3 north (Y)                                      15 d-pad right
//
// A pad that is not standard gets the same indices anyway, which is a guess.
// It is a guess that costs nothing when it is wrong -- the buttons simply do
// something else -- and there is no better answer available from inside a
// browser.
// ---------------------------------------------------------------------------

import type { GamepadReading } from '../shared/api';
import type { ButtonName, InputManager } from './input';

/** How far the stick has to move before it counts as a direction. The same
 *  0.5 the Swift front end uses, for the same reason: a worn stick drifts, and
 *  a deadzone is cheaper than a new controller. */
const DEADZONE = 0.5;

/** The standard-mapping button indices this cares about. */
export const PAD_INDICES = {
    A: 0,
    B: 1,
    SELECT: 8,
    START: 9,
    UP: 12,
    DOWN: 13,
    LEFT: 14,
    RIGHT: 15,
} as const;

/** The parts of a Gamepad this looks at. A real one has far more. */
export interface PadState {
    buttons: readonly { pressed: boolean }[];
    axes: readonly number[];
}

/**
 * What the browser says about the pad, for the status line and the log.
 *
 * `mapping` is the one that matters when a pad "does not work": `'standard'`
 * means the browser recognised the device and arranged the buttons the way the
 * spec says, which is what the indices above assume. An empty string means it
 * did not, and every button below is a guess.
 */
export interface PadReport {
    connected: boolean;
    /** The browser's name for it. Empty when there is nothing connected. */
    id: string;
    mapping: string;
}

/** Nothing plugged in, which is where every session starts. */
export const NO_PAD: PadReport = { connected: false, id: '', mapping: '' };

/**
 * Which of the console's eight switches a pad has down.
 *
 * Pulled out of the polling and the manager so that it can be tested. Reading
 * a pad cannot be: `navigator.getGamepads()` exists in a browser and nowhere
 * else, and on macOS it has a side effect serious enough to have its own
 * paragraph in FcBridge.gamepadEnabled. The mapping is the part with decisions
 * in it, so the mapping is the part that is a plain function.
 */
export function mapPad(pad: PadState): Record<ButtonName, boolean> {
    const pressed = (index: number): boolean => pad.buttons[index]?.pressed ?? false;
    const axis = (index: number): number => pad.axes[index] ?? 0;

    // The stick duplicates the d-pad, because most people reach for it.
    // Axis 1 is positive downwards, which is why down is `>`.
    const stickX = axis(0);
    const stickY = axis(1);

    return {
        LEFT: pressed(PAD_INDICES.LEFT) || stickX < -DEADZONE,
        RIGHT: pressed(PAD_INDICES.RIGHT) || stickX > DEADZONE,
        UP: pressed(PAD_INDICES.UP) || stickY < -DEADZONE,
        DOWN: pressed(PAD_INDICES.DOWN) || stickY > DEADZONE,

        // A is the right hand face button on the console, and index 0 is the
        // bottom one on a modern pad -- which is where the letter A is printed
        // on the pads most people have.
        A: pressed(PAD_INDICES.A),
        B: pressed(PAD_INDICES.B),

        START: pressed(PAD_INDICES.START),
        SELECT: pressed(PAD_INDICES.SELECT),
    };
}

/**
 * How long to keep quiet before saying that nothing has turned up.
 *
 * Two seconds of polling at 60Hz. Chromium only reports a pad once it has been
 * used -- a pad that is plugged in and untouched sends nothing, which looks
 * exactly like a pad that does not work -- so the message that says so is worth
 * more than the silence it replaces.
 */
const QUIET_POLLS = 120;

/** Everything this class logs goes through here, so a reader can grep for
 *  one word and see the whole story. */
function say(...parts: unknown[]): void {
    console.log('gamepad:', ...parts);
}

export class GamepadSource {
    readonly #manager: InputManager;
    #report: PadReport = NO_PAD;
    /** What we last told the manager, so a change can be logged once. */
    readonly #held = new Set<string>();
    #polls = 0;
    #saidNothing = false;

    constructor(manager: InputManager) {
        this.#manager = manager;

        // A pad that was already plugged in sends no connect event when the
        // page loads, but polling finds it on the first frame regardless.
        // These two listeners are for the ones that come and go afterwards.
        window.addEventListener('gamepadconnected', this.#onConnected);
        window.addEventListener('gamepaddisconnected', this.#onDisconnected);
    }

    /** What the browser last said, for the status line. */
    get report(): PadReport {
        return this.#report;
    }

    /** Call once per animation frame. */
    poll(): void {
        this.#polls += 1;
        const pads = navigator.getGamepads();

        // Player one is the first pad that is actually there. The console has
        // two ports and the core supports both; nothing in the box uses the
        // second one.
        let pad: Gamepad | null = null;
        for (const candidate of pads) {
            if (candidate !== null && candidate.connected) {
                pad = candidate;
                break;
            }
        }

        if (pad === null) {
            // Nothing connected. If something was, its buttons have to be let
            // go -- a pad that runs out of battery mid jump must not leave the
            // jump button held forever, because there is nobody left to
            // release it.
            if (this.#report.connected) {
                say(`disconnected  ${this.#report.id}`);
                this.#manager.releaseAll('gamepad');
                this.#held.clear();
                this.#report = NO_PAD;
            }
            this.#sayNothingYet();
            return;
        }

        if (!this.#report.connected || this.#report.id !== pad.id) {
            this.#describe(pad);
        }

        this.#apply(pad);
    }

    destroy(): void {
        window.removeEventListener('gamepadconnected', this.#onConnected);
        window.removeEventListener('gamepaddisconnected', this.#onDisconnected);
        this.#manager.releaseAll('gamepad');
        this.#held.clear();
        this.#report = NO_PAD;
    }

    readonly #onConnected = (): void => {
        // Nothing to do: poll() picks it up on the next frame.
    };

    readonly #onDisconnected = (): void => {
        this.#manager.releaseAll('gamepad');
        this.#held.clear();
        this.#report = NO_PAD;
    };

    /**
     * One line explaining what the browser handed over, once per pad.
     *
     * This is the line to look at when a pad does nothing: if it never
     * appears, the browser is not reporting a pad at all and nothing below
     * this point is even being reached.
     */
    #describe(pad: Gamepad): void {
        this.#report = { connected: true, id: pad.id, mapping: pad.mapping };
        say(
            `connected     "${pad.id}"`,
            `mapping=${pad.mapping === '' ? '(none)' : pad.mapping}`,
            `buttons=${pad.buttons.length}`,
            `axes=${pad.axes.length}`,
        );
        if (pad.mapping !== 'standard') {
            say('              not the standard mapping: the button indices are a guess');
        }
    }

    /** The one-off note that two seconds have gone by with nothing there. */
    #sayNothingYet(): void {
        if (this.#saidNothing || this.#polls < QUIET_POLLS) {
            return;
        }
        this.#saidNothing = true;
        say('no pad after two seconds. In the order worth checking:');
        say('  1. the window has to be focused. The Gamepad API only exposes pads to');
        say('     the focused document, so a pad nobody is looking at is invisible --');
        say('     click the game window, then press a button.');
        say('  2. Chromium only lists a gamepad once it has been used. Press a button');
        say('     or move a stick on the pad itself.');
        say('  3. macOS may be withholding the device. System Settings → Privacy &');
        say('     Security → Input Monitoring, tick Electron (or this application),');
        say('     then quit and start it again -- macOS reads that list at launch.');
    }

    #apply(pad: Gamepad): void {
        const wanted = mapPad(pad);
        for (const [button, on] of Object.entries(wanted)) {
            // The index as well as the name: if the mapping was not standard,
            // the name is this build's guess and the index is the fact.
            const index = PAD_INDICES[button as ButtonName];
            const was = this.#held.has(button);
            if (on !== was) {
                if (on) {
                    this.#held.add(button);
                } else {
                    this.#held.delete(button);
                }
                say(`${on ? 'down' : 'up  '}          ${button} (index ${index})`);
            }
            this.#manager.set(button as ButtonName, on, 'gamepad');
        }
    }
}

// ---------------------------------------------------------------------------
// The native helper, from the renderer's side
//
// Same job as `GamepadSource` and the same destination -- one InputManager
// shared with the keyboard -- but fed the other way round. The browser source
// is polled: the Gamepad API has no change events, so every animation frame
// asks "where is everything now". The native helper already does that polling
// in its own process and only speaks when something changes, so here the
// renderer sits and waits to be told.
//
// That difference is the entire reason `gamepadNative` exists on the bridge.
// A source that is polled and a source that is pushed need different code, and
// pretending otherwise would mean polling an IPC channel sixty times a second
// to hear what we were already told.
// ---------------------------------------------------------------------------

/** The eight names, so a reading can be walked without trusting its key order. */
const NATIVE_BUTTONS: readonly ButtonName[] = [
    'A', 'B', 'SELECT', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT',
];

/**
 * A gamepad source, whichever kind. Both classes satisfy this by shape.
 *
 * `poll()` exists on the native source too, and does nothing: the frame loop
 * calls it unconditionally, and a push-driven source has nothing to ask for.
 */
export interface GamepadInput {
    readonly report: PadReport;
    poll(): void;
    destroy(): void;
}

export class NativeGamepadSource implements GamepadInput {
    readonly #manager: InputManager;
    #report: PadReport = NO_PAD;
    /** What we last told the manager, so a change can be logged once. */
    readonly #held = new Set<ButtonName>();

    constructor(manager: InputManager) {
        this.#manager = manager;

        // Ask first, then listen. The helper may already have a reading from
        // before this page existed -- a pad that was connected while the
        // window was loading -- and a change-only push would never repeat it.
        // The two can race, which is harmless: #apply is idempotent, and the
        // same reading twice costs nothing (see InputManager.set, which only
        // reports a change when the *combined* state changes).
        window.fc.onGamepadState((reading: GamepadReading) => this.#apply(reading));
        void window.fc.getGamepadState()
            .then((reading: GamepadReading) => this.#apply(reading))
            .catch(() => undefined);
    }

    get report(): PadReport {
        return this.#report;
    }

    /** Nothing to ask for. The helper speaks first. */
    poll(): void {
        // Deliberately empty.
    }

    destroy(): void {
        window.fc.offGamepadState();
        this.#release();
        this.#report = NO_PAD;
    }

    /** Let go of every switch this source is holding, and only this source. */
    #release(): void {
        this.#manager.releaseAll('gamepad');
        this.#held.clear();
    }

    #apply(reading: GamepadReading): void {
        if (!reading.connected) {
            // A pad that ran out of battery mid jump must not leave the jump
            // button held. There is nobody left to release it, so it is
            // released here, once, when the disconnection is heard.
            if (this.#report.connected) {
                say(`disconnected  ${this.#report.id}`);
                this.#release();
                this.#report = NO_PAD;
            }
            return;
        }

        if (!this.#report.connected || this.#report.id !== reading.id) {
            this.#report = { connected: true, id: reading.id, mapping: 'native' };
            say(`connected     "${reading.id}" (native, GameController)`);
        }

        for (const button of NATIVE_BUTTONS) {
            const on = reading.buttons[button] === true;
            const was = this.#held.has(button);
            if (on !== was) {
                if (on) {
                    this.#held.add(button);
                } else {
                    this.#held.delete(button);
                }
                say(`${on ? 'down' : 'up  '}          ${button}`);
            }
            this.#manager.set(button, on, 'gamepad');
        }
    }
}
