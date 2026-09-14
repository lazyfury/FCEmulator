// ---------------------------------------------------------------------------
// The libretro core.
//
// This file is the whole of the project's libretro ABI. It owns no emulator of
// its own: every function below translates a libretro request into a call on
// the machine in src/core, the same machine src/ffi/emulator_api.cpp drives.
//
// Why it is a separate translation unit from the C FFI
// ----------------------------------------------------
// They are two doors into one room. `fc_*` exists for this project's own front
// end, tests and tools; `retro_*` exists so RetroArch, Lakka and every other
// libretro front end can load the emulator without knowing anything about it.
// Neither is built on the other, and neither is allowed to grow a piece of
// emulation the other lacks -- if a rule lives here and not in the core, it is
// in the wrong place.
//
// The shape of the ABI
// --------------------
// A libretro core is a process-wide singleton with callbacks in both
// directions:
//
//     front end                         core
//     ---------                         ----
//     retro_set_environment      ->     store the environment function
//     retro_set_video_refresh    ->     store where the picture goes
//     retro_set_audio_sample*    ->     store where the sound goes
//     retro_set_input_poll/state ->     store where the buttons are read
//     retro_init                 ->     build the machine
//     retro_load_game            ->     put a cartridge in
//     retro_run                  ->     one frame, then call video + audio
//     retro_serialize            <->    save states, and therefore rewind
//     retro_unload_game/deinit   ->     take it apart
//
// The callbacks the core is handed are functions in the *front end*. A button
// therefore travels: front end callback -> here -> Controller -> Bus -> CPU,
// and a pixel travels the other way. Nothing crosses without being asked for
// by name, which is what keeps the core from knowing a window exists.
//
// What is not here yet
// --------------------
// Battery-backed save RAM and the debug memory view (retro_get_memory_data)
// are stage L2, and cheat codes (retro_cheat_set, which speaks Game Genie
// strings rather than this project's address/value pairs) are stage L3. Both
// have deliberate stubs below so their absence is a log line rather than a
// missing symbol.
// ---------------------------------------------------------------------------

#include "libretro.h"

#include "core/nes/machine.hpp"
#include "core/types.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <span>
#include <string>

namespace {

// ---------------------------------------------------------------------------
// The singleton
//
// libretro defines one core per process, so where the C interface keeps the
// machine inside an `fc_machine` the caller owns, this keeps exactly one here.
// ---------------------------------------------------------------------------

fc::nes::Machine* g_machine = nullptr;

/// True once the CPU has executed something it does not know. Every run after
/// that is a no-op rather than a re-execution.
bool g_halted = false;

/// What the front end must keep about each port, including "nothing plugged
/// in", which is a real setting a player can choose.
unsigned g_port_device[2] = { RETRO_DEVICE_JOYPAD, RETRO_DEVICE_JOYPAD };

// -- the front end's functions, stored by the retro_set_* calls ---------------

retro_environment_t g_environ = nullptr;
retro_video_refresh_t g_video = nullptr;
retro_audio_sample_t g_audio = nullptr;
retro_audio_sample_batch_t g_audio_batch = nullptr;
retro_input_poll_t g_input_poll = nullptr;
retro_input_state_t g_input_state = nullptr;

/// The front end's logger, when it has one. Cores are expected to stay quiet
/// when it does not.
retro_log_printf_t g_log = nullptr;

// ---------------------------------------------------------------------------
// Constants
//
// One screen size and one region, because the NES has exactly one and this
// core does not emulate PAL. The frame rate is the NTSC value the rest of the
// libretro ecosystem uses (the PPU's 341 x 262 dots at 5.369 MHz), not a
// rounded 60 -- at 60.0 an emulator drifts a whole second every ten minutes.
// ---------------------------------------------------------------------------

constexpr int kScreenWidth = 256;
constexpr int kScreenHeight = 240;
constexpr int kBytesPerPixel = 4;
constexpr double kFrameRate = 60.0988;
constexpr double kSampleRate = 44100.0;

/// A frame is 44100 / 60.1 = 734 samples. 4096 is far more than one frame and
/// costs 16KB, so the buffers are file statics rather than something allocated
/// per run.
constexpr std::size_t kMaxSamplesPerFrame = 4096;

std::array<fc::f32, kMaxSamplesPerFrame> g_mono{};
std::array<std::int16_t, kMaxSamplesPerFrame * 2> g_stereo{};

// ---------------------------------------------------------------------------
// Logging
//
// retro_log_printf_t is variadic, but a va_list cannot be forwarded into it,
// so a message is formatted once here and handed over as a string. The extra
// copy is irrelevant: this only runs on load and on errors.
// ---------------------------------------------------------------------------

void log_message(enum retro_log_level level, const char* format, ...)
{
    if (g_log == nullptr) {
        return;
    }

    char buffer[512];
    va_list args;
    va_start(args, format);
    std::vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);

