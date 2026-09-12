#pragma once

// ---------------------------------------------------------------------------
// The CPU.
//
// Everything a CPU does is this loop:
//
//      fetch    read the byte at PC, then PC = PC + 1
//        |
//      decode   that byte (the opcode) selects an instruction
//        |
//      execute  do the work, possibly fetching more bytes (operands)
//        |
//      update state (flags, registers, cycles)
//        |
//      repeat
//
// In Phase 0.2 the "decode" step is a plain switch over a handful of opcodes
// so the loop itself is visible. In Phase 0.4 it becomes a table indexed by
// opcode, with a separate addressing-mode step - which is how real emulators
// (and the real chip's PLA) work.
// ---------------------------------------------------------------------------

#include "core/bus.hpp"
#include "core/cpu/registers.hpp"
#include "core/types.hpp"

namespace fc {

class Cpu {
public:
    explicit Cpu(Bus& bus) noexcept
        : bus_(&bus)
    {
    }

    /// Power-on / reset.
    ///
    /// The 6502 does not start executing at address 0. It reads a 16 bit
    /// address from the reset vector at $FFFC-$FFFD and jumps there.
    /// Those two bytes are stored little endian: low byte first.
    void reset() noexcept;

    /// Execute exactly one instruction (fetch + decode + execute).
    /// Returns the number of cycles the instruction took.
    int step() noexcept;

    /// Run until halted or `max_steps` instructions have run.
    int run(int max_steps) noexcept;

    // -- stack ---------------------------------------------------------------
    //
    // The 6502 stack lives only in page 1 ($0100-$01FF). SP is the low byte,
    // so the stack is 256 bytes. It grows DOWNWARD: push decrements SP.
    //
    // Note: $0100 | sp is the same as $0100 + sp, and the OR makes the intent
    // clear - the high byte is fixed at $01.
    //
    // Exposed publicly so tests and the future debugger can inspect the stack.

    void push(u8 value) noexcept;
    [[nodiscard]] u8 pop() noexcept;

    // -- state access --------------------------------------------------------

    [[nodiscard]] const Registers& registers() const noexcept { return reg_; }
    [[nodiscard]] Registers& registers() noexcept { return reg_; }

    [[nodiscard]] u64 total_cycles() const noexcept { return cycles_; }

    /// Address of the instruction currently being / last executed.
    [[nodiscard]] u16 current_instruction_pc() const noexcept { return instruction_pc_; }

    /// The last opcode fetched.
    [[nodiscard]] u8 last_opcode() const noexcept { return last_opcode_; }

    // -- failure reporting ---------------------------------------------------
    //
    // An unimplemented opcode is a bug in the emulator, not in the game.
    // We stop loudly instead of silently doing nothing, so that the bug is
    // impossible to miss.

    [[nodiscard]] bool is_halted() const noexcept { return halted_; }

    /// 0 when nothing went wrong, otherwise the opcode we could not execute.
    [[nodiscard]] u8 unimplemented_opcode() const noexcept { return unimplemented_opcode_; }

private:
    // -- bus helpers ---------------------------------------------------------

    [[nodiscard]] u8 read(u16 address) noexcept { return bus_->read(address); }
    void write(u16 address, u8 value) noexcept { bus_->write(address, value); }

    // -- fetch ---------------------------------------------------------------

    /// Read the byte at PC and advance PC. PC wraps at 16 bits by itself.
    [[nodiscard]] u8 fetch_byte() noexcept;

    /// Read two bytes, low first, and glue them into an address.
    /// This is the 6502's little endian operand fetch.
    [[nodiscard]] u16 fetch_word() noexcept;

    // -- decode + execute ----------------------------------------------------

    void execute(u8 opcode) noexcept;
    void halt(u8 opcode) noexcept;

    Bus* bus_;
    Registers reg_{};
    u64 cycles_ = 0;

    u16 instruction_pc_ = 0;
    u8  last_opcode_ = 0;

    bool halted_ = false;
    u8   unimplemented_opcode_ = 0;
};

} // namespace fc
