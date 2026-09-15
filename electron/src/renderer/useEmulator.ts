// ---------------------------------------------------------------------------
// The engine loop.
//
// Everything that has to happen once per frame, once per second, and once per
// lifetime lives here, so the component below it can be a canvas and nothing
// else.
//
// Who owns the clock
// ------------------
// The NES does not run at 60Hz. It runs at 60.0988, because the PPU's dot
// clock divides the NTSC colour burst that way, and that 0.16% is not noise:
// over ten minutes it is a whole second of drift, and the music will not line
// up with the picture.
//
// A display, on the other hand, refreshes at exactly 60.000Hz, and the only
// event a web page gets is requestAnimationFrame, which fires once per
// refresh. So the renderer cannot run "one frame per animation frame" -- that
// is the subtle bug the earlier frame-per-refresh loops shipped with, and it
// makes the game run 0.16% slow.
//
// What works instead is an accumulator. Keep the time the next emulated frame
// is *due*, and on every animation frame run however many frames have come
// due since last time -- usually one, occasionally two, sometimes none. The
// game then runs at the right speed, and the cost is that the picture judders
// by up to one frame, which is the correct trade.
//
// The alternative, running frames in a Web Worker on its own clock, is more
// accurate still and will be worth doing when audio needs it. It is not
// needed to draw a correct picture.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@wasm';
import { createCoreHost } from '@libretro';

import { AudioOutput } from './audio/output';
import { bootLog } from '../shared/boot';
import { DEFAULT_INPUT_SETTINGS, type Cheat, type InputSettings } from '../shared/api';
import { resolveBindings, padPort } from './bindings';
import { INITIAL_STATUS, unloaded, type EngineStatus } from './engineStatus';
import {
    GamepadSource, NativeGamepadSource, NO_PADS, samePads,
    type GamepadInput,
} from './gamepad';
import { attachKeyboard, InputManager, type ButtonName, type CommandName } from './input';
import { Rewind } from './rewind';

/** 60.0988 frames per second, the console's real rate. */
const NES_FRAME_SECONDS = 1 / 60.0988;

/**
 * How many frames one animation frame is allowed to catch up on.
 *
 * Without a cap, one long stall -- a breakpoint, a laptop waking up, a virus
 * scanner -- would leave the accumulator permanently behind, and the emulator
 * would spend the next minute running at double speed trying to catch up. Past
 * this many, the backlog is abandoned instead.
 */
const MAX_CATCHUP_FRAMES = 4;

/** How often the status line is refreshed. Sixty React renders a second to
 *  update a text field is waste, and it shows up as jitter. */
const STATUS_INTERVAL_MS = 250;

export interface EmulatorHandle {
    status: EngineStatus;
    /** Load a game by path. False if it could not be read or is not a ROM. */
    loadRom(path: string): Promise<boolean>;
    /** Take the cartridge out and stop running. */
    unload(): void;
    /**
     * The same commands the keyboard sends: pause, reset, screenshot, save
     * and load.
     *
     * The toolbar buttons are not a second implementation of any of them --
     * they go through the one command handler, so a button and F1 cannot
     * disagree about what "save" means.
     */
    command(command: CommandName): void;
    /** Write one byte into the console's memory, now. */
    poke(address: number, value: number): void;
    /** Read one byte of console or cartridge RAM, or null with no machine. */
    peek(address: number): number | null;
}

/** Things the loop has to report to somebody else. */
export interface EmulatorHandlers {
    /**
     * The cheats in force for the cartridge in the slot.
     *
     * Read from a ref rather than captured, for the same reason the input
     * settings are: the machine is built once and the list may change an hour
     * later, and rebuilding it to change a byte would power the console off.
     */
    cheats?: Cheat[];
    /**
     * The input settings in force: keyboard mode, bindings, pad assignments.
     *
     * Read at every key event and every frame rather than captured, so a
     * rebinding made in the settings screen takes effect without rebuilding
     * the listeners or the machine.
     */
    input?: InputSettings;
    /**
     * A PNG of the picture, when the player takes a screenshot.
     *
     * `asCover` is true for Shift+F12 and the 更新封面 button: the picture is
     * not only kept, it becomes the one on the game's card.
     *
     * Handed up as bytes rather than written here, because the canvas is in
     * this process and the disk is in the other one.
     */
    onScreenshot?: (png: Uint8Array, asCover: boolean) => void;
}