    g_log(level, "%s", buffer);
}

// -- what the front end is told about the input, once, at load ---------------

const retro_input_descriptor kInputDescriptors[] = {
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, "B" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, "A" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_SELECT, "Select" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_START, "Start" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_UP, "Up" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_DOWN, "Down" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_LEFT, "Left" },
    { 0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_RIGHT, "Right" },

    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, "B" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, "A" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_SELECT, "Select" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_START, "Start" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_UP, "Up" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_DOWN, "Down" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_LEFT, "Left" },
    { 1, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_RIGHT, "Right" },

    { 0, 0, 0, 0, nullptr },
};

const retro_controller_description kControllerTypes[] = {
    { "Gamepad", RETRO_DEVICE_JOYPAD },
    { "None", RETRO_DEVICE_NONE },
};

const retro_controller_info kControllerInfo[] = {
    { kControllerTypes, 2 },
    { kControllerTypes, 2 },
};

// ---------------------------------------------------------------------------
// Input
//
// The only mapping that matters, and the one every NES core agrees on: the
// NES's B button is the RetroPad's B (the south face button) and the NES's A
// is the RetroPad's A (the east one). The names line up, which is exactly why
// libretro named its buttons after a SNES controller rather than an Xbox one.
// ---------------------------------------------------------------------------

/// One NES button, and where it arrives from.
struct ButtonMapping {
    unsigned retro_id;
    fc::nes::Controller::Button button;
};

constexpr ButtonMapping kButtonMap[] = {
    { RETRO_DEVICE_ID_JOYPAD_B, fc::nes::Controller::Button::B },
    { RETRO_DEVICE_ID_JOYPAD_A, fc::nes::Controller::Button::A },
    { RETRO_DEVICE_ID_JOYPAD_SELECT, fc::nes::Controller::Button::Select },
    { RETRO_DEVICE_ID_JOYPAD_START, fc::nes::Controller::Button::Start },
    { RETRO_DEVICE_ID_JOYPAD_UP, fc::nes::Controller::Button::Up },
    { RETRO_DEVICE_ID_JOYPAD_DOWN, fc::nes::Controller::Button::Down },
    { RETRO_DEVICE_ID_JOYPAD_LEFT, fc::nes::Controller::Button::Left },
    { RETRO_DEVICE_ID_JOYPAD_RIGHT, fc::nes::Controller::Button::Right },
};

/// Ask the front end what is held, and put both controllers where that says.
///
/// The release first is not optional: a libretro front end reports a button
/// going down, or not, and a machine that is only ever told about the buttons
/// that are down never hears about one coming up.
void apply_input()
{
    if (g_machine == nullptr || g_input_state == nullptr) {
        return;
    }

    for (int port = 0; port < 2; ++port) {
        auto& controller = g_machine->controller(port);
        controller.release_all();

        if (g_port_device[port] == RETRO_DEVICE_NONE) {
            continue;
        }

        for (const ButtonMapping& mapping : kButtonMap) {
            const bool pressed =
                g_input_state(static_cast<unsigned>(port), RETRO_DEVICE_JOYPAD, 0,
                              mapping.retro_id) != 0;
            controller.set_button(mapping.button, pressed);
        }
    }
}

// ---------------------------------------------------------------------------
// Audio
//
// The core produces mono floating point at 44100 Hz; libretro wants signed
// 16-bit stereo. The two conversions are both lossy in a way that is worth
// stating once:
//
//   * mono -> stereo is a copy, because the hardware has one speaker
//   * float -> int16 is a clamp and a scale, and the clamp is not decoration:
//     a sample outside [-1, 1] wraps to the opposite sign in a cast, which is
//     the click people blame on their speakers
// ---------------------------------------------------------------------------

void drain_audio()
{
    if (g_machine == nullptr || (g_audio_batch == nullptr && g_audio == nullptr)) {
        return;
    }

    const std::size_t taken =
        g_machine->apu().drain(g_mono.data(), kMaxSamplesPerFrame);
    if (taken == 0) {
        return;
    }

    for (std::size_t i = 0; i < taken; ++i) {
        fc::f32 sample = g_mono[i];
        if (sample > 1.0f) {
            sample = 1.0f;
        } else if (sample < -1.0f) {
            sample = -1.0f;
        }

        const auto value = static_cast<std::int16_t>(std::lround(sample * 32767.0f));
        g_stereo[i * 2] = value;
        g_stereo[i * 2 + 1] = value;
    }

    if (g_audio_batch != nullptr) {
        g_audio_batch(g_stereo.data(), taken);
        return;
    }
    for (std::size_t i = 0; i < taken; ++i) {
        g_audio(g_stereo[i * 2], g_stereo[i * 2 + 1]);
    }
}

} // namespace

