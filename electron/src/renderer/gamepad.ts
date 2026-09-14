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

export class GamepadSource {
    readonly #manager: InputManager;
    #hadPad = false;
    #warnedAboutMapping = false;

    constructor(manager: InputManager) {
        this.#manager = manager;

        // A pad that was already plugged in sends no connect event when the
        // page loads, but polling finds it on the first frame regardless.
        // These two listeners are for the ones that come and go afterwards.
        window.addEventListener('gamepadconnected', this.#onConnected);
        window.addEventListener('gamepaddisconnected', this.#onDisconnected);
    }

    /** Call once per animation frame. */
    poll(): void {
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
            // go -- see the note about batteries above -- and if nothing was,
            // there is nothing to do.
            if (this.#hadPad) {
                this.#manager.releaseAll('gamepad');
                this.#hadPad = false;
            }
            return;
        }

        this.#hadPad = true;
        this.#apply(pad);
    }

    destroy(): void {
        window.removeEventListener('gamepadconnected', this.#onConnected);
        window.removeEventListener('gamepaddisconnected', this.#onDisconnected);
        this.#manager.releaseAll('gamepad');
        this.#hadPad = false;
    }

    readonly #onConnected = (): void => {
        // Nothing to do: poll() picks it up on the next frame.
    };

    readonly #onDisconnected = (): void => {
        this.#manager.releaseAll('gamepad');
        this.#hadPad = false;
    };

    #apply(pad: Gamepad): void {
        if (!this.#warnedAboutMapping && pad.mapping !== 'standard') {
            // Once, not once a frame.
            console.warn(
                `gamepad "${pad.id}" is not in the standard mapping; `
                + 'its buttons may not be where this expects them',
            );
            this.#warnedAboutMapping = true;
        }

        const wanted = mapPad(pad);
        for (const [button, on] of Object.entries(wanted)) {
            this.#manager.set(button as ButtonName, on, 'gamepad');
        }
    }
}
