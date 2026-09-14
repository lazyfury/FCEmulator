// ---------------------------------------------------------------------------
// The libretro core, driven from JavaScript.
//
// This is stage L4a of docs/architecture/libretro-migration.md: a WebAssembly
// module that exports the libretro ABI, and a front end written in JavaScript
// to load and run it. The module is standalone -- its own linear memory,
// `retro_*` exported by name -- so there is no main module to align a C++
// runtime with, and memory growth stays off.
//
// Why a front end is this small
// -----------------------------
// libretro is a callback interface, and both directions are function pointers:
//
//     front end                         core
//     ---------                         ----
//     retro_set_environment      ->     where to send questions
//     retro_set_video_refresh    ->     where a picture goes
//     retro_set_audio_sample*    ->     where sound goes
//     retro_set_input_poll/state ->     where buttons are read
//     retro_init / load_game / run ->   do the work
//
// `addFunction` turns a JavaScript function into a pointer the wasm module can
// call, so the four callbacks below *are* the front end. Everything else is
// bookkeeping: recording what the core said, and copying bytes in and out of
// the heap.
//
// A pointer only means something together with the heap it points into. The
// module's heap is `Module.HEAPU8` and friends, and because ALLOW_MEMORY_GROWTH
// is 0 those views never go stale -- there is nothing here that has to be
// re-fetched after a call, which is the bug this design exists to avoid.
//
// Used by wasm/libretro_test.mjs, and by the Electron renderer when it moves
// to the libretro shape (stage L5).
// ---------------------------------------------------------------------------

import createFcLibretro from './dist/fc_libretro.mjs';

// -- the constants a front end needs, named the way libretro.h names them ----

export const PixelFormat = {
    XRGB8888: 1,
};

export const Device = {
    NONE: 0,
    JOYPAD: 1,
};

/** RETRO_DEVICE_ID_JOYPAD_*. The order is libretro's, not this project's. */
export const Joypad = {
    B: 0,
    Y: 1,
    SELECT: 2,
    START: 3,
    UP: 4,
    DOWN: 5,
    LEFT: 6,
    RIGHT: 7,
    A: 8,
    X: 9,
    L: 10,
    R: 11,
};

/** RETRO_MEMORY_*. */
export const Memory = {
    SAVE_RAM: 0,
    RTC: 1,
    SYSTEM_RAM: 2,
    VIDEO_RAM: 3,
};

export const Region = {
    NTSC: 0,
    PAL: 1,
};

// -- environment commands, only the ones this front end answers --------------

const ENV_GET_CAN_DUPE = 3;
const ENV_SET_PIXEL_FORMAT = 10;
const ENV_SET_INPUT_DESCRIPTORS = 11;
const ENV_GET_LOG_INTERFACE = 27;
const ENV_SET_CONTROLLER_INFO = 35;
const ENV_SET_MEMORY_MAPS = 36 | 0x10000;   // EXPERIMENTAL

const ENV_EXPERIMENTAL = 0x10000;

/// `size_t` in wasm32 is four bytes, so a struct's fields are four apart.
const PTR = 4;

function readCString(mod, pointer)
{
    return pointer ? mod.UTF8ToString(pointer) : '';
}

/**
 * Load the core and wire a front end to it.
 *
 * Returns an object with the same shape the plan calls `CoreHost`, so the
 * Electron renderer can use it without knowing whether it is talking to this
 * module or to the native shared object.
 */
