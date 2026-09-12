#include "ffi/emulator_api.h"

#include "core/nes/cartridge.hpp"
#include "core/nes/machine.hpp"

#include <new>
#include <span>
#include <string>

// ---------------------------------------------------------------------------
// The C API's implementation.
//
// Everything here is a thin translation. If a function in this file grows a
// branch that is not "convert a type" or "handle a null", that branch is in
// the wrong place and belongs in the core, where it can be tested.
// ---------------------------------------------------------------------------

struct fc_machine {
    fc::nes::Machine machine;
    std::string error;
    std::string summary;
    bool halted = false;
};

extern "C" {

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

fc_machine* fc_create(void)
{
    // A machine is small enough that an allocation failure here means the
    // process is already dead, so there is nothing useful to return but NULL.
    return new (std::nothrow) fc_machine();
}

void fc_destroy(fc_machine* machine)
{
    delete machine;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

bool fc_load_rom(fc_machine* machine, const uint8_t* data, size_t size)
{
    if (machine == nullptr) {
        return false;
    }

    machine->error.clear();
    machine->summary.clear();
    machine->halted = false;

    if (data == nullptr || size == 0) {
        machine->error = "no ROM data";
        return false;
    }

    const std::span<const fc::u8> rom(data, size);
    if (!machine->machine.load_rom(rom, machine->error)) {
        return false;
    }

    const auto* cartridge = machine->machine.cartridge();
    if (cartridge != nullptr) {
        machine->summary = cartridge->summary();
    }
    return true;
}

const char* fc_last_error(const fc_machine* machine)
{
    if (machine == nullptr) {
        return "";
    }
    return machine->error.c_str();
}

const char* fc_rom_summary(const fc_machine* machine)
{
    if (machine == nullptr) {
        return "";
    }
    return machine->summary.c_str();
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

void fc_reset(fc_machine* machine)
{
    if (machine == nullptr) {
        return;
    }
    machine->machine.reset();
    machine->halted = false;
}

bool fc_run_frame(fc_machine* machine)
{
    if (machine == nullptr || machine->halted) {
        return false;
    }

    if (!machine->machine.run_frame()) {
        machine->halted = true;
        return false;
    }
    return true;
}

bool fc_is_halted(const fc_machine* machine)
{
    return (machine != nullptr) && machine->halted;
}

uint32_t fc_frame_count(const fc_machine* machine)
{
    if (machine == nullptr) {
        return 0;
    }
    return static_cast<uint32_t>(machine->machine.ppu().frame_count());
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

const uint32_t* fc_framebuffer(const fc_machine* machine)
{
    if (machine == nullptr) {
        return nullptr;
    }
    return machine->machine.framebuffer().pixels.data();
}

uint32_t fc_pixel(const fc_machine* machine, int x, int y)
{
    if (machine == nullptr) {
        return 0;
    }
    return machine->machine.framebuffer().at(x, y);
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

int fc_sample_rate(void)
{
    return fc::nes::Apu::kSampleRate;
}

size_t fc_take_samples(fc_machine* machine, float* out, size_t max_samples)
{
    if (machine == nullptr) {
        return 0;
    }
    return machine->machine.apu().drain(out, max_samples);
}

size_t fc_samples_pending(const fc_machine* machine)
{
    if (machine == nullptr) {
        return 0;
    }
    return machine->machine.apu().samples_pending();
}

void fc_clear_samples(fc_machine* machine)
{
    if (machine == nullptr) {
        return;
    }
    machine->machine.apu().clear_samples();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

void fc_set_button(fc_machine* machine, fc_button button, bool pressed, int port)
{
    if (machine == nullptr) {
        return;
    }

    const int index = (port == 1) ? 1 : 0;
    const auto value = static_cast<fc::nes::Controller::Button>(button);
    machine->machine.controller(index).set_button(value, pressed);
}

void fc_release_all_buttons(fc_machine* machine)
{
    if (machine == nullptr) {
        return;
    }
    machine->machine.controller(0).release_all();
    machine->machine.controller(1).release_all();
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

uint64_t fc_total_cycles(const fc_machine* machine)
{
    if (machine == nullptr) {
        return 0;
    }
    return machine->machine.cpu().total_cycles();
}

uint16_t fc_cpu_pc(const fc_machine* machine)
{
    if (machine == nullptr) {
        return 0;
    }
    return machine->machine.cpu().registers().pc;
}

} // extern "C"