export function useEmulator(
    canvasRef: RefObject<HTMLCanvasElement | null>,
    handlers: EmulatorHandlers = {},
): EmulatorHandle {
    const [status, setStatus] = useState<EngineStatus>(INITIAL_STATUS);

    // Kept in a ref so that the effect below can be set up once. A caller
    // passing a new object every render -- which is what an inline object does
    // -- would otherwise tear down and rebuild the whole machine.
    const outward = useRef(handlers);
    useEffect(() => {
        outward.current = handlers;
    });

    // The two things a caller can ask for, held in a ref so that the functions
    // handed out never change identity. A component that put them in a
    // dependency array would otherwise reload the emulator on every render.
    const actions = useRef<{
        loadRom: (path: string) => Promise<boolean>;
        unload: () => void;
        command: (command: CommandName) => void;
        poke: (address: number, value: number) => void;
        peek: (address: number) => number | null;
        applyCheats: () => void;
    }>({
        loadRom: async () => false,
        unload: () => undefined,
        command: () => undefined,
        poke: () => undefined,
        peek: () => null,
        applyCheats: () => undefined,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }
        bootLog('renderer', 'emulator effect start');

        // alpha:false because every pixel is opaque and the compositor should
        // not have to blend the whole screen every frame.
        const context = canvas.getContext('2d', { alpha: false });
        if (context === null) {
            setStatus({ ...INITIAL_STATUS, state: 'error', error: 'the canvas has no 2d context' });
            return;
        }

        let disposed = false;
        let animationFrame = 0;
        let emulator: CoreHost | null = null;
        let detachKeyboard: (() => void) | null = null;
        let commandHandler: ((command: CommandName) => void) | null = null;
        let gamepad: GamepadInput | null = null;
        let rewind: Rewind | null = null;
        // The flash message's timeout lives out here because the cleanup has
        // to be able to cancel it.
        let flashTimer = 0;
        let audio: AudioOutput | null = null;
        let audioError: string | null = null;

        // Input does not depend on the machine, so it is set up here rather
        // than inside start(). The keyboard and the pad exist while the player
        // is still browsing the library, which is what lets the footer say
        // whether a pad is connected; presses made before a cartridge exists
        // are dropped by the null check in the apply callback below.
        //
        // `nextFrameTime` and `rewinding` are the two pieces of loop state the
        // keyboard touches, so they are declared out here too. The rest of the
        // loop state still lives in start().
        let nextFrameTime = performance.now() / 1000;
        let rewinding = false;
        let engineApply: ((port: number, button: ButtonName, pressed: boolean) => void) | null = null;

        // The settings in force, read afresh each time they are needed. The
        // listeners and the machine are built once; what a key does may change
        // an hour later.
        const inputSettings = (): InputSettings =>
            outward.current.input ?? DEFAULT_INPUT_SETTINGS;

        // One manager for every input source and both ports. The keyboard
        // reports into it, and so does every pad, and the console will only
        // ever see the combined state. See input.ts for why that indirection
        // is not optional.
        const manager = new InputManager((port, button, pressed) => {
            engineApply?.(port, button, pressed);
        });

        detachKeyboard = attachKeyboard(manager, {
            bindings: () => resolveBindings(inputSettings()),
            onCommand: (command) => commandHandler?.(command),
            onCommandState: (command, held) => {
                if (command === 'rewind') {
                    rewinding = held;
                    if (!held) {
                        // Coming out of a rewind, do not run a burst of frames
                        // to make up for the time it took.
                        nextFrameTime = performance.now() / 1000;
                    }
                }
            },
        });

        // The second input source. It reports into the same manager, so a
        // button held on a pad is not dropped by letting go of a key.
        //
        // Which source depends on the bridge, and the bridge decides: the
        // native helper is a separate process using GameController, so
        // Chromium never starts its own HID service and the application can
        // still quit. The browser source is the fallback -- and on macOS the
        // reason it is only a fallback. See FcBridge.
        //
        // Every branch says so in the log, because the ways this can be silent
        // look identical from the outside: a source that was never started,
        // and a source that started and found nothing, both produce no
        // `gamepad:` lines at all.
        if (window.fc.gamepadNative) {
            gamepad = new NativeGamepadSource(manager, (index) => padPort(inputSettings(), index));
            console.log('gamepad: native source started, watching for a pad');
        } else if (window.fc.gamepadEnabled) {
            gamepad = new GamepadSource(manager, (index) => padPort(inputSettings(), index));
            console.log('gamepad: browser source started, watching for a pad');
        } else {
            console.log('gamepad: not enabled -- see the main process log for why');
        }

        // Pads are polled from the moment the effect runs, not from the moment
        // a cartridge is loaded.
        //
        // This used to live in the frame loop, and the frame loop does not
        // start until a game does -- so the pad list stayed empty while the
        // library was on screen, which is exactly when somebody tries to
        // assign a pad to a player. The pad is on the desk whether or not
        // there is a game in the slot, and a reading has to reach the screen
        // to be assignable.
        //
        // A loop of its own rather than part of `tick`, because the two have
        // nothing to do with each other: this one runs at the display's rate
        // for as long as the page is open, and does nothing but ask the pad
        // source and publish a changed answer.
        let padFrame = 0;
        const pumpPads = (): void => {
            padFrame = requestAnimationFrame(pumpPads);

            // The browser's Gamepad API has no change events, so this is a
            // poll; the native source's poll() is empty because its helper
            // pushes. Both are called the same way so the loop does not have
            // to know which one it has.
            gamepad?.poll();

            const pad = gamepad?.report ?? NO_PADS;

            // Compared against the status itself rather than a local copy.
            // Anything that replaces the status wholesale -- building the
            // machine does -- would otherwise leave the screen showing no pads
            // while the pads were still on the desk, because a local copy
            // would still say "nothing changed".
            setStatus((s) => (samePads(s.gamepad, pad) ? s : { ...s, gamepad: pad }));
        };

        // A scripted run has no gamepad source and must stay deterministic, so
        // there is nothing to pump.
        if (!window.fc.selftestOnly) {
            padFrame = requestAnimationFrame(pumpPads);
        }

        const fail = (error: string): void => {
            setStatus({ ...INITIAL_STATUS, state: 'error', error });
        };

        const start = async (): Promise<void> => {
            bootLog('renderer', 'machine build begin');
            const buildStarted = Date.now();
            setStatus((s) => ({ ...s, state: 'loading' }));

            // Where the core's JavaScript lives depends on whether this page
            // came from the Vite dev server or the app:// protocol, so ask the
            // document instead of hardcoding. `@vite-ignore` stops Vite trying
            // to bundle a path it cannot resolve at build time.
            //
            // This is the libretro core (stage L5). The file it replaces,
            // fc_core.mjs, speaks the project's own C ABI; this one speaks
            // libretro, and libretro.mjs is the front end half of it.
            const moduleUrl = new URL('fc_libretro.mjs', document.baseURI).href;
            bootLog('renderer', 'import fc_libretro.mjs begin', moduleUrl);
            const importStarted = Date.now();
            const factory = (await import(/* @vite-ignore */ moduleUrl)) as {
                default: () => Promise<unknown>;
            };
            bootLog('renderer', 'import fc_libretro.mjs done', `${Date.now() - importStarted}ms`);

            // Instantiating the module is where the .wasm is compiled and the
            // linear memory is set aside, and it is usually the single largest
            // cost in a cold start -- so it gets its own line rather than being
            // folded into "machine build".
            const wasmStarted = Date.now();
            const wasm = await factory.default();
            bootLog('renderer', 'instantiate wasm', `${Date.now() - wasmStarted}ms`);
            if (disposed) {
                return;
            }

            const createStarted = Date.now();
            emulator = await createCoreHost(wasm);
            bootLog('renderer', 'createCoreHost', `${Date.now() - createStarted}ms`);
            const engine = emulator;
            if (disposed) {
                engine.destroy();
                emulator = null;
                return;
            }

            // The cheat list and the debugging window belong to the machine,
            // so they are wired the moment there is one. `applyCheats` reads
            // the list from the ref, so a change made while the library is on
            // screen is picked up by the first game loaded.
            actions.current.poke = (address, value) => engine.poke(address, value);
            actions.current.peek = (address) => (disposed ? null : engine.peek(address));
            actions.current.applyCheats = () => engine.setCheats(outward.current.cheats ?? []);
            actions.current.applyCheats();

            // A machine with no cartridge in it yet. The library screen runs
            // over the top of this, and a game is loaded when the player picks
            // one -- or straight away, if the command line named one.
            let loaded = false;

            // Now that there is a machine, point the input manager at it. The
            // keyboard and the pad were set up when the effect ran; they start
            // reaching the console the moment this is assigned.
            engineApply = (port, button, pressed) =>
                engine.setButton(Button[button], pressed, port);

            // Audio. This can fail -- SharedArrayBuffer needs the page to be
            // cross origin isolated -- and when it does the game still runs,
            // silently. Reporting that in the status line is better than
            // throwing away a working picture because the speaker was busy.
            const audioStarted = Date.now();
            try {
                audio = await AudioOutput.create();
                audio.resume().catch(() => undefined);
                bootLog(
                    'renderer',
                    'AudioOutput.create',
                    `${Date.now() - audioStarted}ms state=${audio.state}`,
                );
            } catch (error) {
                audioError = error instanceof Error ? error.message : String(error);
                audio = null;
                bootLog(
                    'renderer',
                    'AudioOutput.create FAILED',
                    `${Date.now() - audioStarted}ms  ${audioError}`,
                );
            }
            if (disposed) {
                void audio?.close();
                audio = null;
                engine.destroy();
                emulator = null;
                return;
            }

            canvas.width = engine.width;
            canvas.height = engine.height;

            // 256x240 RGBA, allocated once and rewritten every frame.
            const image = context.createImageData(engine.width, engine.height);
            let firstBlitLogged = false;

            // The framebuffer view is taken inside blit(), not here. The fc_*
            // host has a picture pointer as soon as the cartridge is in, but
            // the libretro host only learns where the picture is when the core
            // first hands one over -- and a view taken before that is empty.
            // Taking it again is a subarray, so it costs nothing either way.

            /**
             * Turn the emulator's pixels into an image on the canvas.
             *
             * The emulator stores 0x00RRGGBB, so little endian in memory the
             * bytes run B, G, R, 0. A canvas wants R, G, B, A. This loop is
             * the whole of the conversion, 61440 iterations, roughly a fifth
             * of a millisecond. Later this can become a WebGL texture with a
             * BGRA format and cost nothing at all; it is not yet worth the
             * complexity, and it is worth measuring before optimising.
             */
            const blit = (): void => {
                // The wasm heap never grows (see wasm/CMakeLists.txt), so this
                // view into it cannot be detached, and re-taking it each frame
                // is what lets a host whose pointer arrives late still work.
                const framebuffer = engine.framebufferBytes();
                const destination = image.data;
                for (let source = 0, out = 0; out < destination.length; source += 4, out += 4) {
                    destination[out] = framebuffer[source + 2];
                    destination[out + 1] = framebuffer[source + 1];
                    destination[out + 2] = framebuffer[source];
                    destination[out + 3] = 255;
                }
                context.putImageData(image, 0, 0);
                if (!firstBlitLogged) {
                    firstBlitLogged = true;
                    bootLog('renderer', 'first frame on screen', `${Date.now() - buildStarted}ms`);
                }
            };

            /**
             * Empty the APU's queue: measure it, and hand it to the speaker.
             *
             * This is not free to skip. The APU queues samples until somebody
             * takes them, and with a fixed 64MB heap a front end that never
             * drains would run the emulator out of memory in about a quarter
             * of an hour.
             */
            const drainAudio = (): number => {
                const samples = engine.takeSamples();
                if (samples.length === 0) {
                    return 0;
                }

                let peak = 0;
                for (let i = 0; i < samples.length; i += 1) {
                    const sample = samples[i];
                    if (sample > peak) {
                        peak = sample;
                    }
                }

                audio?.push(samples);
                return peak;
            };

            /**
             * A fingerprint of the picture on screen, so a test can compare
             * this window against another build without anybody having to look
             * at it.
             *
             * The bytes hashed are the R,G,B triples, which is exactly what a
             * PPM holds after its 15 byte header -- so a hash taken here can be
             * compared with `tail -c +16 frame.ppm | shasum -a 256`.
             *
             * A screenshot would not do. It has the browser's scaling in it,
             * and a picture that is subtly wrong in a way nobody notices is
             * precisely what these tests exist to catch.
             */
            const hashPixels = async (): Promise<string> => {
                const picture = engine.framebufferBytes();
                const rgb = new Uint8Array(engine.width * engine.height * 3);
                for (let source = 0, out = 0; out < rgb.length; source += 4, out += 3) {
                    rgb[out] = picture[source + 2];
                    rgb[out + 1] = picture[source + 1];
                    rgb[out + 2] = picture[source];
                }
                const digest = await crypto.subtle.digest('SHA-256', rgb);
                return Array.from(new Uint8Array(digest))
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('');
            };

            let paused = false;
            let windowFrames = 0;
            let windowStartedAt = performance.now();
            let windowPeak = 0;

            // Kept for the whole run, not just the current status window, so
            // `--audiotest` can ask whether the game ever made a sound.
            let peakSeen = 0;

            const tick = (nowMs: number): void => {
                animationFrame = requestAnimationFrame(tick);
                const now = nowMs / 1000;

                // The pads are not polled here. See pumpPads above: a pad has
                // to be visible before a game is loaded, so its loop is its
                // own.

                // Rewinding: one snapshot per animation frame. A snapshot is
                // everyFrames frames apart, so this walks backwards at about
                // the speed the console ran forwards.
                if (rewinding && loaded) {
                    nextFrameTime = now;
                    if (rewind === null || !rewind.stepBack()) {
                        // At the beginning of the ring. Stop, rather than
                        // holding the key and doing nothing.
                        rewinding = false;
                    } else {
                        audio?.clear();
                        blit();
                        return;
                    }
                }

                // Paused: keep the clock pinned to now rather than letting the
                // backlog grow, so resuming runs the next frame immediately
                // instead of running four frames to catch up.
                if (paused || !loaded) {
                    nextFrameTime = now;
                    return;
                }

                if (now < nextFrameTime) {
                    return;
                }

                let ran = 0;
                while (now >= nextFrameTime && ran < MAX_CATCHUP_FRAMES) {
                    if (!engine.runFrame()) {
                        setStatus((s) => ({
                            ...s,
                            state: 'halted',
                            error: 'the CPU halted: the emulator met an opcode it does not implement',
                        }));
                        cancelAnimationFrame(animationFrame);
                        animationFrame = 0;
                        return;
                    }
                    const peak = drainAudio();
                    if (peak > windowPeak) {
                        windowPeak = peak;
                    }
                    if (peak > peakSeen) {
                        peakSeen = peak;
                    }

                    // The emulator's frame rate is nudged by up to half a
                    // percent so the audio ring stays at its target. See
                    // audio/output.ts: the system clock and the sound card's
                    // crystal disagree, and without this the ring slowly
                    // fills or empties until the player hears a gap.
                    rewind?.record();

                    nextFrameTime += NES_FRAME_SECONDS * (1 + (audio?.rateCorrection ?? 0));
                    ran += 1;
                }

                if (ran === MAX_CATCHUP_FRAMES) {
                    nextFrameTime = now;
                }

                blit();

                windowFrames += ran;
                const elapsed = nowMs - windowStartedAt;
                if (elapsed >= STATUS_INTERVAL_MS) {
                    const fps = (windowFrames * 1000) / elapsed;
                    setStatus((s) => ({
                        ...s,
                        state: 'running',
                        fps,
                        frameCount: engine.frameCount,
                        totalCycles: engine.totalCycles,
                        cpuPc: engine.cpuPc,
                        audioPeak: windowPeak,
                        held: manager.held,
                        paused,
                        rewinding,
                        rewind: rewind === null || !rewind.available ? null : {
                            depth: rewind.depth,
                            seconds: rewind.seconds,
                            bytes: rewind.bytes,
                        },
                        audio: audio === null ? null : {
                            state: audio.state,
                            fill: audio.fill,
                            targetFill: audio.targetFill,
                            underruns: audio.underruns,
                            dropped: audio.dropped,
                        },
                    }));
                    windowFrames = 0;
                    windowPeak = 0;
                    windowStartedAt = nowMs;
                }
            };

            /**
             * Put a cartridge in the slot and start running.
             *
             * Also reaches the machine's own reset() and clears the audio, so
             * that changing games does not leave the previous one's sound
             * queued up or its keys held down.
             */
            const applyRom = (bytes: Uint8Array, path: string): boolean => {
                if (!engine.loadRom(bytes)) {
                    flash(`could not load ${path}: ${engine.lastError}`);
                    return false;
                }

                // What the native tools do before their loop, so a run here can
                // be compared against theirs cycle for cycle.
                engine.reset();

                // The cheats for this cartridge. The list is read from the ref
                // at load time, so a game loaded from the library gets the
                // list the screen is showing for it -- and a list that arrives
                // a moment later is applied by the effect below.
                engine.setCheats(outward.current.cheats ?? []);

                manager.releaseEverything();
                engine.releaseAllButtons();
                audio?.clear();

                // A new cartridge means the old snapshots describe a machine
                // that no longer exists, and the ring's slot size depended on
                // the old cartridge's RAM.
                rewind?.destroy();
                rewind = new Rewind(engine);

                loaded = true;
                paused = false;
                // A rewind key held while the library was on screen must not
                // carry into the game that just started.
                rewinding = false;
                nextFrameTime = performance.now() / 1000;

                // A cartridge that halted the machine took the frame loop with
                // it -- see the `runFrame` failure above, which cancels the
                // animation frame -- so putting a new one in has to start the
                // loop again. Without this the game loads, the title appears,
                // and nothing runs.
                //
                // Not in self test mode: there the loop is deliberately never
                // started, so that N frames is exactly N frames.
                if (animationFrame === 0 && !window.fc.selftestOnly) {
                    animationFrame = requestAnimationFrame(tick);
                }

                setStatus((s) => ({
                    ...s,
                    state: 'running',
                    paused: false,
                    message: null,
                    // And the previous cartridge's halt, if that is what
                    // stopped the loop. Loading a game is not a way to keep
                    // reading "the emulator met an opcode it does not
                    // implement" for the rest of the session.
                    error: null,
                    romPath: path,
                    romSummary: engine.romSummary,
                }));

                void window.fc.notePlayed(path);
                // And which cartridge this is, so that saving and loading know
                // where the slots belong. The main process cannot work it out
                // from the command line alone -- a game picked out of the
                // library was never on it.
                void window.fc.setCartridge(path);
                return true;
            };

            const loadRom = async (path: string): Promise<boolean> => {
                const bytes = await window.fc.readRom(path);
                if (bytes === null) {
                    flash('could not read that game');
                    return false;
                }
                return applyRom(bytes, path);
            };

            const unload = (): void => {
                loaded = false;
                paused = false;
                rewinding = false;
                rewind?.destroy();
                rewind = null;
                manager.releaseEverything();
                engine.releaseAllButtons();
                audio?.clear();
                // No cartridge, no save slots. The next game will name its own.
                void window.fc.setCartridge(null);

                // And no cartridge on screen either. `romPath` is what says a
                // cartridge is in the slot, and half the interface is derived
                // from it -- see unloaded() in engineStatus.ts, where the whole
                // transition lives so that it can be tested without a window.
                setStatus(unloaded);
            };

            actions.current = { ...actions.current, loadRom, unload, command: (c) => commandHandler?.(c) };

            /** A short note in the status line, gone again in two seconds. */
            const flash = (text: string): void => {
                setStatus((s) => ({ ...s, message: text }));
                window.clearTimeout(flashTimer);
                flashTimer = window.setTimeout(() => {
                    setStatus((s) => ({ ...s, message: null }));
                }, 2000);
            };

            const saveTo = async (slot: number): Promise<void> => {
                const bytes = engine.saveState();
                if (bytes === null) {
                    flash('nothing to save');
                    return;
                }
                const written = await window.fc.saveState(slot, bytes);
                flash(written ? `saved slot ${slot}` : `could not save slot ${slot}`);
            };

            const loadFrom = async (slot: number): Promise<void> => {
                const bytes = await window.fc.loadState(slot);
                if (bytes === null) {
                    flash(`slot ${slot} is empty`);
                    return;
                }
                if (!engine.loadState(bytes)) {
                    flash('that save is not for this game');
                    return;
                }
                // The audio queued before the jump describes a machine that no
                // longer exists, and neither do the snapshots.
                audio?.clear();
                rewind?.reset();
                flash(`loaded slot ${slot}`);
            };

            /**
             * Hand the picture on screen to the caller as a PNG.
             *
             * The canvas is read rather than the framebuffer, because the
             * canvas is the thing the player is looking at, and because
             * Chromium's encoder is right there. It is 256x240 -- the backing
             * store -- not whatever size it is drawn at: the scaling is a CSS
             * decision and a screenshot is a picture of the console's output,
             * not of this window.
             */
            const capture = (asCover: boolean): void => {
                canvas.toBlob((blob) => {
                    if (blob === null) {
                        flash('could not encode the picture');
                        return;
                    }
                    void blob.arrayBuffer().then((buffer) => {
                        outward.current.onScreenshot?.(new Uint8Array(buffer), asCover);
                    });
                }, 'image/png');
            };

            commandHandler = (command: CommandName): void => {
                switch (command) {
                case 'pause':
                    paused = !paused;
                    if (paused) {
                        audio?.clear();
                    } else {
                        nextFrameTime = performance.now() / 1000;
                        void audio?.resume();
                    }
                    setStatus((s) => ({ ...s, paused }));
                    flash(paused ? 'paused' : 'running');
                    break;
                case 'reset':
                    engine.reset();
                    audio?.clear();
                    rewind?.reset();
                    flash('reset');
                    break;
                case 'screenshot':
                    capture(false);
                    break;
                case 'screenshot-cover':
                    capture(true);
                    break;
                case 'save1': case 'save2': case 'save3':
                    void saveTo(Number(command.slice(4)));
                    break;
                case 'load1': case 'load2': case 'load3':
                    void loadFrom(Number(command.slice(4)));
                    break;
                case 'quicksave':
                    void saveTo(0);
                    break;
                case 'quickload':
                    void loadFrom(0);
                    break;
                }
            };

            // Ready, with no cartridge in the slot. applyRom() above fills in
            // the game's details when one arrives.
            setStatus({ ...INITIAL_STATUS, state: 'running', audioError });
            bootLog(
                'renderer',
                'machine ready',
                `${Date.now() - buildStarted}ms total (no cartridge loaded)`,
            );

            // The hook `pnpm run selftest` drives, through
            // webContents.executeJavaScript. Nothing in the game uses it.
            //
            // It takes a plan rather than a frame count because input has to
            // be part of the test. A scripted press is applied at the same
            // point in the frame the real one would be, and the picture is
            // hashed at each requested frame so the caller can compare more
            // than just the end state.
            window.__fc = {
                ready: true,

                /** Which switches are down, as the emulator has them. Used by
                 *  `electron . --keytest`, which presses real keys through
                 *  Chromium and then asks what arrived. */
                held: () => manager.held,

                /**
                 * Frames completed since power on. Paired with a reading taken
                 * a few seconds earlier, this is how `--audiotest` finds out
                 * whether the emulator kept up while audio was running.
                 */
                frames: () => engine.frameCount,

                /**
                 * The live audio pipeline: fill, underruns, dropped samples.
                 *
                 * `--audiotest` runs the application in real time and then
                 * asks for this, which is the only way to find out whether
                 * samples are reaching the audio thread. The self test cannot
                 * answer that, because it runs a whole run's worth of frames
                 * in one go and never touches the ring.
                 */
                audio: () => (audio === null ? { peak: peakSeen, error: audioError } : {
                    state: audio.state,
                    fill: audio.fill,
                    targetFill: audio.targetFill,
                    underruns: audio.underruns,
                    dropped: audio.dropped,
                    peak: peakSeen,
                    error: audioError,
                }),

                selftest: async (plan) => {
                    let error: string | null = null;
                    let peak = 0;
                    const audioChunks: Float32Array[] = [];

                    // Group the script by frame, so the inner loop does not
                    // search for each frame's events.
                    const byFrame = new Map<number, typeof plan.script>();
                    for (const event of plan.script) {
                        const events = byFrame.get(event.frame) ?? [];
                        events.push(event);
                        byFrame.set(event.frame, events);
                    }

                    const wanted = new Set(plan.snapshots);
                    const hashes: { frame: number; hash: string }[] = [];

                    // The round trip, through the real save path: serialize,
                    // hand the bytes to the main process, let it write them to
                    // disk, read them back and put the machine into them.
                    //
                    // It happens in the middle of every self test run, which
                    // means it is checked against the native build's own
                    // hashes: a round trip that changed anything would show up
                    // as a mismatch rather than needing a test of its own.
                    let roundtripError: string | null = null;

                    for (let frame = 1; frame <= plan.frames; frame += 1) {
                        // Pressed before the frame runs, which is where a real
                        // press lands: the game samples the port once per
                        // frame, during vblank.
                        for (const event of byFrame.get(frame) ?? []) {
                            engine.setButton(Button[event.button], event.pressed);
                        }

                        if (!engine.runFrame()) {
                            error = `the CPU halted at frame ${frame}`;
                            break;
                        }

                        // The ring the self test drives directly, because the
                        // loop below is not the animation frame loop and would
                        // otherwise never fill it.
                        rewind?.record();

                        // Drained by hand rather than through drainAudio():
                        // this loop runs a whole run's worth of frames in one
                        // go, which is far more than the ring holds, and the
                        // point here is to keep a copy to hash.
                        const samples = engine.takeSamples();
                        if (samples.length > 0) {
                            for (let i = 0; i < samples.length; i += 1) {
                                if (samples[i] > peak) {
                                    peak = samples[i];
                                }
                            }
                            audioChunks.push(samples.slice());
                        }

                        if (plan.roundtrip !== null && frame === plan.roundtrip.frame) {
                            const bytes = engine.saveState();
                            if (bytes === null) {
                                roundtripError = 'nothing to save';
                            } else if (!await window.fc.saveState(plan.roundtrip.slot, bytes)) {
                                roundtripError = 'the main process could not write the save';
                            } else {
                                const back = await window.fc.loadState(plan.roundtrip.slot);
                                if (back === null || !engine.loadState(back)) {
                                    roundtripError = 'the save did not load back';
                                }
                            }
                        }

                        if (wanted.has(frame)) {
                            hashes.push({ frame, hash: await hashPixels() });
                        }
                    }

                    // Wind back and replay, at the very end so that the audio
                    // collected above is not disturbed by frames running a
                    // second time.
                    //
                    // This is the property that matters for rewind: going back
                    // five snapshots and running forward the same number of
                    // frames has to land on exactly the frame it left, or the
                    // snapshots are not what they claim to be.
                    let rewindHash: string | null = null;
                    if (plan.rewindSteps > 0 && rewind !== null) {
                        let stepped = 0;
                        for (let i = 0; i < plan.rewindSteps; i += 1) {
                            if (!rewind.stepBack()) {
                                break;
                            }
                            stepped += 1;
                        }

                        for (let i = 0; i < stepped * rewind.everyFrames; i += 1) {
                            if (!engine.runFrame()) {
                                error = 'the CPU halted while replaying after a rewind';
                                break;
                            }
                        }

                        rewindHash = await hashPixels();
                        rewind.reset();
                    }

                    blit();

                    // The samples, as raw little endian float32, in the order
                    // the APU produced them. The same bytes
                    // `fc_headless --samples` writes, so the two can be
                    // compared with cmp -- which is the only way to be sure
                    // the mixing did not change on the way to the speaker.
                    const total = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
                    const all = new Float32Array(total);
                    let offset = 0;
                    for (const chunk of audioChunks) {
                        all.set(chunk, offset);
                        offset += chunk.length;
                    }
                    const audioDigest = await crypto.subtle.digest(
                        'SHA-256',
                        new Uint8Array(all.buffer, all.byteOffset, all.byteLength),
                    );
                    const audioHash = Array.from(new Uint8Array(audioDigest))
                        .map((byte) => byte.toString(16).padStart(2, '0'))
                        .join('');

                    return {
                        frameCount: engine.frameCount,
                        totalCycles: engine.totalCycles,
                        cpuPc: engine.cpuPc,
                        sampleRate: engine.sampleRate,
                        audioPeak: peak,
                        audioHash,
                        audioSamples: total,
                        rewindHash,
                        audioState: audio === null ? null : audio.state,
                        audioError,
                        hashes,
                        error: error ?? roundtripError,
                    };
                },
            };

            // A game named on the command line loads straight away; without
            // one the application sits on the library screen until the player
            // picks something.
            const bootRomStarted = Date.now();
            const boot = await window.fc.getBootRom();
            bootLog(
                'renderer',
                'getBootRom',
                boot === null
                    ? `${Date.now() - bootRomStarted}ms, no --rom`
                    : `${Date.now() - bootRomStarted}ms, ${boot.path}`,
            );
            if (boot !== null && !disposed) {
                if (!applyRom(boot.bytes, boot.path)) {
                    loaded = false;
                }
            }

            // In self test mode the machine is left exactly where
            // load_rom + reset put it, so that N frames from here run the same
            // cycles as N frames from the same place in the native build.
            if (!window.fc.selftestOnly) {
                animationFrame = requestAnimationFrame(tick);
            } else if (!loaded) {
                fail('no ROM. Start with --rom <game.nes>, or put one in tests/data/');
            }
        };

        /**
         * Build the machine, once.
         *
         * The first caller wins and everybody else waits on the same promise:
         * `start()` is called from the mount below and from loadRom(), and a
         * player who clicks two games in a row must not build two emulators.
         */
        let startPromise: Promise<void> | null = null;
        const startOnce = (): Promise<void> => (startPromise ??= start());

        // When to build the machine.
        //
        // Not when the window opens. Loading the WebAssembly module, building
        // the Emulator and opening the audio ring is work that has nothing to
        // do with showing the game library, and doing it at start up means the
        // application is unavailable until it finishes -- for a screen the
        // player may sit on for a while. The machine is built on demand
        // instead: the first game that is loaded starts it.
        //
        // Test modes are the exception, and the reason for the `eager` flag on
        // the bridge. A self test, a key test, an audio test or a layout check
        // needs the emulator at a known moment, and some never go through
        // loadRom() at all. See --fc-eager in the main process.
        if (window.fc.eager) {
            void startOnce().catch((error: unknown) => {
                if (!disposed) {
                    fail(error instanceof Error ? error.message : String(error));
                }
            });
        } else {
            // The library screen, with no machine behind it yet. The status
            // says running because the application is running; there is simply
            // no cartridge. command() and unload() do nothing until there is
            // something to command.
            setStatus({ ...INITIAL_STATUS, state: 'running' });
            actions.current = {
                ...actions.current,
                loadRom: async (path: string) => {
                    await startOnce();
                    return actions.current.loadRom(path);
                },
                unload: () => undefined,
                command: () => undefined,
            };
        }

        return () => {
            disposed = true;
            if (animationFrame !== 0) {
                cancelAnimationFrame(animationFrame);
            }
            if (padFrame !== 0) {
                cancelAnimationFrame(padFrame);
            }
            detachKeyboard?.();
            gamepad?.destroy();
            gamepad = null;
            rewind?.destroy();
            rewind = null;
            commandHandler = null;
            window.clearTimeout(flashTimer);
            delete window.__fc;
            // Closing the context stops the audio thread before the ring is
            // abandoned underneath it.
            void audio?.close();
            audio = null;
            emulator?.destroy();
            emulator = null;
        };
    }, [canvasRef]);

    // Push a changed cheat list into the machine. Reading a file and changing a
    // cheat are both asynchronous, and the machine exists by the time either
    // lands, so one effect is enough for both.
    useEffect(() => {
        actions.current.applyCheats();
    }, [handlers.cheats]);

    return {
        status,
        loadRom: (path: string) => actions.current.loadRom(path),
        unload: () => actions.current.unload(),
        command: (command: CommandName) => actions.current.command(command),
        poke: (address: number, value: number) => actions.current.poke(address, value),
        peek: (address: number) => actions.current.peek(address),
    };
}
