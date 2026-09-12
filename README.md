# FC Emulator for macOS

从零实现 NES / FC 模拟器，同时作为计算机科学学习工程。

**不只做产品，还要能解释：ROM 如何变成屏幕上的像素。**

---

## 当前状态

**Phase 1 完成** — 完整 6502 指令集与周期精确

- [x] CMake 4.4 + C++20 + Ninja
- [x] GoogleTest 1.18 单元测试（154 个测试全通过）
- [x] `src/core/types.hpp` 定宽整数类型
- [x] `src/core/bit.{hpp,cpp}` 位运算工具库
- [x] `src/core/alu.hpp` 加法器与 C/V/Z/N 标志
- [x] `src/core/bus.hpp` / `flat_bus.hpp` 总线抽象
- [x] `src/core/cpu/registers.hpp` A/X/Y/SP/P/PC 与 flag 读写
- [x] `src/core/cpu/opcode.{hpp,cpp}` 256 项 opcode 表 + **256 项周期表**
- [x] `src/core/cpu/disassembler.{hpp,cpp}` 字节流 ↔ 汇编
- [x] `src/core/cpu/addressing.{hpp,cpp}` 有效地址计算（13 种模式）
- [x] `src/core/cpu/cpu.{hpp,cpp}` **全部 56 个操作 / 151 个 opcode**、中断
- [x] 6 个教学 demo；8 个测试文件
- [x] `docs/computer-science/` **十章**基础文档

**下一步：** Phase 2 — NES Bus（内存映射、镜像、PPU 寄存器窗口）

```
现在：      CPU + 平铺 64KB 内存 (FlatBus)
Phase 2：   CPU + 真正的 NES 地址译码 + 2KB RAM 镜像 + PPU/APU/卡带窗口
```

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
│   │   ├── flat_bus.hpp   测试用 64KB 内存
│   │   └── cpu/           寄存器、opcode 表、反汇编、寻址、表驱动派发
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
Phase 0   工程基础          [done]
Phase 0.1 二进制基础        [done]
Phase 0.2 CPU 基础          [done]
Phase 0.3 6502 汇编         [done]
Phase 0.4 寻址模式          [done]
Phase 1   完整 6502 + 周期精确  [done] <-- 你在这里
Phase 2   NES Bus 内存映射      [next]
Phase 1   6502 CPU
Phase 2   NES Bus
Phase 3   Cartridge / Mapper
Phase 4   PPU
Phase 5   Controller
Phase 6   APU
Phase 7   macOS Metal 渲染
```
