# 系统架构 architecture/

> 状态：Phase 2 待填充

## 目标结构

```
+-------------------------------------------+
|                  NES Core                 |
|                                           |
|   CPU ---- Bus ---- PPU ---- Framebuffer  |
|    |        |        |                    |
|   APU    Cartridge  VRAM (2KB)            |
|    |        |                             |
|  Controller Mapper                        |
+-------------------------------------------+
                     |
              Emulator API
                     |
                 Swift/Metal
                     |
                  Screen
```

## 硬性规则（来自 AGENTS.md）

### 规则 1：CPU 不得直接访问 PPU

```
错误                         正确
CPU                           CPU
 |                             |
memory[]                       Bus
 |                             |
PPU                           PPU
```

CPU 只知道"我要往地址 `0x2006` 写一个字节"。
是 Bus 决定了这个写操作其实是发给 PPU 的。

**收益：** CPU 实现可以完全独立测试；换一台机器（Game Boy）只需换 Bus 和 PPU。

### 规则 2：Core 不得依赖 UI

`src/core/` 里的代码不能 `#include <Metal/Metal.h>`，不能出现 `NSWindow`。
Core 只产出一个 `256×240` 的 RGB framebuffer，谁来显示它由 `src/frontend/` 决定。

**收益：** Core 可以在命令行、测试、无头环境下运行。

### 规则 3：一切通信经过 Bus

```
CPU 读 0x8000  ->  Bus 判断：>= 0x4020 且 < 0x6000? -> Cartridge (PRG ROM)
CPU 读 0x2002  ->  Bus 判断：在 PPU 寄存器区?        -> PPU
CPU 读 0x0000  ->  Bus 判断：< 0x2000?               -> RAM
```

## 待写文档

- `overview.md` — 模块职责与依赖方向
- `bus.md` — 内存映射与 IO 映射
- `render-pipeline.md` — Framebuffer 到 Metal 纹理
