// ---------------------------------------------------------------------------
// Types for the two things the renderer reaches for that TypeScript cannot
// see by itself: the emulator's JavaScript, which lives outside this package
// and is plain .mjs, and the test hook the main process calls into.
// ---------------------------------------------------------------------------

/**
 * The object emscripten's loader resolves to. Every field is a pointer or a
 * plain C function; the heap views are typed arrays onto the emulator's own
 * linear memory, which is why reading the framebuffer costs nothing.
 */
interface FcWasmModule {
    readonly HEAPU8: Uint8Array;
    readonly HEAPF32: Float32Array;
    UTF8ToString(pointer: number): string;

    _malloc(size: number): number;
    _free(pointer: number): void;

    _fc_create(): number;
    _fc_destroy(machine: number): void;
    _fc_reset(machine: number): void;
    _fc_run_frame(machine: number): number;
    _fc_load_rom(machine: number, data: number, size: number): number;
    _fc_framebuffer(machine: number): number;
    _fc_last_error(machine: number): number;
    _fc_rom_summary(machine: number): number;
    _fc_set_button(machine: number, button: number, pressed: number, port: number): void;
    _fc_release_all_buttons(machine: number): void;
    _fc_frame_count(machine: number): number;
    _fc_total_cycles(machine: number): number;
    _fc_cpu_pc(machine: number): number;
    _fc_is_halted(machine: number): number;
    _fc_sample_rate(): number;
    _fc_take_samples(machine: number, out: number, max: number): number;
    _fc_samples_pending(machine: number): number;
    _fc_clear_samples(machine: number): void;

    _fc_wasm_abi(): number;
    _fc_wasm_screen_width(): number;
    _fc_wasm_screen_height(): number;
    _fc_wasm_sample_rate(): number;
}

/** wasm/emulator.mjs, reached through the `@wasm` alias in vite.config.ts. */
declare module '@wasm' {
    export class Emulator {        static create(options: {
            module: FcWasmModule;
            sampleCapacity?: number;
        }): Promise<Emulator>;

        readonly width: number;
        readonly height: number;
        readonly sampleRate: number;

        loadRom(bytes: Uint8Array): boolean;
        readonly isLoaded: boolean;
        readonly romSummary: string;
        readonly lastError: string;

        reset(): void;
        runFrame(): boolean;
        readonly isHalted: boolean;
        readonly frameCount: number;
        readonly totalCycles: number;
        readonly cpuPc: number;

        readonly framebufferBytes(): Uint8Array;
        pixel(x: number, y: number): number;

        takeSamples(count?: number): Float32Array;
        readonly samplesPending: number;
        clearSamples(): void;

        setButton(button: number, pressed: boolean, port?: number): void;
        releaseAllButtons(): void;

        /** Serialize the machine, or null if there is nothing to save. */
        saveState(): Uint8Array | null;

        /**
         * Reserve room for `slots` save states, in the emulator's own memory.
         *
         * Null when there is no cartridge or the memory could not be had. See
         * StateBuffer for why rewind does not simply hold an array of
         * Uint8Array.
         */
        createStateBuffer(slots: number): StateBuffer | null;
        /** Put the machine back. False, changing nothing, if the bytes are not
         *  a state for this cartridge. */
        loadState(bytes: Uint8Array): boolean;
        /** Whether the loaded cartridge's mapper saves its bank registers. */
        readonly mapperSavesState: boolean;

        destroy(): void;
    }

    /**
     * A ring of save states living in the emulator's memory.
     *
     * A snapshot is a memcpy into a slot rather than an allocation, because
     * rewind takes one thirty times a second.
     */
    export class StateBuffer {
        /** How many snapshots it holds. */
        readonly slots: number;
        /** Bytes per snapshot. */
        readonly capacity: number;
        save(slot: number): boolean;
        load(slot: number): boolean;
        clear(): void;
        destroy(): void;
    }

    export const Button: {
        readonly A: number;
        readonly B: number;
        readonly SELECT: number;
        readonly START: number;
        readonly UP: number;
        readonly DOWN: number;
        readonly LEFT: number;
        readonly RIGHT: number;
    };
}

/**
 * The hook the main process drives the self test through, via
 * `webContents.executeJavaScript`. It exists only so `pnpm run selftest` can
 * exercise the real renderer without a human watching; nothing in the game
 * loop calls it.
 *
 * It takes a plan rather than a frame count because the test has to be able to
 * press buttons: video parity says the emulator draws the same pixels, and it
 * says nothing about whether a key ever reaches it.
 */
interface FcSelftestPlan {
    frames: number;
    /** Frame numbers to hash the picture at, on top of the final frame. */
    snapshots: number[];
    /** Buttons to press, applied before the named frame runs. */
    script: {
        frame: number;
        button: 'A' | 'B' | 'SELECT' | 'START' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
        pressed: boolean;
    }[];
    /** Save to this slot at this frame and load it straight back, through the
     *  main process and the filesystem, or null for no round trip. */
    roundtrip: { frame: number; slot: number } | null;
    /** How many snapshots to wind back at the end, and replay. Zero to skip. */
    rewindSteps: number;
}
interface FcTestHook {
    ready: boolean;
    /** The switches currently down, as the emulator sees them. */
    held(): string[];
    /** Frames completed since power on. */
    frames(): number;
    /** The live audio ring: fill, underruns, dropped, and the loudest sample
     *  seen since power on. */
    audio(): {
        state?: string;
        fill?: number;
        targetFill?: number;
        underruns?: number;
        dropped?: number;
        peak: number;
        error: string | null;
    };
    selftest(plan: FcSelftestPlan): Promise<{
        frameCount: number;
        totalCycles: number;
        cpuPc: number;
        sampleRate: number;
        audioPeak: number;
        /** sha256 of the raw float32 samples, the same bytes
         *  `fc_headless --samples` writes. */
        audioHash: string;
        audioSamples: number;
        /** The picture after winding back and replaying, which must equal the
         *  picture at the last frame. */
        rewindHash: string | null;
        audioState: string | null;
        audioError: string | null;
        hashes: { frame: number; hash: string }[];
        error: string | null;
    }>;
}

interface Window {
    fc: import('./shared/api').FcBridge;
    __fc?: FcTestHook;
}
