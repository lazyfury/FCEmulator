# NES 硬件规范 nes/

> 状态：Phase 2-6 逐步填充

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

## CPU 内存映射（预告）

```
0x0000 - 0x07FF  2KB 内部 RAM（0x0800-0x1FFF 是它的镜像）
0x2000 - 0x2007  PPU 寄存器（8 字节，其余是镜像）
0x4000 - 0x4017  APU 与 IO
0x4018 - 0x401F  禁用
0x4020 - 0xFFFF  卡带（Mapper 决定布局）
```

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

- `memory-map.md` — 完整内存映射与镜像规则
- `ppu.md` — 渲染管线、Tile、Sprite、滚动
- `apu.md` — 各声道与混音
- `ines-format.md` — 卡带文件格式
- `mappers.md` — Mapper 0/1/2/3/4
- `timing.md` — CPU/PPU 时钟比 3:1、扫描线与帧
