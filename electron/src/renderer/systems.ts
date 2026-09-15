// ---------------------------------------------------------------------------
// Which console a game is for.
//
// The front end runs any libretro core the same way; the only thing it has to
// decide is *which* core, and a file extension is what decides it. This is the
// one place that mapping lives.
//
// A core is more than a file name. The frame rate and the sample rate are
// properties of the console, not of the module, and the audio pipeline is
// built around the sample rate -- so they travel together with the module
// here rather than being read from the core. The NES core could be asked for
// its geometry at any time, but mGBA's only answers once a game is in, and the
// audio device has to exist before that. So the numbers are known up front.
//
// The values:
//
//   NES        256x240, 60.0988 fps, 44100 Hz   (the PPU divides the NTSC burst)
//   GBA        240x160, 59.7275 fps, 65536 Hz
//   GB / GBC   160x144, 59.7275 fps, 131072 Hz  (mGBA resamples the GB clock)
//
// These are what mGBA reports through retro_get_system_av_info; a change to
// them would show up as audio at the wrong pitch, which is the point of
// keeping the number next to the module and not somewhere the core could
// disagree with it.
// ---------------------------------------------------------------------------

export type CoreId = 'nes' | 'mgba';

export interface CoreChoice {
    /** Which core, for comparing one choice against another. */
    readonly id: CoreId;
    /** The emscripten module's file name inside wasm/dist. */
    readonly module: string;
    /** What the core produces, in samples per second. */
    readonly sampleRate: number;
    /** One emulated frame, in seconds. */
    readonly frameSeconds: number;
}

const NES: CoreChoice = {
    id: 'nes',
    module: 'fc_libretro.mjs',
    sampleRate: 44100,
    frameSeconds: 1 / 60.0988,
};

const MGBA_GBA: CoreChoice = {
    id: 'mgba',
    module: 'mgba_libretro.mjs',
    sampleRate: 65536,
    frameSeconds: 1 / 59.7275,
};

const MGBA_GB: CoreChoice = {
    id: 'mgba',
    module: 'mgba_libretro.mjs',
    sampleRate: 131072,
    frameSeconds: 1 / 59.7275,
};

/** The extension of a path, lower case and without the dot, or ''. */
export function extensionOf(path: string): string
{
    const dot = path.lastIndexOf('.');
    if (dot < 0) {
        return '';
    }
    return path.slice(dot + 1).toLowerCase();
}

/**
 * The core to run a game on.
 *
 * Anything unrecognised is treated as a NES game, which keeps the old
 * behaviour for a file with no extension and gives a clear failure -- a NES
 * core that refuses the cartridge -- for a file that is not a ROM at all.
 */
export function chooseCore(path: string): CoreChoice
{
    const extension = extensionOf(path);
    if (extension === 'gba') {
        return MGBA_GBA;
    }
    if (extension === 'gb' || extension === 'gbc') {
        return MGBA_GB;
    }
    return NES;
}

/** Whether two choices need different machines. */
export function sameCore(a: CoreChoice | null, b: CoreChoice): boolean
{
    return a !== null && a.module === b.module && a.sampleRate === b.sampleRate;
}
