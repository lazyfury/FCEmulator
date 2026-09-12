#include "core/cpu/cpu.hpp"

#include "core/bit.hpp"

namespace fc {

// ---------------------------------------------------------------------------
// Addresses that matter at power-on
// ---------------------------------------------------------------------------

namespace {
constexpr u16 kResetVector = 0xFFFC; // $FFFC-$FFFD hold the entry address
constexpr u16 kStackPage   = 0x0100; // the stack lives only in page 1
} // namespace

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

void Cpu::reset() noexcept
{
    reg_.reset();

    // The 6502 does not start at 0. It reads a 16 bit address from the reset
    // vector and jumps there. Two bytes, little endian:
    //
    //     [$FFFC] = 0x00
    //     [$FFFD] = 0x80
    //     -> entry point 0x8000
    //
    // That is exactly bit::make_u16(lo, hi).
    const u8 lo = read(kResetVector);
    const u8 hi = read(static_cast<u16>(kResetVector + 1));
    reg_.pc = bit::make_u16(lo, hi);

    cycles_ = 0;
    halted_ = false;
    unimplemented_opcode_ = 0;
    instruction_pc_ = reg_.pc;
    last_opcode_ = 0;
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

u8 Cpu::fetch_byte() noexcept
{
    // Read the byte the PC points at, then move PC to the next byte.
    // Because PC is u16 it wraps 0xFFFF -> 0x0000 on its own, just like the
    // 16 wire address bus of the real chip.
    return read(reg_.pc++);
}

u16 Cpu::fetch_word() noexcept
{
    const u8 lo = fetch_byte();
    const u8 hi = fetch_byte();
    return bit::make_u16(lo, hi);
}

// ---------------------------------------------------------------------------
// stack
// ---------------------------------------------------------------------------

void Cpu::push(u8 value) noexcept
{
    // Store at $0100 + SP, then move SP down. The stack grows downward.
    write(static_cast<u16>(kStackPage | reg_.sp), value);
    reg_.sp = static_cast<u8>(reg_.sp - 1u);
}

u8 Cpu::pop() noexcept
{
    // The mirror image: move SP up first, then read.
    reg_.sp = static_cast<u8>(reg_.sp + 1u);
    return read(static_cast<u16>(kStackPage | reg_.sp));
}

// ---------------------------------------------------------------------------
// step - one full fetch/decode/execute round
// ---------------------------------------------------------------------------

int Cpu::step() noexcept
{
    if (halted_) {
        return 0;
    }

    const u64 cycles_before = cycles_;

    // fetch: remember where this instruction started (for debugging), then
    // read the opcode. fetch_byte() already advanced PC past it.
    instruction_pc_ = reg_.pc;
    last_opcode_ = fetch_byte();

    // decode + execute
    execute(last_opcode_);

    return static_cast<int>(cycles_ - cycles_before);
}

int Cpu::run(int max_steps) noexcept
{
    int executed = 0;
    while (!halted_ && executed < max_steps) {
        step();
        ++executed;
    }
    return executed;
}

void Cpu::halt(u8 opcode) noexcept
{
    halted_ = true;
    unimplemented_opcode_ = opcode;
}

// ---------------------------------------------------------------------------
// decode + execute
//
// Phase 0.2 implements only instructions with no operand or a single
// immediate byte, so that the loop is easy to follow. Anything else halts.
//
//    #$42  in assembly means "the operand is the literal number 0x42",
//          not "the operand is stored at address 0x42".
// ---------------------------------------------------------------------------

void Cpu::execute(u8 opcode) noexcept
{
    switch (opcode) {

    // -- load a literal byte into a register (2 cycles each) -----------------

    case 0xA9: { // LDA #imm - load accumulator
        const u8 value = fetch_byte();
        reg_.a = value;
        reg_.update_nz(reg_.a);
        cycles_ += 2;
        break;
    }

    case 0xA2: { // LDX #imm - load X
        const u8 value = fetch_byte();
        reg_.x = value;
        reg_.update_nz(reg_.x);
        cycles_ += 2;
        break;
    }

    case 0xA0: { // LDY #imm - load Y
        const u8 value = fetch_byte();
        reg_.y = value;
        reg_.update_nz(reg_.y);
        cycles_ += 2;
        break;
    }

    // -- move between registers (2 cycles each) ------------------------------
    //
    // Note that TAX/TXA/TAY/TYA update the flags, while LDX/LDY do too.
    // On the 6502 almost every data movement ends with update_nz().

    case 0xAA: { // TAX - transfer A to X
        reg_.x = reg_.a;
        reg_.update_nz(reg_.x);
        cycles_ += 2;
        break;
    }

    case 0xA8: { // TAY - transfer A to Y
        reg_.y = reg_.a;
        reg_.update_nz(reg_.y);
        cycles_ += 2;
        break;
    }

    case 0x8A: { // TXA - transfer X to A
        reg_.a = reg_.x;
        reg_.update_nz(reg_.a);
        cycles_ += 2;
        break;
    }

    case 0x98: { // TYA - transfer Y to A
        reg_.a = reg_.y;
        reg_.update_nz(reg_.a);
        cycles_ += 2;
        break;
    }

    // -- increment / decrement (2 cycles each) -------------------------------
    //
    // These wrap: INX on $FF gives $00. The 6502 has no "saturate".

    case 0xE8: { // INX
        reg_.x = static_cast<u8>(reg_.x + 1u);
        reg_.update_nz(reg_.x);
        cycles_ += 2;
        break;
    }

    case 0xC8: { // INY
        reg_.y = static_cast<u8>(reg_.y + 1u);
        reg_.update_nz(reg_.y);
        cycles_ += 2;
        break;
    }

    case 0xCA: { // DEX
        reg_.x = static_cast<u8>(reg_.x - 1u);
        reg_.update_nz(reg_.x);
        cycles_ += 2;
        break;
    }

    case 0x88: { // DEY
        reg_.y = static_cast<u8>(reg_.y - 1u);
        reg_.update_nz(reg_.y);
        cycles_ += 2;
        break;
    }

    // -- do nothing (2 cycles) -----------------------------------------------

    case 0xEA: { // NOP
        cycles_ += 2;
        break;
    }

    default:
        // Not implemented yet. Phase 0.4 replaces this switch with a table.
        halt(opcode);
        break;
    }
}

} // namespace fc
