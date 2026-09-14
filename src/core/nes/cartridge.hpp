#pragma once

// ---------------------------------------------------------------------------
// Cartridge - a .nes file turned into something the bus can talk to.
//
// It plugs into the bus's cartridge slot ($4020-$FFFF) and splits that range:
//
//     $4020-$5FFF   expansion area          (nothing on NROM carts)
//     $6000-$7FFF   PRG RAM                 (8KB of save/work memory)
//     $8000-$FFFF   PRG ROM, via the mapper
//
// The CHR ROM is not reachable from the CPU at all. It answers on the PPU's
// own bus, which is why read_chr/write_chr are separate functions rather than
// part of Device.
//
// Loading a ROM is a five step job, and each step is a place a real dump can
// go wrong:
//
//   1. parse the 16 byte header
//   2. skip the 512 byte trainer if the header says there is one
//   3. copy PRG ROM
//   4. copy CHR ROM, or allocate CHR RAM when the header says zero pages
//   5. pick a mapper from the header's mapper number
// ---------------------------------------------------------------------------

#include "core/state_fwd.hpp"
#include "core/nes/device.hpp"
#include "core/nes/ines.hpp"
#include "core/nes/mapper.hpp"
#include "core/types.hpp"

#include <cstddef>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace fc::nes {

class Cartridge : public Device {
public:
    static constexpr u16 kExpansionEnd = 0x5FFF;   // $4020-$5FFF
    static constexpr u16 kPrgRamBase   = 0x6000;   // $6000-$7FFF
    static constexpr u16 kPrgRamEnd    = 0x7FFF;
    static constexpr std::size_t kPrgRamSize = 0x2000;   // 8KB

    /// Build a cartridge from the bytes of a .nes file.
    ///
    /// Returns nothing on failure and fills `error` with the reason. Failures
    /// are normal here - the file might be a zip, a truncated dump, or use a
    /// mapper we have not written yet - so they are values, not exceptions.
    [[nodiscard]] static std::optional<Cartridge> from_bytes(std::span<const u8> rom,
                                                             std::string& error);

    // -- Device, the CPU's side ----------------------------------------------

    [[nodiscard]] u8 read(u16 address) override;
    void write(u16 address, u8 value) override;

    // -- the PPU's side ------------------------------------------------------

    [[nodiscard]] u8 read_chr(u16 address);
    void write_chr(u16 address, u8 value);

    // -- inspection ----------------------------------------------------------

    [[nodiscard]] const InesHeader& header() const noexcept { return header_; }
    [[nodiscard]] Mapper& mapper() noexcept { return *mapper_; }
    [[nodiscard]] const Mapper& mapper() const noexcept { return *mapper_; }

    [[nodiscard]] const std::vector<u8>& prg_rom() const noexcept { return prg_rom_; }
    [[nodiscard]] const std::vector<u8>& chr_rom() const noexcept { return chr_rom_; }
    [[nodiscard]] const std::vector<u8>& trainer() const noexcept { return trainer_; }

    [[nodiscard]] bool has_prg_ram() const noexcept { return prg_ram_enabled_; }
    void set_prg_ram_enabled(bool enabled) noexcept { prg_ram_enabled_ = enabled; }

    /// A one line summary, for tooling.
    [[nodiscard]] std::string summary() const;

private:
    Cartridge() = default;

    InesHeader header_{};
    std::vector<u8> trainer_;
    std::vector<u8> prg_rom_;
    std::vector<u8> chr_rom_;
    std::vector<u8> prg_ram_ = std::vector<u8>(kPrgRamSize, 0);
    std::unique_ptr<Mapper> mapper_;
    bool prg_ram_enabled_ = true;

    friend struct fc::StateAccess;
};

} // namespace fc::nes
