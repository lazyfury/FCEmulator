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

当前：**Phase 2 完成**

已完成：

- CMake + C++20 + Ninja
- GoogleTest 测试框架（172 个单元测试全通过）
- `docs/` 十二章（computer-science 十章 + nes/memory-map + architecture/bus）
- `src/core/types.hpp` 定宽整数类型
- `src/core/bit.{hpp,cpp}` 位运算工具库
- `src/core/alu.hpp` 加法器与 C/V/Z/N 标志
- `src/core/bus.hpp` 总线抽象，含 `take_stall_cycles()`
- `src/core/cpu/` 全部 56 个操作 / 151 个 opcode、256 项周期表、反汇编器
- `src/core/nes/device.hpp` Device / OamTarget 接口
- `src/core/nes/ram.hpp` 2KB RAM（掩码就是未接的地址线）
- `src/core/nes/bus.{hpp,cpp}` 完整地址译码、镜像、open bus、OAM DMA
- `src/core/nes/ram_cartridge.hpp` 卡带槽占位
- 7 个教学 demo；9 个测试文件

未完成：

```
iNES parser / PRG & CHR ROM / Mapper 0 (and beyond)
PPU / APU / Controllers
Frontend (Swift + Metal)
Bus-level cycle accuracy (RMW dummy write, mid-instruction interrupt sampling)
```

---

# 8. Next Task

下一步必须执行：

```
Phase 3 — Cartridge（iNES 格式与 Mapper 0）
```

背景：卡带槽现在是 `RamCartridge`（`src/core/nes/ram_cartridge.hpp`），
一块 48KB 的 RAM 占位。真正的卡带要读 `.nes` 文件。

任务：

1. 讲解 ROM / PRG ROM / CHR ROM / mapper / bank switching
2. 创建 `docs/nes/ines-format.md` 与 `docs/nes/mappers.md`
3. 实现 `src/core/nes/cartridge.hpp`：iNES 文件头解析
   - 16 字节文件头：`NES\x1A`、PRG 页数、CHR 页数、flags 6/7
   - 识别 mapper 号（flags 6 高 4 位 + flags 7 高 4 位）
   - 识别镜像模式（水平 / 垂直 / 四屏）
4. 实现 Mapper 0（NROM）：
   - 16KB PRG 镜像到 `$8000-$BFFF` 和 `$C000-$FFFF`
   - 32KB PRG 直接映射
   - 8KB CHR ROM 无 bank 切换
5. 写一个小的测试 ROM（手工拼接字节，不需要真游戏）
6. 用真实 Cartridge 替换 `RamCartridge` 跑集成测试

**完成标志：能从字节流解析出一个合法的 iNES 头，并让 Mapper 0 正确应答 `$8000-$FFFF`。**

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
