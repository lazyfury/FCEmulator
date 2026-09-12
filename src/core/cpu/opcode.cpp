#include "core/cpu/opcode.hpp"

namespace fc {
namespace {

using AM = AddressingMode;

// ---------------------------------------------------------------------------
// The official NMOS 6502 opcode matrix.
//
// Layout: 16 rows of 16. The row is the high nibble, the column the low one.
// Read it in groups of four to keep the rows scannable.
//
// "???" with AM::Unknown marks the 105 codes the official chip leaves
// undefined. Those are the illegal opcodes - some of them do something on
// real hardware, but nothing here relies on that.
//
// The table is mechanical but it is also the single source of truth for
// instruction length and operand layout. It is worth reading once, slowly.
// ---------------------------------------------------------------------------

constexpr OpcodeInfo kOpcodeTable[256] = {

    // 0x0_ : BRK ORA     ASL PHP
    { "BRK", AM::Implied },   { "ORA", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ORA", AM::ZeroPage },  { "ASL", AM::ZeroPage }, { "???", AM::Unknown },
    { "PHP", AM::Implied },   { "ORA", AM::Immediate }, { "ASL", AM::Accumulator }, { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ORA", AM::Absolute },  { "ASL", AM::Absolute }, { "???", AM::Unknown },

    // 0x1_ : BPL ORA     ASL CLC
    { "BPL", AM::Relative },  { "ORA", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ORA", AM::ZeroPageX }, { "ASL", AM::ZeroPageX }, { "???", AM::Unknown },
    { "CLC", AM::Implied },   { "ORA", AM::AbsoluteY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ORA", AM::AbsoluteX }, { "ASL", AM::AbsoluteX }, { "???", AM::Unknown },

    // 0x2_ : JSR AND BIT ROL PLP
    { "JSR", AM::Absolute },  { "AND", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "BIT", AM::ZeroPage },  { "AND", AM::ZeroPage },  { "ROL", AM::ZeroPage }, { "???", AM::Unknown },
    { "PLP", AM::Implied },   { "AND", AM::Immediate }, { "ROL", AM::Accumulator }, { "???", AM::Unknown },
    { "BIT", AM::Absolute },  { "AND", AM::Absolute },  { "ROL", AM::Absolute }, { "???", AM::Unknown },

    // 0x3_ : BMI AND ROL SEC
    { "BMI", AM::Relative },  { "AND", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "AND", AM::ZeroPageX }, { "ROL", AM::ZeroPageX }, { "???", AM::Unknown },
    { "SEC", AM::Implied },   { "AND", AM::AbsoluteY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "AND", AM::AbsoluteX }, { "ROL", AM::AbsoluteX }, { "???", AM::Unknown },

    // 0x4_ : RTI EOR LSR PHA JMP
    { "RTI", AM::Implied },   { "EOR", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "EOR", AM::ZeroPage },  { "LSR", AM::ZeroPage }, { "???", AM::Unknown },
    { "PHA", AM::Implied },   { "EOR", AM::Immediate }, { "LSR", AM::Accumulator }, { "???", AM::Unknown },
    { "JMP", AM::Absolute },  { "EOR", AM::Absolute },  { "LSR", AM::Absolute }, { "???", AM::Unknown },

    // 0x5_ : BVC EOR LSR CLI
    { "BVC", AM::Relative },  { "EOR", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "EOR", AM::ZeroPageX }, { "LSR", AM::ZeroPageX }, { "???", AM::Unknown },
    { "CLI", AM::Implied },   { "EOR", AM::AbsoluteY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "EOR", AM::AbsoluteX }, { "LSR", AM::AbsoluteX }, { "???", AM::Unknown },

    // 0x6_ : RTS ADC ROR PLA JMP(ind)
    { "RTS", AM::Implied },   { "ADC", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ADC", AM::ZeroPage },  { "ROR", AM::ZeroPage }, { "???", AM::Unknown },
    { "PLA", AM::Implied },   { "ADC", AM::Immediate }, { "ROR", AM::Accumulator }, { "???", AM::Unknown },
    { "JMP", AM::Indirect },  { "ADC", AM::Absolute },  { "ROR", AM::Absolute }, { "???", AM::Unknown },

    // 0x7_ : BVS ADC ROR SEI
    { "BVS", AM::Relative },  { "ADC", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ADC", AM::ZeroPageX }, { "ROR", AM::ZeroPageX }, { "???", AM::Unknown },
    { "SEI", AM::Implied },   { "ADC", AM::AbsoluteY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "ADC", AM::AbsoluteX }, { "ROR", AM::AbsoluteX }, { "???", AM::Unknown },

    // 0x8_ : STA STX STY DEY TXA
    { "???", AM::Unknown },   { "STA", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "STY", AM::ZeroPage },  { "STA", AM::ZeroPage },  { "STX", AM::ZeroPage }, { "???", AM::Unknown },
    { "DEY", AM::Implied },   { "???", AM::Unknown },   { "TXA", AM::Implied },  { "???", AM::Unknown },
    { "STY", AM::Absolute },  { "STA", AM::Absolute },  { "STX", AM::Absolute }, { "???", AM::Unknown },

    // 0x9_ : BCC STA STY STX TYA TXS
    { "BCC", AM::Relative },  { "STA", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "STY", AM::ZeroPageX }, { "STA", AM::ZeroPageX }, { "STX", AM::ZeroPageY }, { "???", AM::Unknown },
    { "TYA", AM::Implied },   { "STA", AM::AbsoluteY }, { "TXS", AM::Implied },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "STA", AM::AbsoluteX }, { "???", AM::Unknown },  { "???", AM::Unknown },

    // 0xA_ : LDY LDX LDA TAY TAX
    { "LDY", AM::Immediate }, { "LDA", AM::IndirectX }, { "LDX", AM::Immediate }, { "???", AM::Unknown },
    { "LDY", AM::ZeroPage },  { "LDA", AM::ZeroPage },  { "LDX", AM::ZeroPage }, { "???", AM::Unknown },
    { "TAY", AM::Implied },   { "LDA", AM::Immediate }, { "TAX", AM::Implied },  { "???", AM::Unknown },
    { "LDY", AM::Absolute },  { "LDA", AM::Absolute },  { "LDX", AM::Absolute }, { "???", AM::Unknown },

    // 0xB_ : BCS LDA LDY CLV TSX
    { "BCS", AM::Relative },  { "LDA", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "LDY", AM::ZeroPageX }, { "LDA", AM::ZeroPageX }, { "LDX", AM::ZeroPageY }, { "???", AM::Unknown },
    { "CLV", AM::Implied },   { "LDA", AM::AbsoluteY }, { "TSX", AM::Implied },  { "???", AM::Unknown },
    { "LDY", AM::AbsoluteX }, { "LDA", AM::AbsoluteX }, { "LDX", AM::AbsoluteY }, { "???", AM::Unknown },

    // 0xC_ : CPY CMP DEC INY DEX
    { "CPY", AM::Immediate }, { "CMP", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "CPY", AM::ZeroPage },  { "CMP", AM::ZeroPage },  { "DEC", AM::ZeroPage }, { "???", AM::Unknown },
    { "INY", AM::Implied },   { "CMP", AM::Immediate }, { "DEX", AM::Implied },  { "???", AM::Unknown },
    { "CPY", AM::Absolute },  { "CMP", AM::Absolute },  { "DEC", AM::Absolute }, { "???", AM::Unknown },

    // 0xD_ : BNE CMP DEC CLD
    { "BNE", AM::Relative },  { "CMP", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "CMP", AM::ZeroPageX }, { "DEC", AM::ZeroPageX }, { "???", AM::Unknown },
    { "CLD", AM::Implied },   { "CMP", AM::AbsoluteY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "CMP", AM::AbsoluteX }, { "DEC", AM::AbsoluteX }, { "???", AM::Unknown },

    // 0xE_ : CPX SBC INC INX NOP
    { "CPX", AM::Immediate }, { "SBC", AM::IndirectX }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "CPX", AM::ZeroPage },  { "SBC", AM::ZeroPage },  { "INC", AM::ZeroPage }, { "???", AM::Unknown },
    { "INX", AM::Implied },   { "SBC", AM::Immediate }, { "NOP", AM::Implied },  { "???", AM::Unknown },
    { "CPX", AM::Absolute },  { "SBC", AM::Absolute },  { "INC", AM::Absolute }, { "???", AM::Unknown },

    // 0xF_ : BEQ SBC INC SED
    { "BEQ", AM::Relative },  { "SBC", AM::IndirectY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "SBC", AM::ZeroPageX }, { "INC", AM::ZeroPageX }, { "???", AM::Unknown },
    { "SED", AM::Implied },   { "SBC", AM::AbsoluteY }, { "???", AM::Unknown },  { "???", AM::Unknown },
    { "???", AM::Unknown },   { "SBC", AM::AbsoluteX }, { "INC", AM::AbsoluteX }, { "???", AM::Unknown },
};

static_assert(sizeof(kOpcodeTable) / sizeof(kOpcodeTable[0]) == 256,
              "the opcode table must cover all 256 byte values");

} // namespace

const OpcodeInfo& opcode_info(u8 opcode) noexcept
{
    return kOpcodeTable[opcode];
}

} // namespace fc
