#pragma once

// ---------------------------------------------------------------------------
// Mapper - the cartridge's own address decoder.
//
// A cartridge is not just a ROM chip. It is a small circuit board with logic
// on it, and that logic decides what each address means. That logic is the
// mapper.
//
// Why mappers exist
// -----------------
// The 6502 can only address 32KB of cartridge space ($8000-$FFFF). Early
// games fit, and needed no mapper at all. Later games did not, so the mapper
// adds a bank register: the CPU writes a number to some address, and the
// cartridge re-points a window of the address space at a different bank of
// the ROM.
//
//     CPU writes $05 to $8000  ->  the cartridge swaps bank 5 into $A000-$BFFF
//
// The ROM chip never changes. Only the wiring inside the cartridge does.
//
// This is why "mapper" is emulated as code and not as data: it is logic, not
// storage.
//
// The CHR side
// ------------
// Note that read_chr/write_chr are separate from read_prg/write_prg. The
// pattern tables are on the PPU's bus, not the CPU's. They are two different
// address spaces that happen to live on the same board.
// ---------------------------------------------------------------------------

#include "core/nes/ines.hpp"
#include "core/types.hpp"

namespace fc::nes {

class Mapper {
public:
    virtual ~Mapper() = default;

    // -- the CPU's view, $8000-$FFFF -----------------------------------------

    [[nodiscard]] virtual u8 read_prg(u16 address) = 0;
    virtual void write_prg(u16 address, u8 value) = 0;

    // -- the PPU's view, $0000-$1FFF -----------------------------------------

    [[nodiscard]] virtual u8 read_chr(u16 address) = 0;
    virtual void write_chr(u16 address, u8 value) = 0;

    /// The cartridge wires the PPU's nametables, so it owns this.
    [[nodiscard]] virtual Mirroring mirroring() const noexcept = 0;
};

} // namespace fc::nes
