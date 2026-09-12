#pragma once

// ---------------------------------------------------------------------------
// Mapper 4, the MMC3.
//
//     PRG ROM:  8KB banks ($8000, $A000, $C000 switchable, $E000 fixed)
//     CHR ROM:  1KB or 2KB banks, with a mode bit that rearranges them
//     + a scanline counter that can interrupt the CPU
//     + switchable horizontal / vertical mirroring
//
// This is the mapper that made the second half of the NES library possible,
// and it is where a console stops being a toy. Everything before it is about
// fitting more data on the cart. The MMC3 adds a piece of state that the
// PPU drives: a counter that ticks once per scanline and fires an IRQ when it
// runs out.
//
// Why a scanline IRQ matters
// --------------------------
// The NES PPU has no way to say "you are at scanline 100". A program that
// wants to change the scroll mid-screen - a status bar that does not move
// while the level scrolls under it, a split-screen for a boss, a wavy
// background - has only one tool: count cycles and hope. The MMC3 turns that
// into an event. The game says "interrupt me in 32 scanlines", and the cart
// does it, and the CPU can spend those 32 scanlines doing something else.
//
// How it counts
// -------------
// The counter watches the PPU's address bus, specifically bit 12, which is
// the bit that chooses between the two pattern tables:
//
//     $0000-$0FFF  A12 = 0
//     $1000-$1FFF  A12 = 1
//
// During every scanline the PPU fetches sprite tiles from $1000-$1FFF, so A12
// goes 0 -> 1 once per scanline. That rising edge clocks the counter. This is
// why the mapper needs to see the PPU bus at all, and why Mapper has an
// on_ppu_address() hook.
//
// The registers
// -------------
//     $8000 even   bank select: bits 0-2 choose a register, bit 6 PRG mode,
//                  bit 7 CHR mode
//     $8001 odd    bank data: written to the register $8000 chose
//     $A000 even   mirroring (bit 0: 0 vertical, 1 horizontal)
//     $A001 odd    PRG RAM protect (ignored: every emulated game writes $80)
//     $C000 even   IRQ latch
//     $C001 odd    IRQ reload
//     $E000 even   IRQ disable and acknowledge
//     $E001 odd    IRQ enable
//
// Every register is one bit of the address (A0), which is why the even/odd
// distinction exists: the board saved a decoder by letting one address line
// do the selecting.
//
// Super Mario Bros. 3 is the game this file was written for.
// ---------------------------------------------------------------------------

#include "core/nes/mapper.hpp"

#include <cstddef>
#include <utility>
#include <vector>

namespace fc::nes {

class Mapper4 : public Mapper {
public:
    Mapper4(std::vector<u8> prg, std::vector<u8> chr, Mirroring default_mirroring)
        : prg_(std::move(prg))
        , chr_(std::move(chr))
        , mirroring_(default_mirroring)
    {
    }

    void make_chr_ram(std::size_t size = 8192)
    {
        chr_.assign(size, 0);
        chr_ram_ = true;
    }

    // -- the CPU's view, $8000-$FFFF -----------------------------------------

    [[nodiscard]] u8 read_prg(u16 address) override
    {
        if (prg_.empty()) {
            return 0;
        }

        const std::size_t banks = prg_bank_count();
        const std::size_t last = banks - 1u;
        const std::size_t second_last = (banks >= 2u) ? (banks - 2u) : 0u;

        std::size_t bank = 0;
        switch (address & 0xE000u) {
        case 0x8000u:
            // PRG mode bit 6 swaps which half R6 controls.
            bank = (prg_mode_ == 0) ? map_prg_bank(prg_bank_[0]) : second_last;
            break;
        case 0xA000u:
            bank = map_prg_bank(prg_bank_[1]);
            break;
        case 0xC000u:
            bank = (prg_mode_ == 0) ? second_last : map_prg_bank(prg_bank_[0]);
            break;
        default:
            bank = last;
            break;
        }

        bank %= banks;
        return prg_[bank * 0x2000u + static_cast<std::size_t>(address & 0x1FFFu)];
    }

