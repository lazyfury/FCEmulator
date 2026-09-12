#include "core/cpu/cpu.hpp"
#include "core/cpu/disassembler.hpp"
#include "core/nes/bus.hpp"
#include "core/nes/cartridge.hpp"
#include "core/nes/ines.hpp"
#include "core/nes/mapper0.hpp"
#include "core/nes/ram_cartridge.hpp"
#include "core/types.hpp"

#include <gtest/gtest.h>

#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <vector>

using namespace fc;

namespace {

/// Build a synthetic iNES image: header + PRG + CHR.
/// PRG byte i is (i & 0xFF), CHR byte i is ((i * 3) & 0xFF), so every byte is
/// predictable and a copy that is off by one is immediately visible.
std::vector<u8> make_ines(u8 prg_pages, u8 chr_pages, u8 flags6 = 0, u8 flags7 = 0,
                          std::span<const u8> trainer = {})
{
    std::vector<u8> rom;
    rom.reserve(16 + trainer.size() + std::size_t(prg_pages) * 16384u
                + std::size_t(chr_pages) * 8192u);

    rom.push_back('N');
    rom.push_back('E');
    rom.push_back('S');
    rom.push_back(0x1A);
    rom.push_back(prg_pages);
    rom.push_back(chr_pages);
    rom.push_back(flags6);
    rom.push_back(flags7);
    for (int i = 0; i < 8; ++i) {
        rom.push_back(0);
    }

    rom.insert(rom.end(), trainer.begin(), trainer.end());

    for (std::size_t i = 0; i < std::size_t(prg_pages) * 16384u; ++i) {
        rom.push_back(static_cast<u8>(i & 0xFFu));
    }
    for (std::size_t i = 0; i < std::size_t(chr_pages) * 8192u; ++i) {
        rom.push_back(static_cast<u8>((i * 3u) & 0xFFu));
    }
    return rom;
}

/// A 32KB PRG ROM holding `program` at `origin`, with the vectors pointed at it.
std::vector<u8> make_program_rom(std::span<const u8> program, u16 origin = 0x8000)
{
    std::vector<u8> rom = make_ines(2, 1);

    for (std::size_t i = 0; i < program.size(); ++i) {
        rom[16 + (origin - 0x8000) + i] = program[i];
    }
    rom[16 + 0x7FFC] = static_cast<u8>(origin & 0x00FF);
    rom[16 + 0x7FFD] = static_cast<u8>(origin >> 8);
    return rom;
}

std::optional<nes::Cartridge> load(std::span<const u8> rom, std::string& error)
{
    return nes::Cartridge::from_bytes(rom, error);
}

} // namespace

// ===========================================================================
// Header parsing
// ===========================================================================

TEST(Ines, ReadsTheBasicFields)
{
    const std::vector<u8> rom = make_ines(2, 1);
    const auto result = nes::parse_ines_header(rom);

    ASSERT_TRUE(result.ok()) << result.error;
    const auto& h = *result.header;

    EXPECT_EQ(h.prg_rom_pages, 2);
    EXPECT_EQ(h.chr_rom_pages, 1);
    EXPECT_EQ(h.prg_rom_size(), 32768u);
    EXPECT_EQ(h.chr_rom_size(), 8192u);
    EXPECT_EQ(h.total_size(), rom.size());
    EXPECT_EQ(h.mapper, 0);
}

TEST(Ines, RejectsAFileThatIsTooShortForAHeader)
{
    const std::vector<u8> tiny = { 'N', 'E', 'S' };
    const auto result = nes::parse_ines_header(tiny);

    EXPECT_FALSE(result.ok());
    EXPECT_NE(result.error.find("shorter"), std::string::npos);
}

TEST(Ines, RejectsAWrongSignature)
{
    std::vector<u8> rom = make_ines(2, 1);
    rom[3] = 0x00;   // break the 0x1A

    const auto result = nes::parse_ines_header(rom);
    EXPECT_FALSE(result.ok());
    EXPECT_NE(result.error.find("signature"), std::string::npos);
}

TEST(Ines, RejectsAZipFileThatHappensToBeBigEnough)
{
    // A PK zip starts with "PK\x03\x04", which is not "NES\x1A".
    std::vector<u8> rom(64, 0);
    rom[0] = 'P';
    rom[1] = 'K';
    rom[2] = 0x03;
    rom[3] = 0x04;

    const auto result = nes::parse_ines_header(rom);
    EXPECT_FALSE(result.ok());
}

TEST(Ines, RejectsAHeaderClaimingZeroPrgPages)
{
    std::vector<u8> rom = make_ines(2, 1);
    rom[4] = 0;

    const auto result = nes::parse_ines_header(rom);
    EXPECT_FALSE(result.ok());
    EXPECT_NE(result.error.find("PRG"), std::string::npos);
}

TEST(Ines, RejectsATruncatedDump)
{
    std::vector<u8> rom = make_ines(2, 1);
    rom.resize(rom.size() - 100);   // the header still claims the full size

    const auto result = nes::parse_ines_header(rom);
    EXPECT_FALSE(result.ok());
    EXPECT_NE(result.error.find("shorter than"), std::string::npos);
}

