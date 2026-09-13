#pragma once

// ---------------------------------------------------------------------------
// Machine - one NES, wired together.
//
// Everything up to now has been a part with a test harness around it. This is
// the part that connects them the way the circuit board does:
//
//     Cartridge ---+
//                  |
//     Ppu ---------+
//                  |
//     Apu ---------+--- NesBus --- Cpu
//                  |
//     Controller --+
//
// Three clocks, all derived from one crystal:
//
//     CPU   1.789773 MHz   the reference
//     PPU   5.369319 MHz   exactly 3x the CPU
//     APU   0.894886 MHz   exactly half the CPU
//
// The CPU and the PPU are not synchronised in any other way - the
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
#include "core/nes/apu.hpp"
#include "core/nes/cartridge.hpp"
#include "core/nes/controller.hpp"
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
    [[nodiscard]] Apu& apu() noexcept { return apu_; }

    // Read only views, for the C interface and for anything that only wants
    // to look. Ppu's framebuffer and Apu's pending count are both const, so
    // a frontend can read them without being handed a mutable machine.
    [[nodiscard]] const Cpu& cpu() const noexcept { return cpu_; }
    [[nodiscard]] const Ppu& ppu() const noexcept { return ppu_; }
    [[nodiscard]] const Apu& apu() const noexcept { return apu_; }
    [[nodiscard]] NesBus& bus() noexcept { return bus_; }
    [[nodiscard]] Cartridge* cartridge() noexcept { return cartridge_.get(); }
    [[nodiscard]] const Cartridge* cartridge() const noexcept { return cartridge_.get(); }

    [[nodiscard]] const Framebuffer& framebuffer() const noexcept
    {
        return ppu_.framebuffer();
    }

    // -- input ---------------------------------------------------------------
    //
    // The frontend (or a test, or a script) sets button states here. The
    // machine does not care where they came from, which is what makes scripted
    // input and a real keyboard the same thing from the emulator's point of
    // view.

    [[nodiscard]] Controller& controller(int index = 0) noexcept
    {
        return bus_.controller(index);
    }

    [[nodiscard]] const Controller& controller(int index = 0) const noexcept
    {
        return bus_.controller(index);
    }

    /// Press or release one button on one port.
    void set_button(Controller::Button button, bool pressed, int index = 0) noexcept
    {
        bus_.controller(index).set_button(button, pressed);
    }

private:
    /// One CPU instruction, with the PPU and APU caught up, and the mapper
    /// handed its clocks and IRQ line. Shared by run_frame/run_instructions.
    int step_one();

    /// Hand the mapper its CPU-cycle clock if it asked for one. The loop is
    /// empty for every mapper that does not (MMC3 counts PPU A12 instead).
    void clock_mapper(int cpu_cycles) noexcept;

    // Declaration order matters: each one is handed to the next.
    std::unique_ptr<Cartridge> cartridge_;
    Ppu ppu_;
    Apu apu_;
    NesBus bus_;
    Cpu cpu_;

    /// A vblank NMI seen on the previous step, held for one instruction so a
    /// $2002 polling loop can read the flag first. See Machine::step_one().
    bool nmi_hold_ = false;
};

} // namespace fc::nes