    void write_prg(u16 address, u8 value) override
    {
        const bool odd = (address & 0x0001u) != 0;

        // $E000 disables and acknowledges; $E001 enables. Checking it first
        // keeps the order of the switch below from growing a special case.
        switch (address & 0xE000u) {
        case 0x8000u:
            if (!odd) {
                bank_select_ = value;
                chr_mode_ = (value & 0x80u) != 0;
                prg_mode_ = (value & 0x40u) != 0;
            } else {
                write_bank_data(value);
            }
            break;

        case 0xA000u:
            if (!odd) {
                mirroring_ = ((value & 0x01u) != 0) ? Mirroring::Horizontal
                                                    : Mirroring::Vertical;
            }
            // $A001 is the PRG RAM protect register. No emulated game cares.
            break;

        case 0xC000u:
            if (!odd) {
                irq_latch_ = value;
            } else {
                irq_reload_ = true;
            }
            break;

        default:   // $E000-$FFFF
            if (!odd) {
                irq_enabled_ = false;
                irq_pending_ = false;
            } else {
                irq_enabled_ = true;
            }
            break;
        }
    }

    // -- the PPU's view, $0000-$1FFF -----------------------------------------

    [[nodiscard]] u8 read_chr(u16 address) override
    {
        const std::size_t banks = chr_.size() / 0x400u;   // 1KB banks
        if (banks == 0) {
            return 0;
        }
        const std::size_t slot = static_cast<std::size_t>(address >> 10) & 0x07u;
        const std::size_t bank =
            map_chr_bank(slot, chr_slot_[slot]) % banks;
        return chr_[bank * 0x400u + static_cast<std::size_t>(address & 0x3FFu)];
    }

    void write_chr(u16 address, u8 value) override
    {
        if (!chr_ram_) {
            return;
        }
        const std::size_t banks = chr_.size() / 0x400u;
        if (banks == 0) {
            return;
        }
        const std::size_t slot = static_cast<std::size_t>(address >> 10) & 0x07u;
        const std::size_t bank =
            map_chr_bank(slot, chr_slot_[slot]) % banks;
        chr_[bank * 0x400u + static_cast<std::size_t>(address & 0x3FFu)] = value;
    }

    [[nodiscard]] Mirroring mirroring() const noexcept override { return mirroring_; }

    // -- the scanline counter ------------------------------------------------

    void on_ppu_address(u16 address) override
    {
        const bool a12 = (address & 0x1000u) != 0;
        if (a12 && !last_a12_) {
            clock_irq();
        }
        last_a12_ = a12;
    }

    [[nodiscard]] bool irq_asserted() const noexcept override { return irq_pending_; }

    // -- inspection, for tests ----------------------------------------------

    [[nodiscard]] u8 irq_counter() const noexcept { return irq_counter_; }
    [[nodiscard]] u8 irq_latch() const noexcept { return irq_latch_; }
    [[nodiscard]] bool irq_enabled() const noexcept { return irq_enabled_; }
    /// How many times the scanline counter has been clocked, and how many of
    /// those raised /IRQ. A frame of MMC3 rendering should clock it about
    /// once per scanline; a number far above 262 means the A12 edge detector
    /// is seeing extra edges and the games' splits will drift.
    [[nodiscard]] long irq_clock_count() const noexcept { return irq_clocks_; }
    [[nodiscard]] long irq_fire_count() const noexcept { return irq_fires_; }
    [[nodiscard]] u8 chr_register(int index) const noexcept
    {
        return (index >= 0 && index < 6) ? chr_reg_[index] : 0;
    }
    [[nodiscard]] u8 prg_register(int index) const noexcept
    {
        return (index >= 0 && index < 2) ? prg_bank_[index] : 0;
    }
    [[nodiscard]] u8 bank_select() const noexcept { return bank_select_; }

private:
    [[nodiscard]] std::size_t prg_bank_count() const noexcept
    {
        const std::size_t count = prg_.size() / 0x2000u;
        return (count == 0) ? 1 : count;
    }

protected:
    /// A subclass may permute the 8KB PRG bank a register selects. Mapper 249
    /// is the reason this exists: its board wires the ROM address lines in a
    /// scrambled order, so the same register value lands on a different
    /// physical bank. The two hardware-fixed windows at the top are not sent
    /// through here, because their whole job is to stay at the end of the ROM.
    [[nodiscard]] virtual std::size_t map_prg_bank(std::size_t bank) const noexcept
    {
        return bank;
    }

