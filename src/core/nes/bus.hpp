#pragma once

// ---------------------------------------------------------------------------
// The NES bus: address decoding.
//
// The CPU puts a 16 bit address on the wires. Something has to decide which
// chip answers. That decision is the memory map:
//
//   $0000 - $07FF   2KB work RAM
//   $0800 - $1FFF   RAM again, 3 more times (mirroring, see ram.hpp)
//   $2000 - $3FFF   PPU registers, 8 of them, mirrored every 8 bytes
//   $4000 - $4017   APU, controllers, and OAM DMA at $4014
//   $4018 - $401F   disabled
//   $4020 - $FFFF   the cartridge slot
//
// Two of those ranges are themselves examples of incomplete decoding:
//
//   * $0000-$1FFF is 8KB feeding a 2KB chip, so the RAM answers four times.
//   * $2000-$3FFF is 8KB feeding 8 registers, so each register answers
//     1024 times.
//
// Neither is a bug. Nobody wanted to spend gates decoding bits that only had
// one possible value anyway.
//
// Open bus
// --------
// Reading an address with nothing behind it does not give zero on a real NES.
// The data bus is a set of wires with capacitance, and they keep the last
// value that was driven onto them. So an unmapped read returns whatever was
// last written or read. Some games depend on this, so we model it.
// ---------------------------------------------------------------------------

#include "core/bus.hpp"
#include "core/nes/device.hpp"
#include "core/nes/ram.hpp"
#include "core/types.hpp"

namespace fc::nes {

class NesBus : public Bus {
public:
    NesBus() = default;

    [[nodiscard]] u8 read(u16 address) override;
    void write(u16 address, u8 value) override;
    int take_stall_cycles() override;

    // -- the chips -----------------------------------------------------------

    [[nodiscard]] Ram& ram() noexcept { return ram_; }
    [[nodiscard]] const Ram& ram() const noexcept { return ram_; }

    /// The cartridge slot, $4020-$FFFF. Phase 3.
    void set_cartridge(Device* device) noexcept { cartridge_ = device; }

    /// The PPU register window, $2000-$3FFF. Phase 4.
    void set_ppu(Device* device) noexcept { ppu_ = device; }

    /// APU and I/O, $4000-$4017 except $4014. Phase 5 and 6.
    void set_apu(Device* device) noexcept { apu_ = device; }

    /// Where OAM DMA writes. Phase 4 makes the PPU implement this.
    void set_oam_target(OamTarget* target) noexcept { oam_target_ = target; }

    // -- observability -------------------------------------------------------

    /// The last byte that was on the data bus.
    [[nodiscard]] u8 open_bus() const noexcept { return open_bus_; }

    /// How many OAM DMAs have run. Useful in tests and the debugger.
    [[nodiscard]] int oam_dma_count() const noexcept { return oam_dma_count_; }

    // -- address decoding, exposed so it can be tested directly --------------

    /// Which named region does this address fall in?
    enum class Region : u8 {
        Ram,          // $0000-$1FFF
        PpuRegisters, // $2000-$3FFF
        ApuAndIo,     // $4000-$4017
        Disabled,     // $4018-$401F
        Cartridge,    // $4020-$FFFF
    };

    [[nodiscard]] static Region region_of(u16 address) noexcept;

    /// The PPU register index for an address in $2000-$3FFF.
    /// Three address lines reach the PPU, so the index is the low 3 bits.
    [[nodiscard]] static u8 ppu_register_index(u16 address) noexcept;

private:
    [[nodiscard]] u8 decode_read(u16 address);
    void start_oam_dma(u8 page);

    Ram ram_{};

    Device* cartridge_ = nullptr;
    Device* ppu_ = nullptr;
    Device* apu_ = nullptr;
    OamTarget* oam_target_ = nullptr;

    u8 open_bus_ = 0;
    int pending_stalls_ = 0;
    int oam_dma_count_ = 0;
};

} // namespace fc::nes
