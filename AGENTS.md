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

当前：**Phase 1 完成**

已完成：

- CMake + C++20 + Ninja
- GoogleTest 测试框架（154 个单元测试全通过）
- `docs/computer-science/` 十章（binary / hexadecimal / twos-complement / bitwise / overflow-flag / cpu / assembly / addressing-modes / instruction-set / timing）
- `src/core/types.hpp` 定宽整数类型
- `src/core/bit.{hpp,cpp}` 位运算工具库
- `src/core/alu.hpp` 加法器与 C/V/Z/N 标志
- `src/core/bus.hpp` / `flat_bus.hpp` 总线抽象
- `src/core/cpu/registers.hpp` A/X/Y/SP/P/PC 与 flag 读写
- `src/core/cpu/opcode.{hpp,cpp}` 256 项 opcode 表 + 256 项周期表
- `src/core/cpu/disassembler.{hpp,cpp}` 字节流 <-> 汇编
- `src/core/cpu/addressing.{hpp,cpp}` 有效地址计算（13 种模式）
- `src/core/cpu/cpu.{hpp,cpp}` **全部 56 个操作 / 151 个 opcode**、NMI/IRQ/BRK/RTI
- 6 个教学 demo；8 个测试文件

未完成：

```
NES bus address decoding / RAM mirroring / PPU & APU register windows
Cartridge / iNES / Mappers
PPU / APU / Controller
Frontend (Swift + Metal)
RMW dummy write, bus-level cycle accuracy
```

---

# 8. Next Task

下一步必须执行：

```
Phase 2 — NES Bus（内存映射与地址译码）
```

背景：现在 CPU 接的是一个平铺的 64KB `FlatBus`（`src/core/flat_bus.hpp`）。
真正的 NES 总线要把 16 位地址译码成不同的设备。

任务：

1. 讲解 address bus / data bus / address decoding / memory mirroring
2. 创建 `docs/nes/memory-map.md` 与 `docs/architecture/bus.md`
3. 实现 `src/core/nes/bus.hpp`：内存映射
   ```
   $0000-$07FF  2KB RAM
   $0800-$1FFF  RAM 镜像（每 2KB 重复 4 次）
   $2000-$3FFF  PPU 寄存器（每 8 字节重复）
   $4000-$4017  APU / IO
   $4018-$401F  禁用
   $4020-$FFFF  卡带（Phase 3）
   ```
4. 写 `Ram` 类与镜像测试（穷举 $0000-$1FFF 的镜像关系）
5. 用真正的 NES Bus 替换 `FlatBus` 跑现有的 CPU 测试
6. 接入 OAM DMA（$4014）—— 这是最简单的一个真实硬件交互

**完成标志：写 `$0800` 与写 `$0000` 效果相同，且可以用穷举测试证明。**

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
