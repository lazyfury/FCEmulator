#pragma once

// ---------------------------------------------------------------------------
// Mapper 74, the Waixing MMC3.
//
// An MMC3 with one difference that is not a register: the board carries 2KB of
// CHR RAM beside the pattern ROM, and the two CHR page numbers 8 and 9 come
// from that RAM instead of the ROM. Nothing selects it with a bit; the page
// number is the selector.
//
//     CHR page 0..7   pattern ROM
//     CHR page 8..9   the 2KB of RAM
//     CHR page 10..   pattern ROM
//
// It is a small, strange piece of wiring, and it exists because a game wanted
// a tile it could rewrite -- a status bar, a font -- without giving up the
// ROM it was already using for everything else. Mapper 74 was written for the
// 外星科技 cartridges (天使之翼2, 天神之剑, 封神榜) and it is the first mapper
// here whose CHR is not wholly one thing or the other.
// ---------------------------------------------------------------------------

#include "core/nes/mapper4.hpp"

#include <cstddef>
#include <utility>
#include <vector>

namespace fc::nes {

class Mapper74 : public Mapper4 {
public:
    Mapper74(std::vector<u8> prg, std::vector<u8> chr, Mirroring default_mirroring)
        : Mapper4(std::move(prg), std::move(chr), default_mirroring)
    {
        make_chr_ram_window(0x800);   // 2KB, two 1KB pages
    }

protected:
    [[nodiscard]] bool chr_page_is_ram(std::size_t page) const noexcept override
    {
        return page == 8u || page == 9u;
    }
};

} // namespace fc::nes
