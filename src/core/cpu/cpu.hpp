#pragma once

// ---------------------------------------------------------------------------
// The CPU.
//
// Everything a CPU does is this loop:
//
//      fetch    read the byte at PC, then PC = PC + 1
//        |
//      decode   look the opcode up in the table -> (operation, addressing mode)
//        |
//      address  fetch the operand bytes, compute the EFFECTIVE ADDRESS
//        |
//      execute  do the work
//        |
//      update state (flags, registers, cycles)
//        |
//      repeat
//
// Phase 0.4 splits "decode" from "address". The opcode table already knows
// each instruction's addressing mode, so one handler per OPERATION now covers
// every addressing mode that operation supports. Before this, every
// (operation, mode) pair needed its own case.
// ---------------------------------------------------------------------------

#include "core/bus.hpp"
#include "core/cpu/addressing.hpp"
#include "core/cpu/opcode.hpp"
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

    /// Execute exactly one instruction. Returns the cycles it took.
    int step() noexcept;

    /// Run until halted or `max_steps` instructions have run.
    int run(int max_steps) noexcept;

    // -- state access --------------------------------------------------------

    [[nodiscard]] const Registers& registers() const noexcept { return reg_; }
    [[nodiscard]] Registers& registers() noexcept { return reg_; }

    /// Cycles accumulated so far.
    ///
    /// Phase 0.4 only approximates timing: the cost is derived from the
    /// addressing mode plus a few operation adjustments, which is right for
    /// most instructions but not all. Phase 1 replaces this with the real
    /// per-opcode cycle table.
    [[nodiscard]] u64 total_cycles() const noexcept { return cycles_; }

    [[nodiscard]] u16 current_instruction_pc() const noexcept { return instruction_pc_; }
    [[nodiscard]] u8 last_opcode() const noexcept { return last_opcode_; }

    // -- failure reporting ---------------------------------------------------
    //
    // An unimplemented opcode is a bug in the emulator, not in the game.
    // We stop loudly instead of silently doing nothing.

    [[nodiscard]] bool is_halted() const noexcept { return halted_; }
    [[nodiscard]] u8 unimplemented_opcode() const noexcept { return unimplemented_opcode_; }

    /// True when this opcode is legal AND its operation is implemented.
    [[nodiscard]] static bool implements(u8 opcode) noexcept;

    /// True when the execute() switch knows this operation.
    ///
    /// This is an exhaustive switch with no `default:`, so adding a new
    /// Operation to the enum is a compile error until it is classified here.
    [[nodiscard]] static bool handles(Operation op) noexcept;

    // -- stack ---------------------------------------------------------------
    //
    // The 6502 stack lives only in page 1 ($0100-$01FF). SP is the low byte,
    // so the stack is 256 bytes and grows DOWNWARD: push decrements SP.

    void push(u8 value) noexcept;
    [[nodiscard]] u8 pop() noexcept;

private:
    // -- bus helpers ---------------------------------------------------------
    [[nodiscard]] u8 read(u16 address) noexcept { return bus_->read(address); }
    void write(u16 address, u8 value) noexcept { bus_->write(address, value); }

    // -- fetch ---------------------------------------------------------------
    [[nodiscard]] u8 fetch_byte() noexcept;

    // -- operands ------------------------------------------------------------

    /// The current value the operation should work on.
    [[nodiscard]] u8 operand_value(const OpcodeInfo& info, const Operand& operand) noexcept;

    /// Store a result back. Handles the accumulator mode transparently.
    void store_operand(const OpcodeInfo& info, const Operand& operand, u8 value) noexcept;

    // -- decode + execute ----------------------------------------------------
    void execute(const OpcodeInfo& info, const Operand& operand) noexcept;
    void halt(u8 opcode) noexcept;

    /// Approximate cycle cost. See the comment on total_cycles().
    [[nodiscard]] int cycle_cost(const OpcodeInfo& info, const Operand& operand) const noexcept;

    // -- small operation helpers --------------------------------------------
    void compare(u8 left, u8 right) noexcept;
    void branch(bool condition, const Operand& operand) noexcept;

    Bus* bus_;
    Registers reg_{};
    u64 cycles_ = 0;

    u16 instruction_pc_ = 0;
    u8  last_opcode_ = 0;

    int branch_extra_cycles_ = 0;

    bool halted_ = false;
    u8   unimplemented_opcode_ = 0;
};

} // namespace fc