    /// Same, for the 1KB CHR bank a window points at.
    [[nodiscard]] virtual std::size_t map_chr_bank(std::size_t /*slot*/,
                                                   std::size_t bank) const noexcept
    {
        return bank;
    }

private:

    void write_bank_data(u8 value)
    {
        const u8 reg = static_cast<u8>(bank_select_ & 0x07u);
        switch (reg) {
        case 0: case 1: case 2: case 3: case 4: case 5:
            chr_reg_[reg] = value;
            break;
        case 6:
            prg_bank_[0] = static_cast<u8>(value & 0x3Fu);
            break;
        default:
            prg_bank_[1] = static_cast<u8>(value & 0x3Fu);
            break;
        }
        update_chr_slots();
    }

    /// The CHR mode bit rearranges which register feeds which 1KB slot.
    ///
    /// 2KB mode: R0 and R1 each cover 2KB at the bottom; R2-R5 cover the
    ///           top 4KB one kilobyte at a time.
    /// 1KB mode: the two halves swap. R2-R5 move to the bottom and R0/R1
    ///           become the four 1KB banks at the top.
    void update_chr_slots() noexcept
    {
        if (!chr_mode_) {
            chr_slot_[0] = static_cast<u8>(chr_reg_[0] & 0xFEu);
            chr_slot_[1] = static_cast<u8>((chr_reg_[0] & 0xFEu) | 0x01u);
            chr_slot_[2] = static_cast<u8>(chr_reg_[1] & 0xFEu);
            chr_slot_[3] = static_cast<u8>((chr_reg_[1] & 0xFEu) | 0x01u);
            chr_slot_[4] = chr_reg_[2];
            chr_slot_[5] = chr_reg_[3];
            chr_slot_[6] = chr_reg_[4];
            chr_slot_[7] = chr_reg_[5];
        } else {
            chr_slot_[0] = chr_reg_[2];
            chr_slot_[1] = chr_reg_[3];
            chr_slot_[2] = chr_reg_[4];
            chr_slot_[3] = chr_reg_[5];
            chr_slot_[4] = chr_reg_[0];
            chr_slot_[5] = static_cast<u8>(chr_reg_[0] + 1u);
            chr_slot_[6] = chr_reg_[1];
            chr_slot_[7] = static_cast<u8>(chr_reg_[1] + 1u);
        }
    }

    void clock_irq() noexcept
    {
        ++irq_clocks_;
        if (irq_counter_ == 0 || irq_reload_) {
            irq_counter_ = irq_latch_;
        } else {
            --irq_counter_;
        }
        irq_reload_ = false;

        if (irq_counter_ == 0 && irq_enabled_) {
            irq_pending_ = true;
            ++irq_fires_;
        }
    }

    std::vector<u8> prg_;
    std::vector<u8> chr_;
    Mirroring mirroring_;
    bool chr_ram_ = false;

    u8 bank_select_ = 0;
    bool chr_mode_ = false;     // false = 2KB, true = 1KB
    bool prg_mode_ = false;     // false = R6 at $8000, true = R6 at $C000
    u8 chr_reg_[6] = { 0, 0, 0, 0, 0, 0 };
    u8 chr_slot_[8] = { 0, 1, 2, 3, 4, 5, 6, 7 };
    u8 prg_bank_[2] = { 0, 0 };

    bool last_a12_ = false;
    u8 irq_latch_ = 0;
    u8 irq_counter_ = 0;
    bool irq_reload_ = false;
    bool irq_enabled_ = false;
    bool irq_pending_ = false;
    long irq_clocks_ = 0;
    long irq_fires_ = 0;
};

} // namespace fc::nes
