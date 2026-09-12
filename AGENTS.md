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

当前：**Phase 4 完成**

已完成：

- CMake + C++20 + Ninja
- GoogleTest 测试框架（250 个单元测试全通过）
- `docs/` 十三篇（computer-science 十章 + nes 两篇 + architecture 一篇）
- `src/core/bit.{hpp,cpp}` `types.hpp` `alu.hpp`
- `src/core/bus.hpp` 总线抽象（含 `take_stall_cycles()`）
- `src/core/cpu/` 全部 151 个 opcode、256 项周期表、反汇编器、13 种寻址
- `src/core/nes/device.hpp` Device / OamTarget 接口
- `src/core/nes/ram.hpp` 2KB RAM（掩码就是未接的地址线）
- `src/core/nes/bus.{hpp,cpp}` 地址译码、镜像、open bus、OAM DMA
- `src/core/nes/ines.{hpp,cpp}` iNES 文件头解析
- `src/core/nes/mapper.hpp` + `mapper0.hpp` Mapper 0 (NROM)
- `src/core/nes/cartridge.{hpp,cpp}` 真正的卡带
- `src/core/nes/ppu.{hpp,cpp}` PPU：8 个寄存器、VRAM、调色板、OAM、扫描线时序、背景/精灵渲染、sprite 0 hit
- `src/core/nes/machine.{hpp,cpp}` CPU 与 PPU 的 3:1 同步与 NMI
- `src/core/nes/ram_cartridge.hpp` 卡带槽占位（测试用）
- 9 个教学 demo；12 个测试文件

未完成：

```
PPU (its registers answer open bus today, which is where the ROM blocks)
APU / Controllers
Mappers 1, 2, 3, 4...
Frontend (Swift + Metal)
Bus-level cycle accuracy (RMW dummy write, mid-instruction interrupt sampling)
```

---

# 8. Next Task

下一步必须执行：

```
Phase 5 — Controller（按键输入）
```

背景：Phase 4 已经能渲染出正确画面。但游戏无法操作——`$4016`/`$4017`
没有设备应答，读回来的是 open bus，所以按键永远是"没按"。

任务：

1. 讲解手柄的串行协议（strobe 锁存 + 逐位移出）
2. 实现 `src/core/nes/controller.hpp`：
   - `$4016` 写入：bit 0 是 strobe。写 1 锁存，写 0 开始移出
   - `$4016`/`$4017` 读取：bit 0 是下一个按键位，其余位是 open bus
   - 按键顺序固定：A, B, Select, Start, Up, Down, Left, Right
   - `D` 键位在标准手柄上是空的（0）
3. 把两个手柄接到 `NesBus` 的 `$4016`/`$4017`
4. 写单元测试：strobe 行为、8 次读取的顺序、连续读取返回 1
5. 写 `docs/nes/controllers.md`
6. 在 `demo_ppu` 里加一个"模拟按键"的模式，让游戏真正开始

**完成标志：能用程序模拟按下 Start 键，并观察到游戏从标题画面进入第一关。**

> 注意：现在总线的 `$4000-$4017` 是整体转发给 `set_apu()` 的。
> Phase 5 需要把 `$4016`/`$4017` 单独分出来给手柄，
> 顺便把 `$4015`（APU 状态）也考虑进去。

---

# 9. Final Definition of Done

## CPU

- [x] 完整 6502（151/151 opcode）
- [x] cycle accurate（指令级；总线级仍缺 RMW 伪写等）
- [ ] test ROM 通过

## Memory

- [x] NES memory map（含镜像与 open bus）

## Cartridge

- [x] iNES
- [x] Mapper 0 (NROM)
- [ ] Mapper 1/2/3/4

## Graphics

- [x] PPU（寄存器、VRAM、调色板、扫描线时序）
- [x] Sprite（含 8x16、翻转、优先级）
- [x] Scrolling（loopy v/t/x/w）
- [x] 真实 ROM 渲染出正确画面

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