// ---------------------------------------------------------------------------
// The ABI
// ---------------------------------------------------------------------------

extern "C" {

RETRO_API unsigned retro_api_version(void)
{
    return RETRO_API_VERSION;
}

RETRO_API void retro_get_system_info(struct retro_system_info* info)
{
    if (info == nullptr) {
        return;
    }

    std::memset(info, 0, sizeof(*info));
    info->library_name = "FC Emulator";
#ifdef FC_LIBRETRO_VERSION
    info->library_version = FC_LIBRETRO_VERSION;
#else
    info->library_version = "0.0.0";
#endif
    info->valid_extensions = "nes";

    // The whole ROM is handed to us in memory, so the front end may patch it,
    // decompress it, or hand it over from somewhere that is not a file.
    info->need_fullpath = false;
    info->block_extract = false;
}

RETRO_API void retro_get_system_av_info(struct retro_system_av_info* info)
{
    if (info == nullptr) {
        return;
    }

    std::memset(info, 0, sizeof(*info));
    info->geometry.base_width = kScreenWidth;
    info->geometry.base_height = kScreenHeight;
    info->geometry.max_width = kScreenWidth;
    info->geometry.max_height = kScreenHeight;
    // Zero means "the front end may assume square pixels from base_width and
    // base_height", which is the same assumption this project's own front end
    // makes when it scales by whole pixels.
    info->geometry.aspect_ratio = 0.0f;
    info->timing.fps = kFrameRate;
    info->timing.sample_rate = kSampleRate;
}

RETRO_API void retro_set_controller_port_device(unsigned port, unsigned device)
{
    if (port > 1) {
        return;
    }

    g_port_device[port] = device;
    if (device == RETRO_DEVICE_NONE && g_machine != nullptr) {
        g_machine->controller(static_cast<int>(port)).release_all();
    }
}

RETRO_API void retro_reset(void)
{
    if (g_machine == nullptr) {
        return;
    }
    g_machine->reset();
    g_halted = false;
}

RETRO_API void retro_run(void)
{
    if (g_machine == nullptr) {
        return;
    }

    if (g_input_poll != nullptr) {
        g_input_poll();
    }
    apply_input();

    if (!g_halted && !g_machine->run_frame()) {
        // An illegal opcode: the emulator has a bug, not the game. Say so once
        // and then keep handing the front end the last picture so it does not
        // wait for a frame that will never come.
        g_halted = true;
        log_message(RETRO_LOG_ERROR, "FC Emulator: the CPU halted on an unknown opcode");
    }

    if (g_video != nullptr) {
        const auto& framebuffer = g_machine->framebuffer();
        g_video(framebuffer.pixels.data(), kScreenWidth, kScreenHeight,
                static_cast<std::size_t>(kScreenWidth) * kBytesPerPixel);
    }

    drain_audio();
}

RETRO_API size_t retro_serialize_size(void)
{
    if (g_machine == nullptr || g_machine->cartridge() == nullptr) {
        return 0;
    }
    return g_machine->state_size();
}

RETRO_API bool retro_serialize(void* data, size_t len)
{
    if (g_machine == nullptr || data == nullptr || len == 0) {
        return false;
    }

    const std::span<fc::u8> buffer(static_cast<fc::u8*>(data), len);
    return g_machine->save_state_into(buffer) != 0;
}

RETRO_API bool retro_unserialize(const void* data, size_t len)
{
    if (g_machine == nullptr || data == nullptr || len == 0) {
        return false;
    }

    const std::span<const fc::u8> buffer(static_cast<const fc::u8*>(data), len);
    if (!g_machine->load_state(buffer)) {
        return false;
    }

    // A restored machine is a running one, whatever it was doing before.
    g_halted = false;
    return true;
}

RETRO_API void retro_cheat_reset(void)
{
    if (g_machine != nullptr) {
        g_machine->cheats().clear();
    }
}

RETRO_API void retro_cheat_set(unsigned index, bool enabled, const char* code)
{
    (void)index;
    (void)enabled;
    (void)code;

    // libretro carries cheats as Game Genie and Pro Action Replay strings,
    // which are a different language from this machine's address/value pairs.
    // Translating them is stage L3; until then, say so rather than pretending.
    log_message(RETRO_LOG_WARN, "FC Emulator: cheat codes are not implemented yet");
}

RETRO_API bool retro_load_game(const struct retro_game_info* game)
{
    if (game == nullptr || game->data == nullptr || game->size == 0) {
        log_message(RETRO_LOG_ERROR, "FC Emulator: no ROM data was provided");
        return false;
    }

    // A front end that cannot show XRGB8888 cannot show this core's picture.
    // Asking before loading keeps the failure at the door.
    enum retro_pixel_format format = RETRO_PIXEL_FORMAT_XRGB8888;
    if (g_environ != nullptr &&
        !g_environ(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &format)) {
        log_message(RETRO_LOG_ERROR, "FC Emulator: the front end does not support XRGB8888");
        return false;
    }
    if (g_machine == nullptr) {
        g_machine = new fc::nes::Machine();
    }

    const std::span<const fc::u8> rom(static_cast<const fc::u8*>(game->data),
                                      game->size);
    std::string error;
    if (!g_machine->load_rom(rom, error)) {
        log_message(RETRO_LOG_ERROR, "FC Emulator: %s", error.c_str());
        return false;
    }

    g_machine->reset();
    g_halted = false;

    if (g_environ != nullptr) {
        g_environ(RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS,
                  const_cast<retro_input_descriptor*>(kInputDescriptors));
        g_environ(RETRO_ENVIRONMENT_SET_CONTROLLER_INFO,
                  const_cast<retro_controller_info*>(kControllerInfo));
    }

    const auto* cartridge = g_machine->cartridge();
    if (cartridge != nullptr) {
        log_message(RETRO_LOG_INFO, "FC Emulator: %s", cartridge->summary().c_str());
    }
    return true;
}

RETRO_API bool retro_load_game_special(unsigned game_type,
                                        const struct retro_game_info* info,
                                        size_t num_info)
{
    (void)game_type;
    (void)info;
    (void)num_info;
    // The NES has no subsystems: one cartridge, one machine.
    return false;
}

RETRO_API void retro_unload_game(void)
{
    delete g_machine;
    g_machine = nullptr;
    g_halted = false;
}

RETRO_API unsigned retro_get_region(void)
{
    return RETRO_REGION_NTSC;
}

RETRO_API void* retro_get_memory_data(unsigned id)
{
    // Save RAM and the debug memory view are stage L2.
    (void)id;
    return nullptr;
}

RETRO_API size_t retro_get_memory_size(unsigned id)
{
    (void)id;
    return 0;
}

// -- lifecycle ---------------------------------------------------------------

RETRO_API void retro_set_environment(retro_environment_t cb)
{
    g_environ = cb;
}

RETRO_API void retro_set_video_refresh(retro_video_refresh_t cb)
{
    g_video = cb;
}

RETRO_API void retro_set_audio_sample(retro_audio_sample_t cb)
{
    g_audio = cb;
}

RETRO_API void retro_set_audio_sample_batch(retro_audio_sample_batch_t cb)
{
    g_audio_batch = cb;
}

RETRO_API void retro_set_input_poll(retro_input_poll_t cb)
{
    g_input_poll = cb;
}

RETRO_API void retro_set_input_state(retro_input_state_t cb)
{
    g_input_state = cb;
}

RETRO_API void retro_init(void)
{
    if (g_machine == nullptr) {
        g_machine = new fc::nes::Machine();
    }
    g_halted = false;

    // A fresh core has a gamepad in each port, whatever a previous session
    // left behind. The front end says otherwise with
    // retro_set_controller_port_device() if it wants to.
    g_port_device[0] = RETRO_DEVICE_JOYPAD;
    g_port_device[1] = RETRO_DEVICE_JOYPAD;

    // The environment function was handed over before this point, which is why
    // the log interface can be asked for here rather than at load.
    if (g_environ != nullptr) {
        retro_log_callback logger{};
        if (g_environ(RETRO_ENVIRONMENT_GET_LOG_INTERFACE, &logger)) {
            g_log = logger.log;
        }
    }

    log_message(RETRO_LOG_INFO, "FC Emulator: core initialised");
}

RETRO_API void retro_deinit(void)
{
    delete g_machine;
    g_machine = nullptr;
    g_halted = false;
    g_environ = nullptr;
    g_video = nullptr;
    g_audio = nullptr;
    g_audio_batch = nullptr;
    g_input_poll = nullptr;
    g_input_state = nullptr;
    g_log = nullptr;
}

} // extern "C"