TEST(Ines, MirroringComesFromBit0OfFlags6)
{
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x00)).header->mirroring,
              nes::Mirroring::Horizontal);
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x01)).header->mirroring,
              nes::Mirroring::Vertical);
    // Bit 3 overrides bit 0.
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x09)).header->mirroring,
              nes::Mirroring::FourScreen);
}

TEST(Ines, MapperNumberIsSplitAcrossTwoBytes)
{
    // mapper 3   -> flags6 high nibble 3, flags7 high nibble 0
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x30, 0x00)).header->mapper, 3);
    // mapper 4   -> flags6 high nibble 4
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x40, 0x00)).header->mapper, 4);
    // mapper 0x21 -> low nibble 1 in flags6, high nibble 2 in flags7
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x10, 0x20)).header->mapper, 0x21);
    // mapper 0xF0 -> high nibble F in flags7
    EXPECT_EQ(nes::parse_ines_header(make_ines(1, 1, 0x00, 0xF0)).header->mapper, 0xF0);
}

TEST(Ines, BatteryAndTrainerFlags)
{
    // Battery: no extra data, so the size still adds up.
    const auto battery = nes::parse_ines_header(make_ines(1, 1, 0x02));
    ASSERT_TRUE(battery.ok()) << battery.error;
    EXPECT_TRUE(battery.header->has_battery);
    EXPECT_FALSE(battery.header->has_trainer);

    // Trainer: the flag promises 512 extra bytes after the header, so the
    // file has to actually contain them or the size check rejects it.
    const std::vector<u8> trainer(512, 0x00);
    const auto trained = nes::parse_ines_header(make_ines(1, 1, 0x04, 0x00, trainer));
    ASSERT_TRUE(trained.ok()) << trained.error;
    EXPECT_TRUE(trained.header->has_trainer);
    EXPECT_FALSE(trained.header->has_battery);

    // With the flag set but the bytes missing, parsing must fail rather than
    // silently reading the PRG ROM out of position.
    const auto broken = nes::parse_ines_header(make_ines(1, 1, 0x04));
    EXPECT_FALSE(broken.ok()) << "a trainer flag without the bytes is a bad dump";
}

TEST(Ines, TrainerShiftsTheRomDataBy512Bytes)
{
    // A trainer is 512 bytes between the header and the PRG ROM.
    std::vector<u8> trainer(512, 0xEE);
    const std::vector<u8> rom = make_ines(1, 1, 0x04, 0x00, trainer);

    const auto header = nes::parse_ines_header(rom);
    ASSERT_TRUE(header.ok()) << header.error;
    EXPECT_TRUE(header.header->has_trainer);
    EXPECT_EQ(header.header->trainer_size(), 512u);
    EXPECT_EQ(header.header->total_size(), rom.size());

    std::string error;
    auto cart = load(rom, error);
    ASSERT_TRUE(cart.has_value()) << error;

    EXPECT_EQ(cart->trainer().size(), 512u);
    EXPECT_EQ(cart->trainer()[0], 0xEE);

    // PRG byte 0 must be 0, not the first trainer byte.
    EXPECT_EQ(cart->prg_rom()[0], 0x00);
    EXPECT_EQ(cart->prg_rom()[1], 0x01);
}

// ===========================================================================
// Mapper 0: NROM
// ===========================================================================

TEST(Mapper0, ThirtyTwoKilobytesMapsStraightThrough)
{
    std::string error;
    auto cart = load(make_ines(2, 1), error);
    ASSERT_TRUE(cart.has_value()) << error;

    int mismatches = 0;
    for (std::size_t i = 0; i < 32768; ++i) {
        const u16 address = static_cast<u16>(0x8000 + i);
        if (cart->read(address) != static_cast<u8>(i & 0xFFu)) {
            ++mismatches;
        }
    }
    EXPECT_EQ(mismatches, 0);
}

TEST(Mapper0, SixteenKilobytesMirrorsIntoBothHalves)
{
    std::string error;
    auto cart = load(make_ines(1, 1), error);
    ASSERT_TRUE(cart.has_value()) << error;

    // $8000-$BFFF and $C000-$FFFF are the same 16KB. This is a third kind of
    // mirroring, and like the others it comes from an address line nobody
    // bothered to decode.
    int mismatches = 0;
    for (u16 offset = 0; offset < 0x4000; ++offset) {
        const u8 low = cart->read(static_cast<u16>(0x8000 + offset));
        const u8 high = cart->read(static_cast<u16>(0xC000 + offset));
        if (low != high) {
            ++mismatches;
        }
        if (low != static_cast<u8>(offset & 0xFF)) {
            ++mismatches;
        }
    }
    EXPECT_EQ(mismatches, 0);
}

TEST(Mapper0, WritesToPrgRomGoNowhere)
{
    std::string error;
    auto cart = load(make_ines(2, 1), error);
    ASSERT_TRUE(cart.has_value()) << error;

    const u8 before = cart->read(0x8000);
    cart->write(0x8000, 0x55);

    EXPECT_EQ(cart->read(0x8000), before) << "NROM has no bank register";
}

