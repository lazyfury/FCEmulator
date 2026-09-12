# FC Emulator for macOS

从零实现 NES / FC 模拟器，同时作为计算机科学学习工程。

**不只做产品，还要能解释：ROM 如何变成屏幕上的像素。**

---

## 当前状态

**Phase 7 完成** — macOS 前端

- [x] CMake 4.4 + C++20 + Ninja
- [x] GoogleTest 1.18 单元测试（429 个测试全通过）
- [x] `src/core/types.hpp` `bit.{hpp,cpp}` `alu.hpp`
- [x] `src/core/bus.hpp` 总线抽象（含 `take_stall_cycles()`）
- [x] `src/core/cpu/` 全部 151 个 opcode、256 项周期表、反汇编器、寻址
- [x] `src/core/nes/` 地址译码、2KB RAM 镜像、open bus、OAM DMA
- [x] `src/core/nes/ines.{hpp,cpp}` **iNES 文件头解析**
- [x] **Mapper 0 / 1 / 2 / 3 / 4 / 7 / 9 / 10 / 11 / 13 / 15 / 18 / 19 / 21 / 22 / 23 / 25 / 32 / 33 / 66 / 68 / 71 / 78 / 87 / 162 / 163 / 164 / 177 / 178 / 190 / 226 / 227 / 242 / 246 / 249**
      （NROM、MMC1、UxROM、CNROM、MMC3 含扫描线 IRQ、AxROM、
      MMC2、MMC4、Color Dreams、CPROM、100-in-1、SS88006、Namco 163、
      VRC2/VRC4、IREM、Taito、GxROM、Sunsoft-4、Codemasters、Jaleco、
      Waixing、Nanjing、Henggedianzi、Magic Kid Goo Goo、多合一、T9552）
      `src/core/nes/mapper0.hpp` … `mapper15.hpp`
- [x] `src/core/nes/cartridge.{hpp,cpp}` 真正的卡带：加载 .nes 文件
- [x] `src/core/nes/ppu.{hpp,cpp}` **PPU：渲染管线、精灵、滚动、sprite 0 hit**
- [x] `src/core/nes/machine.{hpp,cpp}` **CPU/PPU 3:1 同步、NMI 传递**
- [x] `src/core/nes/framebuffer.hpp` 256×240 输出
- [x] `src/core/nes/controller.hpp` 手柄串行协议，两个端口接在 `$4016`/`$4017`
- [x] `src/core/nes/apu.{hpp,cpp}` **五个声道、包络、长度/线性计数器、扫频、帧序列器、非线性混音、DMC**
- [x] 11 个教学 demo；15 个测试文件
- [x] `docs/` 十七章
- [x] `src/ffi/emulator_api.h` **纯 C 接口**
- [x] `frontend/` **Swift + Metal + CoreAudio 前端**，含可验证的无头模式

**现在能运行真实的 NES ROM 并画出画面了：**

```bash
./build/demo_ppu "" 240
sips -s format png frames/frame_240.ppm --out frame.png
```

```
第 8-22 行   状态栏文字（MARIO / WORLD 1-1 / TIME）
第 40-150 行 SUPER MARIO BROS. 大标题
第 192-206 行 马里奥本人（精灵渲染正确）
第 208-238 行 地面砖块
```

**现在可以模拟按键并让游戏真的玩起来：**

```bash
./build/demo_input
```

```
无输入 120 帧:     218 个像素变化  (0.35%)   标题画面静止
按下 Start 5 帧: 57207 个像素变化  (93.11%)  游戏开始了
按住 Right 180 帧: 14763 个像素变化          关卡滚动了
```

**现在有声音了：**

```bash
./build/demo_apu
afplay frames/game_audio.wav
```

```
  samples        : 440277  (9.98 seconds)
  peak           : 0.68
  channels on    : $0f   (pulse 1, pulse 2, triangle, noise)
  frames audible : 459 of 600
```

**而且可以在窗口里玩了：**

```bash
./frontend/build.sh
open frontend/build/FCEmulator.app --args /path/to/game.nes
```

```
CPU  / Bus / Cartridge / PPU / APU / Controller   <- Core, 无需 UI
                     |
              src/ffi/emulator_api.h              <- 纯 C 边界
                     |
      AppKit + Metal + CoreAudio (Swift)          <- 前端
```

**项目完成。** 从二进制到屏幕上的像素，全链路打通。

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
./build/demo_cartridge    # iNES 文件头、Mapper 0-15、运行真实 ROM
./build/demo_ppu          # 渲染真实游戏的画面 -> PPM
./build/demo_input        # 模拟按键，标题画面 -> 开始游戏
./build/demo_apu          # 五个声道的波形 -> game_audio.wav

# 前端
./frontend/build.sh
./frontend/build/FCEmulator.app/Contents/MacOS/FCEmulator <rom> --headless 700 --start --dump f.ppm
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
│   │   └── nes/           地址译码、卡带、PPU、APU、手柄、Machine
│   └── ffi/            纯 C 接口（前端唯一需要链接的东西）
├── frontend/           Swift + Metal + CoreAudio 前端
│   ├── Sources/
│   └── build.sh
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
Phase 3   Cartridge / Mapper   [done]
Phase 4   PPU                  [done]
Phase 5   Controller           [done]
Phase 6   APU                  [done]
Phase 7   macOS Metal 前端      [done] <-- 全部完成
Phase 1   6502 CPU
Phase 2   NES Bus
Phase 3   Cartridge / Mapper
Phase 4   PPU
Phase 5   Controller
Phase 6   APU
Phase 7   macOS Metal 渲染
```