export async function createCoreHost()
{
    const mod = await createFcLibretro();

    // -- what the callbacks record ------------------------------------------

    let pixelFormat = null;
    let memoryMapPublished = 0;
    let inputDescriptorsPublished = false;
    let controllerInfoPublished = false;

    const video = { pointer: 0, width: 0, height: 0, pitch: 0 };

    // One frame is about 735 stereo frames. The buffer is bigger than any
    // frame; a core that produced more than it holds would be dropping audio,
    // which is what the front end's own ring buffer does when it is full.
    const audio = new Int16Array(16384 * 2);
    let audioLength = 0;

    const buttons = [new Uint8Array(16), new Uint8Array(16)];
    let inputPolls = 0;
    let inputQueries = 0;

    function pushSample(left, right)
    {
        if (audioLength + 2 > audio.length) {
            return;
        }
        audio[audioLength++] = left;
        audio[audioLength++] = right;
    }

    // -- the environment callback -------------------------------------------

    const environment = mod.addFunction((command, data) =>
    {
        switch (command)
        {
        case ENV_SET_PIXEL_FORMAT: {
            const format = mod.HEAPU32[data >> 2];
            pixelFormat = format;
            // The core's picture is 32 bits per pixel. Saying no is better
            // than handing it a buffer the front end would read as a
            // different format.
            return format === PixelFormat.XRGB8888 ? 1 : 0;
        }

        case ENV_GET_CAN_DUPE:
            mod.HEAPU8[data] = 1;
            return 1;

        case ENV_SET_INPUT_DESCRIPTORS:
            inputDescriptorsPublished = true;
            return 1;

        case ENV_SET_CONTROLLER_INFO:
            controllerInfoPublished = true;
            return 1;

        case ENV_SET_MEMORY_MAPS:
            memoryMapPublished = mod.HEAPU32[(data + 4) >> 2];
            return 1;

        case ENV_GET_LOG_INTERFACE:
            // A logger would have to be a C variadic function, and
            // addFunction cannot build one. Saying no is allowed, and the
            // core already stays quiet when nobody is listening.
            return 0;

        default:
            return 0;
        }
    }, 'iii');

    // -- video, audio and input ---------------------------------------------

    const videoRefresh = mod.addFunction((pointer, width, height, pitch) =>
    {
        video.pointer = pointer;
        video.width = width;
        video.height = height;
        video.pitch = pitch;
    }, 'viiii');

    const audioSample = mod.addFunction((left, right) =>
    {
        pushSample(left, right);
    }, 'vii');

    const audioSampleBatch = mod.addFunction((pointer, frames) =>
    {
        const base = pointer >> 1;   // HEAP16 indices are half the byte address
        for (let i = 0; i < frames; ++i) {
            pushSample(mod.HEAP16[base + i * 2], mod.HEAP16[base + i * 2 + 1]);
        }
        return frames;
    }, 'iii');

    const inputPoll = mod.addFunction(() => {
        ++inputPolls;
    }, 'v');

    const inputState = mod.addFunction((port, device, index, id) =>
    {
        ++inputQueries;
        if (port > 1 || id > 15) {
            return 0;
        }
        return buttons[port][id] ? 1 : 0;
    }, 'iiiii');

    // -- registration, in the order libretro requires -----------------------

    mod._retro_set_environment(environment);
    mod._retro_set_video_refresh(videoRefresh);
    mod._retro_set_audio_sample(audioSample);
    mod._retro_set_audio_sample_batch(audioSampleBatch);
    mod._retro_set_input_poll(inputPoll);
    mod._retro_set_input_state(inputState);
    mod._retro_init();

    // -- a place to put a struct, reused so a run allocates nothing ----------

    const scratch = mod._malloc(64);

    function withScratchStruct(fill, read)
    {
        fill(scratch);
        return read(scratch);
    }

    return {
        // -- what the core is -------------------------------------------------

        apiVersion()
        {
            return mod._retro_api_version();
        },

        systemInfo()
        {
            return withScratchStruct((ptr) => {
                mod._retro_get_system_info(ptr);
            }, (ptr) => ({
                libraryName: readCString(mod, mod.HEAPU32[ptr >> 2]),
                libraryVersion: readCString(mod, mod.HEAPU32[(ptr >> 2) + 1]),
                validExtensions: readCString(mod, mod.HEAPU32[(ptr >> 2) + 2]),
                needFullpath: mod.HEAPU8[ptr + 12] !== 0,
                blockExtract: mod.HEAPU8[ptr + 13] !== 0,
            }));
        },

        avInfo()
        {
            return withScratchStruct((ptr) => {
                mod._retro_get_system_av_info(ptr);
            }, (ptr) => {
                // The struct pads before its doubles, so they are read through
                // a DataView rather than pretending HEAPF64 is aligned to it.
                const view = new DataView(mod.HEAPU8.buffer);
                return {
                    baseWidth: mod.HEAPU32[ptr >> 2],
                    baseHeight: mod.HEAPU32[(ptr >> 2) + 1],
                    maxWidth: mod.HEAPU32[(ptr >> 2) + 2],
                    maxHeight: mod.HEAPU32[(ptr >> 2) + 3],
                    fps: view.getFloat64(ptr + 24, true),
                    sampleRate: view.getFloat64(ptr + 32, true),
                };
            });
        },

        // -- running ----------------------------------------------------------

        loadGame(bytes)
        {
            const data = mod._malloc(bytes.length);
            mod.HEAPU8.set(bytes, data);

            // retro_game_info { path, data, size, meta }
            const info = mod._malloc(16);
            mod.HEAPU32[info >> 2] = 0;
            mod.HEAPU32[(info >> 2) + 1] = data;
            mod.HEAPU32[(info >> 2) + 2] = bytes.length;
            mod.HEAPU32[(info >> 2) + 3] = 0;

            const ok = mod._retro_load_game(info) !== 0;

            // The core copies what it needs during the call (need_fullpath is
            // false), so both buffers can go now.
            mod._free(info);
            mod._free(data);
            return ok;
        },

        reset()
        {
            mod._retro_reset();
        },

        run()
        {
            audioLength = 0;
            mod._retro_run();
        },

        setButton(port, id, down)
        {
            if (port >= 0 && port < 2 && id >= 0 && id < 16) {
                buttons[port][id] = down ? 1 : 0;
            }
        },

        releaseAllButtons()
        {
            buttons[0].fill(0);
            buttons[1].fill(0);
        },

        setControllerPortDevice(port, device)
        {
            mod._retro_set_controller_port_device(port, device);
        },

        // -- what came out ----------------------------------------------------

        /// The picture, as a pointer into the module heap. It stays valid
        /// until the machine is unloaded, and because growth is off the view
        /// built from it never goes stale.
        framebuffer()
        {
            return { ...video };
        },

        /// The last frame's sound, interleaved stereo int16.
        audio()
        {
            return audio.subarray(0, audioLength);
        },

        /// The whole 2KB console RAM (id SYSTEM_RAM) or the cartridge's save
        /// RAM (id SAVE_RAM), or null when there is none. A view, not a copy,
        /// so writing it writes the machine.
        memory(id)
        {
            const pointer = mod._retro_get_memory_data(id);
            const size = mod._retro_get_memory_size(id);
            if (!pointer || !size) {
                return null;
            }
            return mod.HEAPU8.subarray(pointer, pointer + size);
        },

        // -- save states ------------------------------------------------------

        serializeSize()
        {
            return mod._retro_serialize_size();
        },

        serialize()
        {
            const size = mod._retro_serialize_size();
            if (!size) {
                return null;
            }
            const buffer = mod._malloc(size);
            const ok = mod._retro_serialize(buffer, size) !== 0;
            const bytes = ok ? new Uint8Array(mod.HEAPU8.subarray(buffer, buffer + size)) : null;
            mod._free(buffer);
            return bytes;
        },

        unserialize(bytes)
        {
            const buffer = mod._malloc(bytes.length);
            mod.HEAPU8.set(bytes, buffer);
            const ok = mod._retro_unserialize(buffer, bytes.length) !== 0;
            mod._free(buffer);
            return ok;
        },

        // -- cheats -----------------------------------------------------------

        cheatReset()
        {
            mod._retro_cheat_reset();
        },

        cheatSet(index, enabled, code)
        {
            const text = mod._malloc(mod.lengthBytesUTF8(code) + 1);
            mod.stringToUTF8(code, text, mod.lengthBytesUTF8(code) + 1);
            mod._retro_cheat_set(index, enabled ? 1 : 0, text);
            mod._free(text);
        },

        // -- the custom extension, when the core has one ----------------------

        extension()
        {
            const pointer = mod._fc_libretro_get_ext();
            if (!pointer) {
                return null;
            }
            // Only the version fields are read here. Calling the function
            // pointers is the core's own business; a front end that needs
            // them reads the table (see docs/architecture/libretro-migration.md).
            return {
                pointer,
                abiVersion: mod.HEAPU32[pointer >> 2],
                structSize: mod.HEAPU32[(pointer >> 2) + 1],
            };
        },

        // -- what the front end observed, for tests ---------------------------

        observations()
        {
            return {
                pixelFormat,
                memoryMapPublished,
                inputDescriptorsPublished,
                controllerInfoPublished,
                inputPolls,
                inputQueries,
            };
        },

        unload()
        {
            mod._retro_unload_game();
            mod._retro_deinit();
        },

        module: mod,
        scratch,
    };
}

export const EnvironmentCommand = {
    GET_CAN_DUPE: ENV_GET_CAN_DUPE,
    SET_PIXEL_FORMAT: ENV_SET_PIXEL_FORMAT,
    SET_INPUT_DESCRIPTORS: ENV_SET_INPUT_DESCRIPTORS,
    GET_LOG_INTERFACE: ENV_GET_LOG_INTERFACE,
    SET_CONTROLLER_INFO: ENV_SET_CONTROLLER_INFO,
    SET_MEMORY_MAPS: ENV_SET_MEMORY_MAPS,
    EXPERIMENTAL: ENV_EXPERIMENTAL,
    PTR,
};