TEST(Mapper0, ChrRomIsReadOnly)
{
    std::string error;
    auto cart = load(make_ines(1, 1), error);
    ASSERT_TRUE(cart.has_value()) << error;

    const u8 before = cart->read_chr(0x0010);
    cart->write_chr(0x0010, 0x99);

    EXPECT_EQ(cart->read_chr(0x0010), before) << "CHR ROM, not RAM";
    EXPECT_EQ(cart->header().chr_rom_pages, 1);
}

TEST(Mapper0, ZeroChrPagesMeansChrRam)
{
    std::string error;
    auto cart = load(make_ines(1, 0), error);
    ASSERT_TRUE(cart.has_value()) << error;

    EXPECT_EQ(cart->header().chr_rom_pages, 0);
    EXPECT_EQ(cart->chr_rom().size(), 0u);

    // With CHR RAM the pattern tables start empty and can be written.
    EXPECT_EQ(cart->read_chr(0x0010), 0x00);
    cart->write_chr(0x0010, 0x99);
    EXPECT_EQ(cart->read_chr(0x0010), 0x99);
}

// ===========================================================================
// Cartridge as a device on the bus
// ===========================================================================

TEST(Cartridge, PrgRamAtSixThousandIsWritable)
{
    std::string error;
    auto cart = load(make_ines(1, 1), error);
    ASSERT_TRUE(cart.has_value()) << error;

    EXPECT_TRUE(cart->has_prg_ram());

    cart->write(0x6000, 0x11);
    cart->write(0x7FFF, 0x22);

    EXPECT_EQ(cart->read(0x6000), 0x11);
    EXPECT_EQ(cart->read(0x7FFF), 0x22);
    EXPECT_EQ(cart->read(0x6001), 0x00);
}

TEST(Cartridge, RejectsAnUnimplementedMapper)
{
    std::string error;
    // mapper 3 (CNROM) is not written yet.
    auto cart = load(make_ines(2, 1, 0x30), error);

    EXPECT_FALSE(cart.has_value());
    EXPECT_NE(error.find("mapper 3"), std::string::npos);
    EXPECT_NE(error.find("not implemented"), std::string::npos);
}

TEST(Cartridge, PlugsIntoTheBusAndAnswersTheResetVector)
{
    const std::vector<u8> program = { 0xEA, 0xEA, 0xEA, 0xEA };
    const std::vector<u8> rom = make_program_rom(program, 0x8000);

    std::string error;
    auto cart = load(rom, error);
    ASSERT_TRUE(cart.has_value()) << error;

    nes::NesBus bus;
    bus.set_cartridge(&*cart);

    EXPECT_EQ(bus.read(0xFFFC), 0x00);
    EXPECT_EQ(bus.read(0xFFFD), 0x80);

    Cpu cpu{ bus };
    cpu.reset();
    EXPECT_EQ(cpu.registers().pc, 0x8000);
}

TEST(Cartridge, RunsAProgramThroughTheBus)
{
    // LDA #$2A ; STA $10 ; LDX #$05 ; STA $20,X ; JMP self
    const std::vector<u8> program = {
        0xA9, 0x2A,
        0x85, 0x10,
        0xA2, 0x05,
        0x95, 0x20,
        0x4C, 0x08, 0x80,
    };
    const std::vector<u8> rom = make_program_rom(program, 0x8000);

    std::string error;
    auto cart = load(rom, error);
    ASSERT_TRUE(cart.has_value()) << error;

    nes::NesBus bus;
    bus.set_cartridge(&*cart);

    Cpu cpu{ bus };
    cpu.reset();
    cpu.run(4);

    EXPECT_EQ(bus.ram().read(0x0010), 0x2A);
    EXPECT_EQ(bus.ram().read(0x0025), 0x2A);
    EXPECT_FALSE(cpu.is_halted());
}

TEST(Cartridge, SummaryDescribesTheRom)
{
    std::string error;
    auto cart = load(make_ines(2, 1, 0x01), error);
    ASSERT_TRUE(cart.has_value()) << error;

    const std::string text = cart->summary();
    EXPECT_NE(text.find("mapper 0"), std::string::npos);
    EXPECT_NE(text.find("2x16KB PRG"), std::string::npos);
    EXPECT_NE(text.find("1x8KB CHR"), std::string::npos);
    EXPECT_NE(text.find("vertical"), std::string::npos);
}

// ===========================================================================
// The Cartridge must be a drop-in replacement for RamCartridge
// ===========================================================================

TEST(Cartridge, InterchangesWithTheRamCartridgePlaceholder)
{
    const std::vector<u8> program = { 0xA9, 0x7F };
    const std::vector<u8> rom = make_program_rom(program, 0x8000);

    std::string error;
    auto cart = load(rom, error);
    ASSERT_TRUE(cart.has_value()) << error;

    nes::NesBus bus;
    bus.set_cartridge(&*cart);   // the same slot RamCartridge used

    Cpu cpu{ bus };
    cpu.reset();
    cpu.step();

    EXPECT_EQ(cpu.registers().a, 0x7F);
}
