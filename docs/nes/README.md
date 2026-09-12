# NES 硬件规范 nes/

> 状态：**Phase 2 / 3 已完成**（内存映射 + 卡带），其余待 Phase 4-6 逐步填充

## 已完成

| 内容 | 位置 |
|------|------|
| CPU 内存映射与地址译码 | [memory-map.md](memory-map.md) |
| 镜像（unwired address lines） | [memory-map.md](memory-map.md) 第 2-3 节 |
| Open bus | [memory-map.md](memory-map.md) 第 4 节 |
| OAM DMA | [memory-map.md](memory-map.md) 第 5 节 |
| **iNES 文件格式** | [ines-format.md](ines-format.md) |
| **Mapper 0 (NROM)** | [ines-format.md](ines-format.md) 第 3 节 |
| **CHR 位平面与 tile 格式** | [ines-format.md](ines-format.md) 第 4 节 |
| **真实 ROM 运行与调试** | [ines-format.md](ines-format.md) 第 5 节 |
| 实现 | `src/core/nes/` |
| 可运行讲解 | `tools/demo_bus.cpp` `tools/demo_cartridge.cpp` |

```bash
./build/demo_bus
./build/demo_cartridge [path/to/game.nes]
./build/tests/fc_tests --gtest_filter='NesBus.*:Ines.*:Mapper0.*:Cartridge.*:SuperMarioBros.*'
```

## NES 硬件速览

| 部件 | 规格 |
|------|------|
| CPU | Ricoh 2A03（6502 变体，去掉十进制模式，集成 APU） |
| CPU 主频 | 1.789773 MHz (NTSC) |
| CPU 地址空间 | 16 位 / 64KB |
| 内置 RAM | 2KB |
| PPU | Ricoh 2C02 |
| 显存 VRAM | 2KB |
| OAM | 256 字节 / 64 个精灵 |
| 分辨率 | 256 × 240 |
| 调色板 | 主调色板 64 色，同屏最多 25 色 |
| 卡带 ROM | PRG ROM + CHR ROM |
| 音频 | 2 Pulse + 1 Triangle + 1 Noise + DMC |

## CPU 内存映射

```
$0000 - $07FF   2KB 内部 RAM
$0800 - $1FFF   RAM 镜像（每 2KB 重复，共 4 次）
$2000 - $3FFF   PPU 寄存器（8 字节，每 8 字节重复，共 1024 次）
$4000 - $4017   APU、手柄、OAM DMA
$4018 - $401F   禁用
$4020 - $FFFF   卡带（Mapper 决定布局）
```

详见 [memory-map.md](memory-map.md)。

## 中断向量

```
0xFFFA - 0xFFFB   NMI 向量
0xFFFC - 0xFFFD   RESET 向量   <- CPU 上电后从这里读取入口地址
0xFFFE - 0xFFFF   IRQ 向量
```

**注意：向量按小端序存放。** 如果 `0xFFFC = 0x00`、`0xFFFD = 0x80`，
则入口地址是 `0x8000`（低字节在前）。

这正是 [../computer-science/binary.md](../computer-science/binary.md) 第 6 节讲的 `make_u16(lo, hi)`。

## 待写文档

- `ppu.md` — 渲染管线、Tile、Sprite、滚动（Phase 4）
- `apu.md` — 各声道与混音（Phase 6）
- `mappers.md` — Mapper 1/2/3/4（Phase 3 后续）
- `controllers.md` — 手柄协议（Phase 5）
