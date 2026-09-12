// ---------------------------------------------------------------------------
// demo_cpu - watch the fetch / decode / execute loop one instruction at a time
//
// Build:  cmake --build build
// Run:    ./build/demo_cpu
//
// Read together with docs/computer-science/cpu.md
// ---------------------------------------------------------------------------

#include "core/bit.hpp"
#include "core/cpu/cpu.hpp"
#include "core/flat_bus.hpp"
#include "core/types.hpp"

#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

using namespace fc;

namespace {

constexpr u16 kOrigin = 0x8000;

void title(const std::string& text)
{
    std::cout << "\n=== " << text << " ===\n";
}

/// Human readable name for the opcodes this demo knows about.
/// The trailing space in "LDA #" is the start of the operand field.
std::string mnemonic(u8 opcode)
{
    switch (opcode) {
    case 0xA9: return "LDA #";
    case 0xA2: return "LDX #";
    case 0xA0: return "LDY #";
    case 0xAA: return "TAX";
    case 0xA8: return "TAY";
    case 0x8A: return "TXA";
    case 0x98: return "TYA";
    case 0xE8: return "INX";
    case 0xC8: return "INY";
    case 0xCA: return "DEX";
    case 0x88: return "DEY";
    case 0xEA: return "NOP";
    default:   return "???";
    }
}

/// How many bytes long the instruction at [pc] is (only for the ones we know).
int instruction_length(u8 opcode)
{
    switch (opcode) {
    case 0xA9:
    case 0xA2:
    case 0xA0: return 2;   // opcode + immediate byte
    default:   return 1;   // implied, no operand
    }
}

/// Render one instruction the way a disassembler would, eg "LDA #0x42".
std::string disassemble(FlatBus& bus, u16 pc, int& length_out)
{
    const u8 opcode = bus.read(pc);
    length_out = instruction_length(opcode);

    std::string text = mnemonic(opcode);
    if (length_out == 2) {
        text += bit::to_hex(bus.read(static_cast<u16>(pc + 1)));
    }
    return text;
}

/// Raw bytes of one instruction: "0xA9 0x42"
std::string raw_bytes(FlatBus& bus, u16 pc, int length)
{
    std::string out;
    for (int i = 0; i < length; ++i) {
        if (i != 0) {
            out += ' ';
        }
        out += bit::to_hex(bus.read(static_cast<u16>(pc + i)));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Table rendering. Every column uses the same std::setw so the header and the
// rows line up.
// ---------------------------------------------------------------------------

constexpr int kStepWidth  = 4;
constexpr int kPcWidth    = 6;
constexpr int kInstrWidth = 11;
constexpr int kRegWidth   = 4;
constexpr int kStatusWidth = 8;

void print_header()
{
    std::cout << "  " << std::setw(kStepWidth) << "step"
              << "  " << std::left << std::setw(kPcWidth) << "PC"
              << "  " << std::setw(kInstrWidth) << "instruction"
              << "  " << std::setw(kRegWidth) << "A"
              << "  " << std::setw(kRegWidth) << "X"
              << "  " << std::setw(kRegWidth) << "Y"
              << "  " << std::setw(kRegWidth) << "SP"
              << "  " << std::setw(kStatusWidth) << "P"
              << "  " << std::setw(6) << "cycles" << std::right << "\n";

    std::cout << "  " << std::string(4, '-')
              << "  " << std::string(6, '-')
              << "  " << std::string(11, '-')
              << "  " << std::string(4, '-')
              << "  " << std::string(4, '-')
              << "  " << std::string(4, '-')
              << "  " << std::string(4, '-')
              << "  " << std::string(8, '-')
              << "  " << std::string(6, '-') << "\n";
}

void print_row(int step, u16 pc, const std::string& instruction,
               const Registers& r, u64 cycles)
{
    std::cout << "  " << std::setw(kStepWidth) << step
              << "  " << std::left << std::setw(kPcWidth) << bit::to_hex(pc)
              << "  " << std::setw(kInstrWidth) << instruction
              << "  " << std::setw(kRegWidth) << bit::to_hex(r.a)
              << "  " << std::setw(kRegWidth) << bit::to_hex(r.x)
              << "  " << std::setw(kRegWidth) << bit::to_hex(r.y)
              << "  " << std::setw(kRegWidth) << bit::to_hex(r.sp)
              << "  " << std::setw(kStatusWidth) << r.status_string()
              << "  " << std::right << std::setw(6) << cycles << "\n";
}

// --- 1 ---------------------------------------------------------------------
void showMemoryLayout(FlatBus& bus, const std::vector<u8>& program)
{
    title("1. The program in memory");

    std::cout << "  Reset vector at $FFFC-$FFFD (little endian):\n";
    std::cout << "    [$FFFC] = " << bit::to_hex(bus.read(0xFFFC)) << "   <- low byte\n";
    std::cout << "    [$FFFD] = " << bit::to_hex(bus.read(0xFFFD)) << "   <- high byte\n";
    std::cout << "    entry   = " << bit::to_hex(kOrigin) << "\n\n";

    std::cout << "  Program at " << bit::to_hex(kOrigin) << ":\n\n";
    std::cout << "    address   bytes          disassembly\n";
    std::cout << "    " << std::string(9, '-') << " "
              << std::string(14, '-') << " "
              << std::string(12, '-') << "\n";

    std::size_t offset = 0;
    while (offset < program.size()) {
        const u16 address = static_cast<u16>(kOrigin + offset);
        int length = 0;
        const std::string text = disassemble(bus, address, length);

        std::cout << "    " << std::left << std::setw(9) << bit::to_hex(address) << " "
                  << std::setw(14) << raw_bytes(bus, address, length) << " "
                  << std::setw(12) << text << "\n";

        offset += static_cast<std::size_t>(length);
    }
    std::cout << std::right;
}

// --- 2 ---------------------------------------------------------------------
void traceExecution(FlatBus& bus, Cpu& cpu)
{
    title("2. Fetch / decode / execute, one instruction at a time");

    print_header();

    // State right after reset, before anything has been fetched.
    print_row(0, cpu.registers().pc, "(reset)", cpu.registers(), cpu.total_cycles());

    int step = 0;
    while (!cpu.is_halted() && step < 12) {
        // Where this instruction starts, captured before step() moves PC.
        const u16 pc = cpu.registers().pc;

        int length = 0;
        const std::string instruction = disassemble(bus, pc, length);

        int cycles = cpu.step();
        ++step;
        (void)cycles;

        // After step(), PC already points at the NEXT instruction.
        print_row(step, pc, instruction, cpu.registers(), cpu.total_cycles());
    }

    if (cpu.is_halted()) {
        std::cout << "\n  CPU halted on " << bit::to_hex(cpu.unimplemented_opcode())
                  << " (BRK), which Phase 0.2 does not implement yet.\n";
        std::cout << "  The emulator stops loudly instead of silently doing nothing,\n";
        std::cout << "  so an unimplemented instruction cannot go unnoticed.\n";
    }
}

// --- 3 ---------------------------------------------------------------------
void explainOneInstruction(FlatBus& bus, Cpu& cpu)
{
    title("3. Anatomy of one instruction: LDA #$42");

    (void)cpu;

    const u16 pc = kOrigin;
    const u8 opcode = bus.read(pc);
    const u8 operand = bus.read(static_cast<u16>(pc + 1));

    std::cout << "  memory:\n";
    std::cout << "    " << bit::to_hex(pc) << " : "
              << bit::to_binary(opcode, 8, true) << " : " << bit::to_hex(opcode)
              << "   <- opcode  (selects the instruction)\n";
    std::cout << "    " << bit::to_hex(static_cast<u16>(pc + 1)) << " : "
              << bit::to_binary(operand, 8, true) << " : " << bit::to_hex(operand)
              << "   <- operand (the literal data)\n\n";

    std::cout << "  1. PC = " << bit::to_hex(pc) << "\n";
    std::cout << "  2. fetch byte at PC -> " << bit::to_hex(opcode)
              << ", PC becomes " << bit::to_hex(static_cast<u16>(pc + 1)) << "\n";
    std::cout << "  3. decode: 0xA9 means 'load the accumulator with the byte\n";
    std::cout << "     that follows' - immediate addressing, spelled #$42\n";
    std::cout << "  4. fetch byte at PC -> " << bit::to_hex(operand)
              << ", PC becomes " << bit::to_hex(static_cast<u16>(pc + 2)) << "\n";
    std::cout << "  5. A = " << bit::to_hex(operand) << "\n";
    std::cout << "  6. update flags: N = bit 7 = 0, Z = (A == 0) = 0\n";
    std::cout << "  7. cycles += 2: one fetch for the opcode, one for the operand\n";
}

// --- 4 ---------------------------------------------------------------------
void showResetVectorMechanism()
{
    title("4. Why the CPU does not start at address 0");

    std::cout << "  A CPU has no idea what a 'program' is. Its entire reset\n";
    std::cout << "  contract is: 'read two bytes from $FFFC and jump there'.\n\n";
    std::cout << "  Consequences:\n";
    std::cout << "    * the cartridge decides where execution begins\n";
    std::cout << "    * the same CPU can boot a different system by wiring\n";
    std::cout << "      a different address decoder to $FFFC\n";
    std::cout << "    * a NES ROM cannot lie about its entry point - the bytes\n";
    std::cout << "      in PRG ROM at $FFFC are the truth\n";
}

} // namespace

int main()
{
    std::cout << "FC Emulator - Phase 0.2: the fetch / decode / execute loop\n";

    // A tiny program. Each line is one instruction.
    const std::vector<u8> program = {
        0xA9, 0x42,   // LDA #$42    A = 0x42
        0xAA,         // TAX         X = A
        0xA8,         // TAY         Y = A
        0xE8,         // INX         X = X + 1
        0xC8,         // INY         Y = Y + 1
        0xA9, 0x00,   // LDA #$00    A = 0, Z = 1
        0xEA,         // NOP
    };

    FlatBus bus;
    Cpu cpu{ bus };

    // Load the program and point the reset vector at it.
    bus.load(program, kOrigin);
    bus.write(0xFFFC, bit::lo_byte(kOrigin));
    bus.write(0xFFFD, bit::hi_byte(kOrigin));

    // Power on.
    cpu.reset();

    showMemoryLayout(bus, program);
    traceExecution(bus, cpu);
    explainOneInstruction(bus, cpu);
    showResetVectorMechanism();

    title("Summary");
    std::cout << "CPU state = 6 bytes: A, X, Y, SP, P, PC\n";
    std::cout << "The loop = fetch(opcode) -> decode -> execute -> update state\n";
    std::cout << "PC only ever moves forward, one byte per fetch\n";
    std::cout << "The CPU never touches memory directly: everything goes via the Bus\n";
    std::cout << "Entry point comes from the reset vector at $FFFC-$FFFD\n";

    return 0;
}
