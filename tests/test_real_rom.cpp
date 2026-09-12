// ---------------------------------------------------------------------------
// Tests against a real NES ROM.
//
// Nothing here is committed: the tests look for a .nes file in tests/data/
// (or at the path in the FC_TEST_ROM environment variable) and skip
// themselves when there is none. That keeps the repository free of
// copyrighted data while still letting a real cartridge be used locally.
//
// To enable them:
//
//     ln -s /path/to/your.nes tests/data/game.nes
//
// ---------------------------------------------------------------------------

#include "core/cpu/cpu.hpp"
#include "core/cpu/disassembler.hpp"
#include "core/nes/bus.hpp"
#include "core/nes/cartridge.hpp"
#include "core/nes/ines.hpp"
#include "core/types.hpp"

#include <gtest/gtest.h>

#include <cstddef>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <optional>
#include <span>
#include <string>
#include <vector>

using namespace fc;

namespace {

std::optional<std::vector<u8>> read_file(const std::filesystem::path& path)
{
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        return std::nullopt;
    }
    return std::vector<u8>(std::istreambuf_iterator<char>(file),
                           std::istreambuf_iterator<char>());
}

/// The ROM to test against: the FC_TEST_ROM variable if set, otherwise the
/// first .nes file in the test data directory.
std::optional<std::vector<u8>> find_test_rom()
{
    if (const char* path = std::getenv("FC_TEST_ROM")) {
        if (auto bytes = read_file(path)) {
            return bytes;
        }
    }

    std::error_code error;
    const std::filesystem::path dir{ FC_TEST_DATA_DIR };
    if (std::filesystem::is_directory(dir, error)) {
        for (const auto& entry : std::filesystem::directory_iterator(dir, error)) {
            if (entry.path().extension() == ".nes") {
                if (auto bytes = read_file(entry.path())) {
                    return bytes;
                }
            }
        }
    }
    return std::nullopt;
}

/// A PPU that only knows how to say "vblank has started".
///
/// This is a test double, not a PPU. Its only job is to show that the ROM
/// gets past its vblank wait, which proves the loop is exactly what was
/// blocking it. The real PPU is Phase 4.
struct VblankStubPpu : nes::Device {
    int reads_of_status = 0;

    [[nodiscard]] u8 read(u16 address) override
    {
        if (nes::NesBus::ppu_register_index(address) == 2) {   // $2002 PPUSTATUS
            ++reads_of_status;
            return 0x80;   // bit 7: vblank has started
        }
        return 0;
    }

    void write(u16 /*address*/, u8 /*value*/) override {}
};

/// Super Mario Bros is NROM with 32KB of PRG and 8KB of CHR. Those are the
/// numbers this file checks against; a different ROM skips the whole suite.
constexpr std::size_t kSmbFileSize  = 16u + 32768u + 8192u;
constexpr u16 kSmbEntryPoint = 0x8000;
constexpr u16 kSmbVblankWait = 0x800A;
constexpr u16 kSmbNmiVector  = 0x8082;

class SuperMarioBros : public ::testing::Test {
protected:
    void SetUp() override
    {
        rom_ = find_test_rom();
        if (!rom_) {
            GTEST_SKIP() << "no .nes file in " << FC_TEST_DATA_DIR
                         << " - set FC_TEST_ROM or symlink one in to run this suite";
        }

        std::string error;
        auto cart = nes::Cartridge::from_bytes(*rom_, error);
        if (!cart) {
            GTEST_SKIP() << "the ROM could not be loaded: " << error;
        }

        const auto& h = cart->header();
        if (h.mapper != 0 || h.prg_rom_pages != 2 || h.chr_rom_pages != 1) {
            GTEST_SKIP() << "this suite assumes a 32KB/8KB mapper 0 ROM, found: "
                         << cart->summary();
        }

        cart_ = std::move(cart);
    }

    /// A bus with this cartridge plugged in.
    [[nodiscard]] nes::NesBus make_bus()
    {
        nes::NesBus bus;
        bus.set_cartridge(&*cart_);
        return bus;
    }

    std::optional<std::vector<u8>> rom_;
    std::optional<nes::Cartridge> cart_;
};

} // namespace

// ===========================================================================
// The file itself
// ===========================================================================

TEST_F(SuperMarioBros, TheFileIsAValidInesImage)
{
    const auto result = nes::parse_ines_header(*rom_);
    ASSERT_TRUE(result.ok()) << result.error;

    EXPECT_EQ(rom_->size(), kSmbFileSize);
    EXPECT_EQ(result.header->total_size(), kSmbFileSize);
}

TEST_F(SuperMarioBros, TheHeaderDescribesNrom)
{
    const auto& h = cart_->header();

    EXPECT_EQ(h.prg_rom_pages, 2) << "32KB of program";
    EXPECT_EQ(h.chr_rom_pages, 1) << "8KB of graphics";
    EXPECT_EQ(h.mapper, 0) << "NROM: no banking hardware on the board";
    EXPECT_EQ(h.mirroring, nes::Mirroring::Vertical);
    EXPECT_FALSE(h.has_trainer);
    EXPECT_FALSE(h.has_battery);
    EXPECT_FALSE(h.nes2) << "an original iNES file, not NES 2.0";

    EXPECT_EQ(cart_->prg_rom().size(), 32768u);
    EXPECT_EQ(cart_->chr_rom().size(), 8192u);
}

