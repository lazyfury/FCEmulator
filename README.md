# FC Emulator for macOS

从零实现 NES / FC 模拟器，同时作为计算机科学学习工程。

**不只做产品，还要能解释：ROM 如何变成屏幕上的像素。**

---

## 当前状态

**Phase 3 完成** — Cartridge（iNES 与 Mapper 0）

- [x] CMake 4.4 + C++20 + Ninja
- [x] GoogleTest 1.18 单元测试（205 个测试全通过，其中 12 个跑在真实 ROM 上）
- [x] `src/core/types.hpp` `bit.{hpp,cpp}` `alu.hpp`
- [x] `src/core/bus.hpp` 总线抽象（含 `take_stall_cycles()`）
- [x] `src/core/cpu/` 全部 151 个 opcode、256 项周期表、反汇编器、寻址
- [x] `src/core/nes/` 地址译码、2KB RAM 镜像、open bus、OAM DMA
- [x] `src/core/nes/ines.{hpp,cpp}` **iNES 文件头解析**
- [x] `src/core/nes/mapper.hpp` + `mapper0.hpp` **Mapper 0 (NROM)**
- [x] `src/core/nes/cartridge.{hpp,cpp}` **真正的卡带：加载 .nes 文件**
- [x] 8 个教学 demo；11 个测试文件
- [x] `docs/` 十三章

**现在可以加载真实的 NES ROM 并执行它了：**

```
$8000  SEI             A=$00 X=$00 SP=$FD  ..-..I..
$8001  CLD             A=$00 X=$00 SP=$FD  ..-..I..
$8002  LDA #$10        A=$10 X=$00 SP=$FD  ..-..I..
$8004  STA $2000       A=$10 X=$00 SP=$FD  ..-..I..
$8007  LDX #$FF        A=$10 X=$FF SP=$FD  N.-..I..
$8009  TXS             A=$10 X=$FF SP=$FF  N.-..I..
$800A  LDA $2002       <- 停在这里，等 PPU
```

**下一步：** Phase 4 — PPU（让 `$2002` 真的有东西应答）

完整路线图见 [AGENTS.md](AGENTS.md)。

---

## 构建

依赖：

```bash
brew install cmake ninja googletest
```

构建与测试：

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build
ctest --test-dir build --output-on-failure
```

运行教学 demo：

```bash
./build/demo_bitwise      # 位、字节、数制、补码
./build/demo_overflow     # C 与 V 标志、有符号比较
./build/demo_cpu          # 取指 / 译码 / 执行循环
./build/demo_disasm       # 汇编 <-> 机器码
./build/demo_addressing   # 有效地址、zero page 回绕、JMP 硬件 bug
./build/demo_instructions # 完整指令集、ADC、中断、周期
./build/demo_bus          # 地址译码、镜像、open bus、OAM DMA
./build/demo_cartridge    # iNES 文件头、Mapper 0、运行真实 ROM
```

用真实 ROM 跑测试（默认会查找 `tests/data/*.nes`）：

```bash
ln -s /path/to/game.nes tests/data/game.nes   # 或者：
FC_TEST_ROM=/path/to/game.nes ctest --test-dir build
```

---

## 目录结构

```
FCEmulator/
├── AGENTS.md            AI Agent 执行规范（本项目宪法）
├── CMakeLists.txt
├── docs/                学习文档
│   ├── computer-science/  二进制 / 十六进制 / 补码 / 位运算 / V flag / CPU / 汇编
│   ├── architecture/      系统架构
│   ├── assembly/          6502 汇编索引
│   └── nes/               NES 硬件规范
├── src/
│   ├── core/            纯 C++ 核心，禁止依赖 UI
│   │   ├── types.hpp      定宽整数
│   │   ├── bit.{hpp,cpp}  位运算工具
│   │   ├── alu.hpp        加法器与标志位
│   │   ├── bus.hpp        总线抽象
│   │   ├── flat_bus.hpp   测试替身：64KB 平铺内存
│   │   ├── cpu/           寄存器、opcode 表、反汇编、寻址、表驱动派发
│   │   └── nes/           地址译码、2KB RAM、卡带、iNES、Mapper 0
│   └── frontend/        macOS 前端（Swift/Metal，待实现）
├── tools/               教学 demo 与命令行工具
└── tests/               单元测试
```

---

## 学习入口

**先读 [docs/computer-science/README.md](docs/computer-science/README.md)。**

它解释了为什么本项目不直接从写 CPU 开始。

---

## 设计原则

1. **核心与 UI 分离** — `src/core` 是纯 C++，不知道 Metal 存在
2. **禁止 CPU 直接访问 PPU** — 一切经过 Bus
3. **一切核心模块必须有测试**
4. **每个阶段先理解，再实现**

---

## 路线图

```
Phase 0   工程基础            [done]
Phase 0.1 二进制基础          [done]
Phase 0.2 CPU 基础            [done]
Phase 0.3 6502 汇编           [done]
Phase 0.4 寻址模式            [done]
Phase 1   完整 6502 + 周期精确  [done]
Phase 2   NES Bus 内存映射      [done]
Phase 3   Cartridge / Mapper   [done] <-- 你在这里
Phase 4   PPU                  [next]
Phase 1   6502 CPU
Phase 2   NES Bus
Phase 3   Cartridge / Mapper
Phase 4   PPU
Phase 5   Controller
Phase 6   APU
Phase 7   macOS Metal 渲染
```
