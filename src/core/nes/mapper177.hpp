#pragma once

// ---------------------------------------------------------------------------
// Mapper 177, a Henggedianzi board.
//
//     $8000-$FFFF  write:  [.MBB BBBB]  B = 32KB PRG bank, M = mirroring
//     PRG: one 32KB window
//     CHR: 8KB, no banking
//
// One of the small Chinese boards where a single latch holds everything. The
// data byte is the bank, and one of its bits is wired straight to the
// nametable select pin. There is no fixed bank, so the reset vector moves
// with the switch - the ROM is arranged around that.
// ---------------------------------------------------------------------------

#include "core/nes/mapper.hpp"

#include <cstddef>
#include <utility>
#include <vector>

namespace fc::nes {

class Mapper177 : public Mapper {
public:
    Mapper177(std::vector<u8> prg, std::vector<u8> chr, Mirroring mirroring)
        : prg_(std::move(prg))
        , chr_(std::move(chr))
        , mirroring_(mirroring)
    {
    }

    void make_chr_ram(std::size_t size = 8192)
    {
        chr_.assign(size, 0);
        chr_ram_ = true;
    }

    [[nodiscard]] u8 read_prg(u16 address) override
    {
        if (prg_.empty()) {
            return 0;
        }
        const std::size_t banks = prg_bank_count();
        const std::size_t bank = static_cast<std::size_t>(prg_bank_) % banks;
        return prg_[bank * 0x8000u + static_cast<std::size_t>(address & 0x7FFFu)];
    }

    void write_prg(u16 /*address*/, u8 value) override
    {
        prg_bank_ = value;
        mirroring_ = ((value & 0x20u) != 0) ? Mirroring::Horizontal
                                            : Mirroring::Vertical;
    }

    [[nodiscard]] u8 read_chr(u16 address) override
    {
        if (chr_.empty()) {
            return 0;
        }
        return chr_[static_cast<std::size_t>(address) % chr_.size()];
    }

    void write_chr(u16 address, u8 value) override
    {
        if (chr_ram_) {
            chr_[static_cast<std::size_t>(address) % chr_.size()] = value;
        }
    }

    [[nodiscard]] Mirroring mirroring() const noexcept override { return mirroring_; }

    [[nodiscard]] u8 prg_bank() const noexcept { return prg_bank_; }

private:
    [[nodiscard]] std::size_t prg_bank_count() const noexcept
    {
        const std::size_t count = prg_.size() / 0x8000u;
        return (count == 0) ? 1 : count;
    }

    std::vector<u8> prg_;
    std::vector<u8> chr_;
    Mirroring mirroring_;
    bool chr_ram_ = false;
    u8 prg_bank_ = 0;
};

} // namespace fc::nes