TEST_F(SuperMarioBros, TheInterruptVectorsPointAtRealCode)
{
    // The vectors are the last six bytes of PRG ROM, and the mapper puts them
    // at $FFFA-$FFFF.
    const u16 nmi  = static_cast<u16>(cart_->read(0xFFFA) | (cart_->read(0xFFFB) << 8));
    const u16 reset = static_cast<u16>(cart_->read(0xFFFC) | (cart_->read(0xFFFD) << 8));
    const u16 irq  = static_cast<u16>(cart_->read(0xFFFE) | (cart_->read(0xFFFF) << 8));

    EXPECT_EQ(reset, kSmbEntryPoint);
    EXPECT_EQ(nmi, kSmbNmiVector);

    // Every vector must point at cartridge space, or the machine would jump
    // into RAM and execute whatever happens to be there.
    EXPECT_GE(reset, 0x8000);
    EXPECT_GE(nmi, 0x8000);
    EXPECT_GE(irq, 0x8000);
}

TEST_F(SuperMarioBros, EveryPrgByteReadsBackThroughTheMapper)
{
    const auto& prg = cart_->prg_rom();
    int mismatches = 0;

    for (std::size_t i = 0; i < prg.size(); ++i) {
        const u16 address = static_cast<u16>(0x8000 + i);
        if (cart_->read(address) != prg[i]) {
            ++mismatches;
        }
    }

    EXPECT_EQ(mismatches, 0) << "32KB mapped straight through, byte for byte";
}

// ===========================================================================
// The reset code
// ===========================================================================

TEST_F(SuperMarioBros, TheResetCodeIsTheRealStartupSequence)
{
    // 78          SEI               disable interrupts while we set up
    // D8          CLD               clear decimal mode
    // A9 10       LDA #$10
    // 8D 00 20    STA $2000         PPUCTRL: NMI on, background pattern table
    // A2 FF       LDX #$FF
    // 9A          TXS               SP = $FF
    // AD 02 20    LDA $2002         <- wait for vblank
    // 10 FB       BPL $800A
    const std::vector<u8> expected = {
        0x78, 0xD8, 0xA9, 0x10, 0x8D, 0x00, 0x20,
        0xA2, 0xFF, 0x9A, 0xAD, 0x02, 0x20, 0x10, 0xFB,
    };

    for (std::size_t i = 0; i < expected.size(); ++i) {
        const u16 address = static_cast<u16>(kSmbEntryPoint + i);
        EXPECT_EQ(cart_->read(address), expected[i])
            << "byte " << i << " at $" << std::hex << address;
    }
}

TEST_F(SuperMarioBros, TheResetRoutineDisassemblesReadably)
{
    // The project's own disassembler, reading a real cartridge. This is the
    // first time the whole toolchain touches a commercial ROM.
    nes::NesBus bus = make_bus();

    const std::vector<std::string> expected = {
        "SEI",
        "CLD",
        "LDA #$10",
        "STA $2000",
        "LDX #$FF",
        "TXS",
        "LDA $2002",
        "BPL $800A",
    };

    std::size_t offset = 0;
    for (const auto& text : expected) {
        const u16 address = static_cast<u16>(kSmbEntryPoint + offset);
        const auto insn = disassemble(bus, address);
        EXPECT_EQ(insn.text, text) << "at $" << std::hex << address;
        offset += static_cast<std::size_t>(insn.length);
    }
}

// ===========================================================================
// Running it
// ===========================================================================

TEST_F(SuperMarioBros, TheCpuExecutesTheRealStartupCode)
{
    nes::NesBus bus = make_bus();
    Cpu cpu{ bus };
    cpu.reset();

    // Reset already sets I and clears D, so make both wrong to prove the
    // instructions really change them.
    cpu.registers().set_flag(Flag::IrqDisable, false);
    cpu.registers().set_flag(Flag::Decimal, true);

    EXPECT_EQ(cpu.registers().pc, kSmbEntryPoint);

    cpu.step();   // 78 SEI
    EXPECT_TRUE(cpu.registers().flag(Flag::IrqDisable));
    EXPECT_TRUE(cpu.registers().flag(Flag::Decimal)) << "SEI must not touch D";

    cpu.step();   // D8 CLD
    EXPECT_FALSE(cpu.registers().flag(Flag::Decimal));

    cpu.step();   // A9 10 LDA #$10
    EXPECT_EQ(cpu.registers().a, 0x10);

    cpu.step();   // 8D 00 20 STA $2000
    cpu.step();   // A2 FF LDX #$FF
    EXPECT_EQ(cpu.registers().x, 0xFF);

    cpu.step();   // 9A TXS
    EXPECT_EQ(cpu.registers().sp, 0xFF)
        << "the stack was reset to the top of page 1";

    EXPECT_FALSE(cpu.is_halted());
}

