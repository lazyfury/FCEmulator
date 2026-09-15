#pragma once

// ---------------------------------------------------------------------------
// Mapper 245, another Waixing MMC3.
//
// An MMC3 whose board borrows one bit from the CHR side to extend the PRG
// side. CHR register 0's bit 1 becomes PRG bank bit 6, so a write to a CHR
// register silently moves a 256KB half of the program ROM into view. With a
// 512KB cartridge that is the difference between the first and second half of
// the game.
//
// That is the whole mapper: one OR on the bank number. It was written for
// 仙剑神曲 and 英烈群侠传.
// ---------------------------------------------------------------------------

#include "core/nes/mapper4.hpp"

#include <cstddef>
#include <utility>
#include <vector>

namespace fc::nes {

class Mapper245 : public Mapper4 {
public:
    Mapper245(std::vector<u8> prg, std::vector<u8> chr, Mirroring default_mirroring)
        : Mapper4(std::move(prg), std::move(chr), default_mirroring)
    {
    }

protected:
    /// The 8KB PRG bank a register names, with the high bit the CHR side
    /// supplies. R0 is the first CHR register, which is where the board took
    /// the bit from.
    [[nodiscard]] std::size_t map_prg_bank(std::size_t bank) const noexcept override
    {
        const std::size_t high = (static_cast<std::size_t>(chr_register(0)) & 0x02u) << 5u;
        return bank | high;
    }
};

} // namespace fc::nes
