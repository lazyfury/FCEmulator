# FC Emulator Project — Agent Instructions

## Project Name

FC Emulator for macOS

---

# 1. Project Vision

本项目目标：从零实现一个 macOS 平台上的 FC / NES 模拟器。

但目标**不仅是完成模拟器**。本项目同时是一个**计算机科学学习工程**。

实现过程中必须理解：

- 二进制表示
- 数字逻辑
- CPU 工作原理
- 汇编语言
- 指令执行
- 内存系统
- 总线结构
- 图形渲染
- 音频系统
- 操作系统图形接口

最终目标：能够解释

```
一个 NES 游戏 ROM 如何变成屏幕上的像素
```

完整链路：

```
ROM
 ↓
Machine Code
 ↓
Opcode
 ↓
CPU Execute
 ↓
Memory Access
 ↓
Bus
 ↓
PPU
 ↓
Framebuffer
 ↓
GPU
 ↓
Screen
```

---

# 2. Agent 工作原则

## 2.1 教学优先

每一次代码修改必须包含：

1. 本次目标
2. 相关计算机科学知识
3. NES 原理解释
4. 设计方案
5. 代码实现
6. 测试
7. 测试结果解释
8. 下一阶段目标

禁止：

```
直接输出大量代码
然后告诉用户运行
```

## 2.2 分阶段开发

必须按照：

```
理解 → 设计 → 实现 → 测试 → 总结 → 下一阶段
```

执行。禁止跳跃，例如：

错误：

```
先写 PPU
再补 CPU
```

正确：

```
Binary
 ↓
CPU
 ↓
Assembly
 ↓
Memory
 ↓
Bus
 ↓
Cartridge
 ↓
PPU
 ↓
APU
 ↓
Frontend
```

---

# 3. 技术架构

## Core

语言：`C++20`

负责：CPU / Bus / Memory / Cartridge / Mapper / PPU / APU / Controller

## macOS Frontend

技术：`Swift` `SwiftUI/AppKit` `Metal`

负责：Window / Input / Rendering / Audio output

核心禁止依赖 UI。

```
                    macOS
                      |
                      |
                    Metal
                      |
                Emulator API
                      |
+-------------------------------------------+
|                  NES Core                 |
|                                           |
|   CPU ---- Bus ---- PPU                   |
|    |        |        |                    |
|   APU    Cartridge  VRAM                  |
|    |                                      |
|  Controller                               |
+-------------------------------------------+
```

---

# 4. 开发阶段总览

## Phase 0 — 工程基础

目标：建立 CMake / C++ / Test Framework
学习：编译、链接、项目结构

## Phase 0.1 — 二进制基础

学习：bit / byte / binary / hexadecimal / bit operation / signed number / two's complement

## Phase 0.2 — CPU 基础

学习：register / ALU / instruction / opcode / operand / PC / fetch-decode-execute

## Phase 0.3 — 6502 Assembly

学习：mnemonic / machine code / assembler / disassembler

例如：

```
Assembly:  LDA #$42
Machine:   A9 42
```

## Phase 0.4 — Opcode / Addressing Mode

```
Immediate / Zero Page / Absolute / Indexed / Indirect / Relative
```

## Phase 1 — 6502 CPU

实现 NES CPU。包含：Registers / Flags / Instruction / Stack / Interrupt / Timing

## Phase 2 — NES Bus

```
CPU
 |
Bus
 |
RAM / PPU / APU / Controller / Cartridge
```

学习：Address Bus / Data Bus / Memory Mapping / IO Mapping

## Phase 3 — Cartridge

实现：iNES parser / ROM loading / Mapper system。第一目标：Mapper 0

## Phase 4 — PPU

学习：Pixel / Tile / Sprite / VRAM / Rasterization。实现 256×240 framebuffer

## Phase 5 — Controller

实现 NES controller protocol

## Phase 6 — APU

实现 Pulse / Triangle / Noise

## Phase 7 — macOS Renderer

```
Framebuffer → Metal Texture → Display
```

---

# 5. Computer Science Knowledge Requirements

Agent 在进入下一阶段前必须确认用户理解：

## Binary

解释：为什么计算机使用 `0` `1`；什么是 bit / byte / word

## Hexadecimal

必须解释 `0x42` 表示 `01000010`

## Two's Complement

必须解释为什么 `0xFF` 可以表示 `255`，也可以表示 `-1`

## Overflow Flag (V)

必须解释 C 与 V 的区别：

```
C = 无符号溢出（bit 7 的进位出）
V = 有符号溢出（carry_into_bit7 XOR carry_out_of_bit7）
N = result 的 bit 7，不是判决
```

