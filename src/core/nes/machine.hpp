#pragma once

// ---------------------------------------------------------------------------
// Machine - one NES, wired together.
//
// Everything up to now has been a part with a test harness around it. This is
// the part that connects them the way the circuit board does:
//
//     Cartridge ---+
//                  |
//     Ppu ---------+--- NesBus --- Cpu
//                  |
//     (controller) +
//
// The CPU and the PPU run at different speeds. The PPU clock is exactly three
// times the CPU clock, and they are not synchronised in any other way - the
// PPU does not wait for the CPU and the CPU cannot see the PPU except through
// eight registers. That relationship is the whole reason NES games are written
// the way they are:
//
//     - vblank is the only safe time to touch the PPU
//     - "scanline timing" means counting CPU cycles to hit a specific row
//     - sprite zero hit is how a program finds out where the beam is
//
// The loop below is therefore very simple and very important:
//
//     run one CPU instruction
//     let the PPU catch up (3 x the cycles the instruction took)
//     hand any NMI the PPU raised to the CPU
//
// Everything else in a NES emerges from that.
// ---------------------------------------------------------------------------

#include "core/cpu/cpu.hpp"
#include "core/nes/bus.hpp"
#include "core/nes/cartridge.hpp"
#include "core/nes/ppu.hpp"
#include "core/types.hpp"

#include <memory>
#include <optional>
#include <span>
#include <string>

namespace fc::nes {

class Machine {
public:
    Machine();

    /// Load a .nes file. Replaces any cartridge already in the slot.
    [[nodiscard]] bool load_rom(std::span<const u8> rom, std::string& error);

    /// Power on: reset the CPU, the PPU and the bus.
    void reset();

    /// Run until the PPU finishes a frame.
    ///
    /// Returns false if the CPU halted (an illegal opcode), which means the
    /// emulator has a bug rather than the game doing something odd.
    [[nodiscard]] bool run_frame();

    /// Run until the PPU has advanced `cycles` dots.
    void run_ppu_cycles(int cycles);

    /// Run a fixed number of CPU instructions.
    [[nodiscard]] bool run_instructions(int count);

    [[nodiscard]] Cpu& cpu() noexcept { return cpu_; }
    [[nodiscard]] Ppu& ppu() noexcept { return ppu_; }
    [[nodiscard]] NesBus& bus() noexcept { return bus_; }
    [[nodiscard]] Cartridge* cartridge() noexcept { return cartridge_.get(); }
    [[nodiscard]] const Cartridge* cartridge() const noexcept { return cartridge_.get(); }

    [[nodiscard]] const Framebuffer& framebuffer() const noexcept
    {
        return ppu_.framebuffer();
    }

private:
    // Declaration order matters: each one is handed to the next.
    std::unique_ptr<Cartridge> cartridge_;
    Ppu ppu_;
    NesBus bus_;
    Cpu cpu_;
};

} // namespace fc::nes
