#include "core/cpu/cpu.hpp"

#include "core/alu.hpp"
#include "core/bit.hpp"

namespace fc {

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
    const u8 lo = read(kResetVector);
    const u8 hi = read(static_cast<u16>(kResetVector + 1));
    reg_.pc = bit::make_u16(lo, hi);

    cycles_ = 0;
    halted_ = false;
    unimplemented_opcode_ = 0;
    instruction_pc_ = reg_.pc;
    last_opcode_ = 0;
    branch_extra_cycles_ = 0;
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

u8 Cpu::fetch_byte() noexcept
{
    // Read the byte at PC, then move PC on. Because PC is u16 it wraps
    // 0xFFFF -> 0x0000 by itself, exactly like 16 address wires.
    return read(reg_.pc++);
}

// ---------------------------------------------------------------------------
// stack
// ---------------------------------------------------------------------------

void Cpu::push(u8 value) noexcept
{
    write(static_cast<u16>(kStackPage | reg_.sp), value);
    reg_.sp = static_cast<u8>(reg_.sp - 1u);
}

u8 Cpu::pop() noexcept
{
    reg_.sp = static_cast<u8>(reg_.sp + 1u);
    return read(static_cast<u16>(kStackPage | reg_.sp));
}

// ---------------------------------------------------------------------------
// step - one full fetch / decode / address / execute round
// ---------------------------------------------------------------------------

int Cpu::step() noexcept
{
    if (halted_) {
        return 0;
    }

    const u64 cycles_before = cycles_;

    // --- fetch the opcode ---------------------------------------------------
    instruction_pc_ = reg_.pc;
    last_opcode_ = fetch_byte();

    // --- decode: the table turns one byte into (operation, mode) ------------
    const OpcodeInfo& info = opcode_info(last_opcode_);

    // --- address: fetch operand bytes, then compute the effective address ---
    AddressingRequest request{};
    request.mode = info.mode;
    request.instruction_pc = instruction_pc_;
    request.x = reg_.x;   // sampled BEFORE the instruction, as the hardware does
    request.y = reg_.y;

    const int operand_bytes = operand_length(info.mode);
    if (operand_bytes >= 1) {
        request.operand_lo = fetch_byte();
    }
    if (operand_bytes >= 2) {
        request.operand_hi = fetch_byte();
    }

    const Operand operand = resolve(request, *bus_);

    // --- execute ------------------------------------------------------------
    branch_extra_cycles_ = 0;
    execute(info, operand);
    cycles_ += static_cast<u64>(cycle_cost(info, operand));

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
// operation support
// ---------------------------------------------------------------------------

bool Cpu::handles(Operation op) noexcept
{
    // Deliberately exhaustive: no `default:`. If a new Operation is added to
    // the enum, this stops compiling until it is classified.
    switch (op) {
    // implemented in Phase 0.4
    case Operation::LDA: case Operation::LDX: case Operation::LDY:
    case Operation::STA: case Operation::STX: case Operation::STY:
    case Operation::TAX: case Operation::TAY: case Operation::TSX:
    case Operation::TXA: case Operation::TXS: case Operation::TYA:
    case Operation::CMP: case Operation::CPX: case Operation::CPY:
    case Operation::INC: case Operation::INX: case Operation::INY:
    case Operation::DEC: case Operation::DEX: case Operation::DEY:
    case Operation::ASL: case Operation::LSR: case Operation::ROL: case Operation::ROR:
    case Operation::JMP:
    case Operation::BCC: case Operation::BCS: case Operation::BEQ: case Operation::BMI:
    case Operation::BNE: case Operation::BPL: case Operation::BVC: case Operation::BVS:
    case Operation::CLC: case Operation::CLD: case Operation::CLI: case Operation::CLV:
    case Operation::SEC: case Operation::SED: case Operation::SEI:
    case Operation::NOP:
        return true;

    // still to do
    case Operation::AND: case Operation::EOR: case Operation::ORA: case Operation::BIT:
    case Operation::ADC: case Operation::SBC:
    case Operation::PHA: case Operation::PHP: case Operation::PLA: case Operation::PLP:
    case Operation::JSR: case Operation::RTS: case Operation::RTI: case Operation::BRK:
    case Operation::Unknown:
        return false;
    }
    return false;
}

bool Cpu::implements(u8 opcode) noexcept
{
    const OpcodeInfo& info = opcode_info(opcode);
    return info.is_legal() && handles(info.op);
}

u8 Cpu::operand_value(const OpcodeInfo& info, const Operand& operand) noexcept
{
    switch (operand.kind) {
    case OperandKind::Value:
        return operand.value;

    case OperandKind::Address:
        return read(operand.address);

    case OperandKind::None:
        // Only the accumulator mode has a "none" operand that still carries
        // a value.
        if (info.mode == AddressingMode::Accumulator) {
            return reg_.a;
        }
        return 0;

    case OperandKind::Target:
        return 0;
    }
    return 0;
}

void Cpu::store_operand(const OpcodeInfo& info, const Operand& operand, u8 value) noexcept
{
    if (info.mode == AddressingMode::Accumulator) {
        reg_.a = value;
        return;
    }
    if (operand.kind == OperandKind::Address) {
        write(operand.address, value);
    }
}

// ---------------------------------------------------------------------------
// helpers used by several operations
// ---------------------------------------------------------------------------

void Cpu::compare(u8 left, u8 right) noexcept
{
    // CMP is a subtraction that throws the result away and keeps the flags.
    //
    //   C = 1 when left >= right   (no borrow)
    //   Z = 1 when left == right
    //   N = bit 7 of (left - right)
    //
    // The comparison is UNSIGNED. To compare signed values a program must
    // combine N with V, see docs/computer-science/overflow-flag.md.
    const alu::AddResult result = alu::subtract(left, right);

    reg_.set_flag(Flag::Carry, !result.carry);   // carry is "no borrow" here
    reg_.set_flag(Flag::Zero, result.zero);
    reg_.set_flag(Flag::Negative, result.negative);
}

void Cpu::branch(bool condition, const Operand& operand) noexcept
{
    if (!condition) {
        return;
    }

    // PC has already moved past the two instruction bytes.
    const u16 next_instruction = reg_.pc;
    reg_.pc = operand.address;

    branch_extra_cycles_ = 1;
    if (bit::hi_byte(next_instruction) != bit::hi_byte(operand.address)) {
        branch_extra_cycles_ = 2;   // taking a branch across a page costs one more
    }
}

// ---------------------------------------------------------------------------
// cycle accounting
//
// APPROXIMATE. Phase 1 replaces this with the authoritative per-opcode table.
// It is right for the common cases and close for the rest.
// ---------------------------------------------------------------------------

int Cpu::cycle_cost(const OpcodeInfo& info, const Operand& operand) const noexcept
{
    // JMP is special: there is no data to fetch, only a target to load.
    if (info.op == Operation::JMP) {
        return (info.mode == AddressingMode::Indirect) ? 5 : 3;
    }

    int cycles = addressing_cycles(info.mode);

    const bool indexed_absolute =
        info.mode == AddressingMode::AbsoluteX ||
        info.mode == AddressingMode::AbsoluteY ||
        info.mode == AddressingMode::IndirectY;

    if (is_store_operation(info.op)) {
        // A write happens on a fixed cycle, so there is no page crossing
        // reward or penalty - the indexed forms just cost one more.
        if (indexed_absolute) {
            ++cycles;
        }
    } else if (is_read_modify_write(info.op)) {
        if (info.mode != AddressingMode::Accumulator) {
            cycles += 2;   // read, modify, write back
            if (info.mode == AddressingMode::AbsoluteX ||
                info.mode == AddressingMode::AbsoluteY) {
                ++cycles;
            }
        }
    } else if (operand.page_crossed && indexed_absolute) {
        ++cycles;   // reading across a page boundary costs one more
    }

    cycles += branch_extra_cycles_;
    return cycles;
}

// ---------------------------------------------------------------------------
// decode + execute
//
// One case per OPERATION, not per opcode. The addressing mode was already
// resolved before we get here, so `operand_value` and `store_operand` work
// unchanged whether the data came from `#$42`, `$42`, `$8000,X` or `($42),Y`.
// ---------------------------------------------------------------------------

void Cpu::execute(const OpcodeInfo& info, const Operand& operand) noexcept
{
    switch (info.op) {

    // -- implied: transfers between registers --------------------------------
    // These ignore the operand entirely; it is None.

    case Operation::TAX:
        reg_.x = reg_.a;
        reg_.update_nz(reg_.x);
        break;

    case Operation::TAY:
        reg_.y = reg_.a;
        reg_.update_nz(reg_.y);
        break;

    case Operation::TXA:
        reg_.a = reg_.x;
        reg_.update_nz(reg_.a);
        break;

    case Operation::TYA:
        reg_.a = reg_.y;
        reg_.update_nz(reg_.a);
        break;

    case Operation::TSX:
        reg_.x = reg_.sp;
        reg_.update_nz(reg_.x);
        break;

    case Operation::TXS:
        reg_.sp = reg_.x;
        break;   // TXS is the one transfer that does NOT touch the flags

    // -- implied: increment / decrement --------------------------------------
    // All of these wrap: $FF + 1 = $00. The 6502 does not saturate.

    case Operation::INX:
        reg_.x = static_cast<u8>(reg_.x + 1u);
        reg_.update_nz(reg_.x);
        break;

    case Operation::INY:
        reg_.y = static_cast<u8>(reg_.y + 1u);
        reg_.update_nz(reg_.y);
        break;

    case Operation::DEX:
        reg_.x = static_cast<u8>(reg_.x - 1u);
        reg_.update_nz(reg_.x);
        break;

    case Operation::DEY:
        reg_.y = static_cast<u8>(reg_.y - 1u);
        reg_.update_nz(reg_.y);
        break;

    // -- implied: flag control ----------------------------------------------

    case Operation::CLC: reg_.set_flag(Flag::Carry, false); break;
    case Operation::SEC: reg_.set_flag(Flag::Carry, true);  break;
    case Operation::CLI: reg_.set_flag(Flag::IrqDisable, false); break;
    case Operation::SEI: reg_.set_flag(Flag::IrqDisable, true);  break;
    case Operation::CLD: reg_.set_flag(Flag::Decimal, false); break;
    case Operation::SED: reg_.set_flag(Flag::Decimal, true);  break;
    case Operation::CLV: reg_.set_flag(Flag::Overflow, false); break;

    // -- implied: nothing at all ---------------------------------------------

    case Operation::NOP:
        break;

    // -- loads ---------------------------------------------------------------
    // `operand_value` already did the read, whatever the mode was.

    case Operation::LDA:
        reg_.a = operand_value(info, operand);
        reg_.update_nz(reg_.a);
        break;

    case Operation::LDX:
        reg_.x = operand_value(info, operand);
        reg_.update_nz(reg_.x);
        break;

    case Operation::LDY:
        reg_.y = operand_value(info, operand);
        reg_.update_nz(reg_.y);
        break;

    // -- stores --------------------------------------------------------------

    case Operation::STA:
        store_operand(info, operand, reg_.a);
        break;

    case Operation::STX:
        store_operand(info, operand, reg_.x);
        break;

    case Operation::STY:
        store_operand(info, operand, reg_.y);
        break;

    // -- compares ------------------------------------------------------------

    case Operation::CMP:
        compare(reg_.a, operand_value(info, operand));
        break;

    case Operation::CPX:
        compare(reg_.x, operand_value(info, operand));
        break;

    case Operation::CPY:
        compare(reg_.y, operand_value(info, operand));
        break;

    // -- increments / decrements in memory -----------------------------------

    case Operation::INC: {
        const u8 value = static_cast<u8>(operand_value(info, operand) + 1u);
        store_operand(info, operand, value);
        reg_.update_nz(value);
        break;
    }

    case Operation::DEC: {
        const u8 value = static_cast<u8>(operand_value(info, operand) - 1u);
        store_operand(info, operand, value);
        reg_.update_nz(value);
        break;
    }

    // -- shifts and rotates --------------------------------------------------
    //
    // The bit pushed out of the byte goes into C; for the rotating versions
    // the old C comes back in at the other end. This is how multi byte
    // shifts and the NES's own scrolling tricks work.

    case Operation::ASL: {   // shift left: bit 7 -> C, 0 -> bit 0
        const u8 value = operand_value(info, operand);
        reg_.set_flag(Flag::Carry, (value & 0x80u) != 0);
        const u8 result = static_cast<u8>(value << 1);
        store_operand(info, operand, result);
        reg_.update_nz(result);
        break;
    }

    case Operation::LSR: {   // shift right: bit 0 -> C, 0 -> bit 7
        const u8 value = operand_value(info, operand);
        reg_.set_flag(Flag::Carry, (value & 0x01u) != 0);
        const u8 result = static_cast<u8>(value >> 1);
        store_operand(info, operand, result);
        reg_.update_nz(result);
        break;
    }

    case Operation::ROL: {   // rotate left through C
        const u8 value = operand_value(info, operand);
        const bool old_carry = reg_.flag(Flag::Carry);
        reg_.set_flag(Flag::Carry, (value & 0x80u) != 0);
        u8 result = static_cast<u8>(value << 1);
        if (old_carry) {
            result = static_cast<u8>(result | 0x01u);
        }
        store_operand(info, operand, result);
        reg_.update_nz(result);
        break;
    }

    case Operation::ROR: {   // rotate right through C
        const u8 value = operand_value(info, operand);
        const bool old_carry = reg_.flag(Flag::Carry);
        reg_.set_flag(Flag::Carry, (value & 0x01u) != 0);
        u8 result = static_cast<u8>(value >> 1);
        if (old_carry) {
            result = static_cast<u8>(result | 0x80u);
        }
        store_operand(info, operand, result);
        reg_.update_nz(result);
        break;
    }

    // -- jumps ---------------------------------------------------------------
    // The effective address IS the destination.

    case Operation::JMP:
        reg_.pc = operand.address;
        break;

    // -- conditional branches ------------------------------------------------
    // Each one tests one flag and jumps to the resolved Target.

    case Operation::BCC: branch(!reg_.flag(Flag::Carry), operand);     break;
    case Operation::BCS: branch(reg_.flag(Flag::Carry), operand);      break;
    case Operation::BEQ: branch(reg_.flag(Flag::Zero), operand);       break;
    case Operation::BNE: branch(!reg_.flag(Flag::Zero), operand);      break;
    case Operation::BMI: branch(reg_.flag(Flag::Negative), operand);   break;
    case Operation::BPL: branch(!reg_.flag(Flag::Negative), operand);  break;
    case Operation::BVS: branch(reg_.flag(Flag::Overflow), operand);   break;
    case Operation::BVC: branch(!reg_.flag(Flag::Overflow), operand);  break;

    // -- not implemented yet (Phase 1) ---------------------------------------
    //
    // Listed explicitly rather than hidden behind `default:` so that adding a
    // new Operation to the enum shows up as a compiler warning.

    case Operation::AND:
    case Operation::EOR:
    case Operation::ORA:
    case Operation::BIT:
    case Operation::ADC:
    case Operation::SBC:
    case Operation::PHA:
    case Operation::PHP:
    case Operation::PLA:
    case Operation::PLP:
    case Operation::JSR:
    case Operation::RTS:
    case Operation::RTI:
    case Operation::BRK:
    case Operation::Unknown:
        halt(last_opcode_);
        break;
    }
}

} // namespace fc