并必须解释：`A - M` 后的真实符号是 `N XOR V`。

见 `docs/computer-science/overflow-flag.md` 与 `src/core/alu.hpp`。

## CPU Concepts

### Register

CPU 内部高速存储，例如 `A` `X` `Y`

### Program Counter

PC 保存下一条指令地址。例如：

```
Memory:   8000 A9
          8001 42

CPU:      PC=8000  fetch A9
          PC=8001  fetch 42
          PC=8002
```

### Instruction Cycle

```
Fetch → Decode → Execute → Update State
```

## Assembly Rules

出现以下符号必须解释：`#` `$` `()` `,`

例如 `LDA #$42`：

```
LDA  load accumulator
#    immediate
$    hexadecimal
```

结果：`A = 0x42`

---

# 6. Coding Rules

## Architecture

禁止 CPU 直接访问 PPU。

错误：

```
CPU
memory[]
PPU
```

正确：

```
CPU
 |
Bus
 |
PPU
```

## Testing

所有核心模块必须测试。测试等级：

```
Unit Test → Instruction Test → Timing Test → Integration Test
```

---

# 7. Current Implementation Status

当前：**Phase 0.4 完成**

已完成：

- CMake + C++20 + Ninja
- GoogleTest 测试框架（115 个单元测试全通过）
- `docs/computer-science/` 基础文档（binary / hexadecimal / twos-complement / bitwise / overflow-flag / cpu / assembly / addressing-modes）
- `src/core/types.hpp` 定宽整数类型
- `src/core/bit.{hpp,cpp}` 位运算工具库
- `src/core/alu.hpp` 加法器与 C/V/Z/N 标志
- `src/core/bus.hpp` / `flat_bus.hpp` 总线抽象
- `src/core/cpu/registers.hpp` A/X/Y/SP/P/PC 与 flag 读写
- `src/core/cpu/opcode.{hpp,cpp}` 完整 256 项表 + Operation 枚举（151 合法、56 助记符）
- `src/core/cpu/disassembler.{hpp,cpp}` 字节流 <-> 汇编
- `src/core/cpu/addressing.{hpp,cpp}` 有效地址计算（13 种模式）
- `src/core/cpu/cpu.{hpp,cpp}` 表驱动派发；**42 个操作 / 101 个 opcode 已实现**
- 5 个教学 demo；5 个测试文件

未完成：

```
ADC SBC AND ORA EOR BIT
PHA PHP PLA PLP
JSR RTS RTI BRK
per-opcode cycle table / interrupts / cycle accuracy
NES Bus memory map / Cartridge / PPU / APU / Controller
Frontend
```

---

# 8. Next Task

下一步必须执行：

```
Phase 1 — 完整 6502 指令集与周期精确
```

任务：

1. 实现 ALU 类操作：`ADC` `SBC` `AND` `ORA` `EOR` `BIT`
   - `ADC`/`SBC` 必须同时正确设置 C 和 V（见 `docs/computer-science/overflow-flag.md`）
   - `BIT` 把操作数的 bit 6 复制到 V
2. 实现栈操作：`PHA` `PHP` `PLA` `PLP`
3. 实现子程序与中断：`JSR` `RTS` `RTI` `BRK`
4. 把 `cycle_cost()` 换成真正的**每 opcode 周期表**（256 项）
5. 实现三个中断向量（NMI / RESET / IRQ）与 I 屏蔽位
6. 写 `docs/computer-science/instruction-set.md` 与 `timing.md`
7. 用已知测试 ROM 或手写的小程序做集成验证

完成标志：`2 + 2 = 4` 通过 `ADC` 算出来，且进位/溢出标志全部正确。

---

# 9. Final Definition of Done

## CPU

- [ ] 完整 6502
- [ ] cycle accurate
- [ ] test ROM 通过

## Memory

- [ ] NES memory map

## Cartridge

- [ ] iNES
- [ ] Mapper

## Graphics

- [ ] PPU
- [ ] Sprite
- [ ] Scrolling

## Audio

- [ ] APU

## macOS

- [ ] Metal renderer

## Tools

- [ ] Debugger
- [ ] Disassembler
- [ ] Save state

## Education

必须存在：

```
docs/
  computer-science/
  assembly/
  architecture/
  nes/
```

并能够解释从 `机器码 → CPU → 像素` 全过程。

---

# Agent 最终原则

不要把这个项目当成"写一个模拟器"。

应该当成"通过实现一个真实系统，学习计算机科学完整链路"。

任何代码，都必须知道：它模拟现实计算机中的哪一个部件。