TEST_F(SuperMarioBros, WithoutAPpuItSpinsOnTheVblankWait)
{
    nes::NesBus bus = make_bus();
    Cpu cpu{ bus };
    cpu.reset();

    cpu.run(8);

    // Steps 7 and 8 were LDA $2002 and BPL, so PC is back at $800A.
    EXPECT_EQ(cpu.registers().pc, kSmbVblankWait);

    const u64 cycles_before = cpu.total_cycles();
    cpu.run(1000);

    EXPECT_TRUE(cpu.registers().pc == kSmbVblankWait ||
                cpu.registers().pc == static_cast<u16>(kSmbVblankWait + 3))
        << "still looping between LDA $2002 and BPL, at " << cpu.registers().pc;

    EXPECT_GT(cpu.total_cycles(), cycles_before) << "and it is still burning cycles";
    EXPECT_FALSE(cpu.is_halted()) << "a wait loop is not a crash";
}

TEST_F(SuperMarioBros, WithAStubPpuItLeavesTheWait)
{
    nes::NesBus bus = make_bus();
    VblankStubPpu ppu;
    bus.set_ppu(&ppu);

    Cpu cpu{ bus };
    cpu.reset();
    cpu.run(8);

    // LDA $2002 now returns $80, so N is set and BPL falls through.
    EXPECT_EQ(cpu.registers().pc, static_cast<u16>(kSmbVblankWait + 5))
        << "past the BPL, at $800F";
    EXPECT_GT(ppu.reads_of_status, 0);
}

TEST_F(SuperMarioBros, TheVblankWaitIsExactlyWhatWasBlocking)
{
    // Same ROM, same bus, same number of instructions. The only difference is
    // whether something answers $2002 with the vblank bit set. That isolates
    // the boundary between "the CPU and cartridge work" and "there is no PPU
    // yet" - which is precisely the Phase 3 / Phase 4 line.
    constexpr int kSteps = 8;

    nes::NesBus bus_a = make_bus();
    Cpu cpu_a{ bus_a };
    cpu_a.reset();
    cpu_a.run(kSteps);

    nes::NesBus bus_b = make_bus();
    VblankStubPpu ppu;
    bus_b.set_ppu(&ppu);
    Cpu cpu_b{ bus_b };
    cpu_b.reset();
    cpu_b.run(kSteps);

    EXPECT_EQ(cpu_a.registers().pc, kSmbVblankWait) << "blocked";
    EXPECT_EQ(cpu_b.registers().pc, static_cast<u16>(kSmbVblankWait + 5)) << "free";

    // SP and X are the same: both machines ran exactly the same setup. A
    // differs, and that is the whole point - the only difference between the
    // two runs is what answered $2002.
    //
    // With no PPU, the read returns open bus. Note the value is $20, not $10
    // (the last thing WRITTEN): the operand fetch for $2002 drove the data bus
    // after that write, and open bus holds whatever was on it most recently.
    EXPECT_EQ(cpu_a.registers().sp, cpu_b.registers().sp);
    EXPECT_EQ(cpu_a.registers().x, cpu_b.registers().x);
    EXPECT_EQ(cpu_a.registers().a, 0x20)
        << "open bus: the high byte of the $2002 operand, which is the last "
           "byte the CPU put on the data bus";
    EXPECT_EQ(cpu_b.registers().a, 0x80) << "the vblank bit";

    // And that single bit is the difference between a running machine and a
    // hung one, because BPL tests exactly it.
    EXPECT_FALSE(cpu_a.registers().flag(Flag::Negative)) << "so BPL loops";
    EXPECT_TRUE(cpu_b.registers().flag(Flag::Negative)) << "so BPL falls through";
}

// ===========================================================================
// The graphics data
// ===========================================================================

TEST_F(SuperMarioBros, ChrRomHoldsPatternTableData)
{
    const auto& chr = cart_->chr_rom();
    ASSERT_EQ(chr.size(), 8192u);

    // 512 tiles of 16 bytes each.
    EXPECT_EQ(chr.size() / 16, 512u);

    int non_zero_tiles = 0;
    for (std::size_t tile = 0; tile < 512; ++tile) {
        const std::span<const u8> bytes(chr.data() + tile * 16, 16);
        for (u8 byte : bytes) {
            if (byte != 0) {
                ++non_zero_tiles;
                break;
            }
        }
    }

    EXPECT_GT(non_zero_tiles, 100) << "a CHR bank should be mostly real tiles";
    EXPECT_LT(non_zero_tiles, 512) << "and should still have some blank ones";
}

TEST_F(SuperMarioBros, ChrReadsBackThroughTheMapper)
{
    for (u16 address = 0; address < 8192; address += 37) {
        EXPECT_EQ(cart_->read_chr(address), cart_->chr_rom()[address]);
    }
}
