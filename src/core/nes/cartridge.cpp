#include "core/nes/cartridge.hpp"

#include "core/nes/mapper0.hpp"

namespace fc::nes {

namespace {

/// Copy a slice of the file into its own vector.
std::vector<u8> slice(std::span<const u8> rom, std::size_t offset, std::size_t size)
{
    if (offset >= rom.size()) {
        return {};
    }
    const std::size_t available = rom.size() - offset;
    const std::size_t take = (size < available) ? size : available;
    return std::vector<u8>(rom.begin() + static_cast<std::ptrdiff_t>(offset),
                           rom.begin() + static_cast<std::ptrdiff_t>(offset + take));
}

} // namespace

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

std::optional<Cartridge> Cartridge::from_bytes(std::span<const u8> rom, std::string& error)
{
    const InesParseResult parsed = parse_ines_header(rom);
    if (!parsed.ok()) {
        error = parsed.error;
        return std::nullopt;
    }
    const InesHeader header = *parsed.header;

    Cartridge cart;
    cart.header_ = header;

    // 1. the header is 16 bytes, then optionally a trainer.
    std::size_t offset = 16;
    if (header.has_trainer) {
        cart.trainer_ = slice(rom, offset, 512);
        offset += 512;
    }

    // 2. PRG ROM.
    cart.prg_rom_ = slice(rom, offset, header.prg_rom_size());
    offset += header.prg_rom_size();

    // 3. CHR ROM. Zero pages means the cartridge has CHR RAM instead, which
    //    games use to rewrite the pattern tables while they run.
    cart.chr_rom_ = slice(rom, offset, header.chr_rom_size());

    // 4. the mapper.
    switch (header.mapper) {
    case 0: {
        auto mapper = std::make_unique<Mapper0>(
            cart.prg_rom_, cart.chr_rom_, header.mirroring);
        if (header.chr_rom_pages == 0) {
            mapper->make_chr_ram();
        }
        cart.mapper_ = std::move(mapper);
        break;
    }

    default:
        error = "mapper " + std::to_string(header.mapper) +
                " is not implemented yet (only mapper 0 / NROM)";
        return std::nullopt;
    }

    return cart;
}

// ---------------------------------------------------------------------------
// The CPU's side
// ---------------------------------------------------------------------------

u8 Cartridge::read(u16 address)
{
    if (address <= kExpansionEnd) {
        // The expansion area is where cartridges with extra audio hardware
        // put their registers. NROM has none. On real hardware an unused
        // expansion address returns open bus; this returns zero and leaves
        // that subtlety to the bus.
        return 0;
    }

    if (address <= kPrgRamEnd) {
        if (!prg_ram_enabled_) {
            return 0;
        }
        return prg_ram_[static_cast<std::size_t>(address - kPrgRamBase) % prg_ram_.size()];
    }

    return mapper_->read_prg(address);
}

void Cartridge::write(u16 address, u8 value)
{
    if (address <= kExpansionEnd) {
        return;
    }

    if (address <= kPrgRamEnd) {
        if (!prg_ram_enabled_) {
            return;
        }
        prg_ram_[static_cast<std::size_t>(address - kPrgRamBase) % prg_ram_.size()] = value;
        return;
    }

    // On NROM this goes nowhere. On a banking cartridge this is where the
    // mapper listens: the address and value are the bank switch command.
    mapper_->write_prg(address, value);
}

// ---------------------------------------------------------------------------
// The PPU's side
// ---------------------------------------------------------------------------

u8 Cartridge::read_chr(u16 address)
{
    return mapper_->read_chr(address);
}

void Cartridge::write_chr(u16 address, u8 value)
{
    mapper_->write_chr(address, value);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

std::string Cartridge::summary() const
{
    std::string out;
    out += "mapper " + std::to_string(header_.mapper);
    out += ", ";
    out += std::to_string(header_.prg_rom_pages) + "x16KB PRG";
    out += " (" + std::to_string(prg_rom_.size()) + " bytes)";

    if (header_.chr_rom_pages == 0) {
        out += ", 8KB CHR RAM";
    } else {
        out += ", " + std::to_string(header_.chr_rom_pages) + "x8KB CHR";
        out += " (" + std::to_string(chr_rom_.size()) + " bytes)";
    }

    out += ", ";
    out += mirroring_name(header_.mirroring);

    if (header_.has_battery) {
        out += ", battery";
    }
    if (header_.has_trainer) {
        out += ", trainer";
    }
    return out;
}

} // namespace fc::nes
