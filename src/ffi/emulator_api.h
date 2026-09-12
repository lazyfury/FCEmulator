#ifndef FC_EMULATOR_API_H
#define FC_EMULATOR_API_H

/* ---------------------------------------------------------------------------
 * The emulator's public interface, in plain C.
 *
 * Why C and not C++
 * -----------------
 * Swift cannot call C++ directly. It can call C, through a bridging header,
 * with no runtime support and no name mangling to worry about. So this file is
 * the one place where the two languages meet, and it is deliberately the
 * dumbest file in the project: no classes, no templates, no exceptions, no
 * allocation the caller has to think about beyond create and destroy.
 *
 * This is also the boundary that enforces the architecture rule from
 * AGENTS.md: the core does not know a window exists. Everything below is
 * data going one way and button presses coming back.
 *
 *       Metal view  ---> framebuffer (a pointer to 256x240 uint32)
 *       Audio out   ---> samples (44100 Hz float)
 *       Keyboard    <--- set_button
 *
 * Ownership
 * ---------
 *   fc_create  allocates.  fc_destroy  frees.  Nothing else allocates anything
 *   the caller has to release.
 *
 *   fc_framebuffer returns a pointer INTO the machine. It stays valid until
 *   the machine is destroyed, and its contents change every frame.
 * ------------------------------------------------------------------------- */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* An opaque handle. The caller never sees what is inside. */
typedef struct fc_machine fc_machine;

/* The screen is always this size. The NES has no other video mode. */
#define FC_SCREEN_WIDTH 256
#define FC_SCREEN_HEIGHT 240

/* One button. The values match nes::Controller::Button. */
typedef enum fc_button {
    FC_BUTTON_A = 0,
    FC_BUTTON_B = 1,
    FC_BUTTON_SELECT = 2,
    FC_BUTTON_START = 3,
    FC_BUTTON_UP = 4,
    FC_BUTTON_DOWN = 5,
    FC_BUTTON_LEFT = 6,
    FC_BUTTON_RIGHT = 7
} fc_button;

/* -- lifecycle ------------------------------------------------------------ */

/* Create a machine with no cartridge. Never returns NULL. */
fc_machine* fc_create(void);

/* Free a machine. Passing NULL is allowed and does nothing. */
void fc_destroy(fc_machine* machine);

/* -- loading -------------------------------------------------------------- */

/* Load a .nes image. Returns false and sets the error string on failure. */
bool fc_load_rom(fc_machine* machine, const uint8_t* data, size_t size);

/* Why the last operation failed. Never NULL. */
const char* fc_last_error(const fc_machine* machine);

/* A one line description of the loaded cartridge, or "" if there is none. */
const char* fc_rom_summary(const fc_machine* machine);

/* -- running -------------------------------------------------------------- */

void fc_reset(fc_machine* machine);

/* Run until the PPU finishes a frame.
 *
 * Returns false if the CPU halted, which means the emulator hit an opcode it
 * does not implement. That is a bug here, not in the game. */
bool fc_run_frame(fc_machine* machine);

/* True once the CPU has halted. Every call after that does nothing. */
bool fc_is_halted(const fc_machine* machine);

/* Frames completed since power on. */
uint32_t fc_frame_count(const fc_machine* machine);

/* -- video ---------------------------------------------------------------- */

/* 256 * 240 pixels, 0x00RRGGBB, top row first. The pointer is owned by the
 * machine and is rewritten by fc_run_frame. */
const uint32_t* fc_framebuffer(const fc_machine* machine);

/* Pixel at (x, y), or 0 if the coordinates are off screen. */
uint32_t fc_pixel(const fc_machine* machine, int x, int y);

/* -- audio ---------------------------------------------------------------- */

/* The APU produces this many samples per second. */
int fc_sample_rate(void);

/* Copy up to `max_samples` mono samples into `out`, and remove them from the
 * machine's queue. Returns the number written.
 *
 * Written to be safe to call from an audio callback: no allocation, no locks,
 * and it returns quickly even when there is nothing to give. */
size_t fc_take_samples(fc_machine* machine, float* out, size_t max_samples);

/* Samples waiting right now. */
size_t fc_samples_pending(const fc_machine* machine);

/* Drop everything queued. Useful after a pause. */
void fc_clear_samples(fc_machine* machine);

/* -- input ---------------------------------------------------------------- */

/* `port` is 0 for controller 1, 1 for controller 2. */
void fc_set_button(fc_machine* machine, fc_button button, bool pressed, int port);

/* Release every button on both ports, for when the window loses focus. */
void fc_release_all_buttons(fc_machine* machine);

/* -- diagnostics ---------------------------------------------------------- */

/* Total CPU cycles since power on. */
uint64_t fc_total_cycles(const fc_machine* machine);

/* The CPU's program counter, for a status line. */
uint16_t fc_cpu_pc(const fc_machine* machine);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* FC_EMULATOR_API_H */
