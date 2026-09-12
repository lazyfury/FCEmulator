#pragma once

// ---------------------------------------------------------------------------
// Opcode metadata: what does a byte mean?
//
// An opcode encodes TWO independent things:
//
//     0xBD  =  LDA $8000,X
//              ^^^   ^^^^^^^
//              |     +-- addressing mode: how to find the data
//              +-------- operation: what to do with it
//
// Neither half is stored separately. The byte IS both. That is why the 6502
// spends 151 of its 256 codes on the "official" instruction set and leaves
// the rest undefined.
//
// Because the addressing mode is known from the opcode alone, the *length* of
// an instruction is also known:
//
//     LDA #$42      immediate   -> 2 bytes (opcode + 1 operand byte)
//     LDA $42       zero page   -> 2 bytes
//     LDA $8000     absolute    -> 3 bytes (opcode + 2 operand bytes)
//     LDA $8000,X   absolute,X  -> 3 bytes
//     TAX           implied     -> 1 byte  (no operand at all)
//
// This is what makes a CPU's fetch loop possible: it can always advance PC by
// a known amount without understanding the instruction.
// ---------------------------------------------------------------------------

#include "core/types.hpp"

namespace fc {

/// The 6502's 13 ways of naming an operand.
///
///    Implied       TAX            the operand is implicit
///    Accumulator   ASL A          the operand is the accumulator
///    Immediate     LDA #$42       the operand is a literal byte
///    ZeroPage      LDA $42        address is 1 byte, so $0042
///    ZeroPageX     LDA $42,X      1 byte address + X, wraps inside page 0
///    ZeroPageY     LDX $42,Y      1 byte address + Y, wraps inside page 0
///    Absolute      LDA $8000      2 byte address
///    AbsoluteX     LDA $8000,X    2 byte address + X
///    AbsoluteY     LDA $8000,Y    2 byte address + Y
///    Indirect      JMP ($8000)    address stored at $8000
///    IndirectX     LDA ($42,X)    zero page pointer + X, then dereference
///    IndirectY     LDA ($42),Y    zero page pointer, dereference, then + Y
///    Relative      BNE $8010      1 byte SIGNED offset from the next PC
enum class AddressingMode : u8 {
    Implied,
    Accumulator,
    Immediate,
    ZeroPage,
    ZeroPageX,
    ZeroPageY,
    Absolute,
    AbsoluteX,
    AbsoluteY,
    Indirect,
    IndirectX,
    IndirectY,
    Relative,

    Unknown,   // illegal / unofficial opcode
};

/// Number of operand bytes that follow the opcode.
[[nodiscard]] constexpr int operand_length(AddressingMode mode) noexcept
{
    switch (mode) {
    case AddressingMode::Implied:
    case AddressingMode::Accumulator:
        return 0;

    case AddressingMode::Immediate:
    case AddressingMode::ZeroPage:
    case AddressingMode::ZeroPageX:
    case AddressingMode::ZeroPageY:
    case AddressingMode::IndirectX:
    case AddressingMode::IndirectY:
    case AddressingMode::Relative:
        return 1;

    case AddressingMode::Absolute:
    case AddressingMode::AbsoluteX:
    case AddressingMode::AbsoluteY:
    case AddressingMode::Indirect:
        return 2;

    case AddressingMode::Unknown:
        return 0;
    }
    return 0;
}

/// Memory addressing modes (as opposed to Immediate/Relative/Implied).
/// Useful for deciding whether an operand is an address or data.
[[nodiscard]] constexpr bool is_memory_mode(AddressingMode mode) noexcept
{
    switch (mode) {
    case AddressingMode::ZeroPage:
    case AddressingMode::ZeroPageX:
    case AddressingMode::ZeroPageY:
    case AddressingMode::Absolute:
    case AddressingMode::AbsoluteX:
    case AddressingMode::AbsoluteY:
    case AddressingMode::Indirect:
    case AddressingMode::IndirectX:
    case AddressingMode::IndirectY:
        return true;
    default:
        return false;
    }
}

[[nodiscard]] constexpr const char* mode_name(AddressingMode mode) noexcept
{
    switch (mode) {
    case AddressingMode::Implied:     return "implied";
    case AddressingMode::Accumulator: return "accumulator";
    case AddressingMode::Immediate:   return "immediate";
    case AddressingMode::ZeroPage:    return "zero page";
    case AddressingMode::ZeroPageX:   return "zero page,X";
    case AddressingMode::ZeroPageY:   return "zero page,Y";
    case AddressingMode::Absolute:    return "absolute";
    case AddressingMode::AbsoluteX:   return "absolute,X";
    case AddressingMode::AbsoluteY:   return "absolute,Y";
    case AddressingMode::Indirect:    return "indirect";
    case AddressingMode::IndirectX:   return "indirect,X";
    case AddressingMode::IndirectY:   return "indirect,Y";
    case AddressingMode::Relative:    return "relative";
    case AddressingMode::Unknown:     return "unknown";
    }
    return "unknown";
}

/// Everything the emulator knows about one opcode byte.
struct OpcodeInfo {
    const char* mnemonic;      // "LDA", or "???" for an illegal opcode
    AddressingMode mode;

    /// Total instruction size in bytes, opcode included.
    [[nodiscard]] constexpr int length() const noexcept
    {
        return 1 + operand_length(mode);
    }

    /// False for the 105 codes the official 6502 does not define.
    [[nodiscard]] constexpr bool is_legal() const noexcept
    {
        return mode != AddressingMode::Unknown;
    }
};

/// Number of defined opcodes on the official NMOS 6502.
/// (56 mnemonics spread over 151 opcodes; the rest are unofficial/illegal.)
inline constexpr int kLegalOpcodeCount = 151;

/// Look up one opcode. Never fails: illegal opcodes return mnemonic "???".
[[nodiscard]] const OpcodeInfo& opcode_info(u8 opcode) noexcept;

} // namespace fc
