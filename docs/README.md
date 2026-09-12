# 学习文档 docs/

按 AGENTS.md 的要求，本项目必须能解释从**机器码到像素**的完整链路。
文档按层次组织：

```
docs/
├── computer-science/   计算本身：bit、数制、补码、位运算、CPU、汇编
├── architecture/       系统设计：模块边界、总线、渲染管线
├── assembly/           6502 指令与寻址模式
└── nes/                NES 硬件规范：内存映射、PPU、APU、Mapper
```

## 已完成

| 文档 | 状态 |
|------|------|
| [computer-science/binary.md](computer-science/binary.md) | ✅ |
| [computer-science/hexadecimal.md](computer-science/hexadecimal.md) | ✅ |
| [computer-science/twos-complement.md](computer-science/twos-complement.md) | ✅ |
| [computer-science/bitwise-operations.md](computer-science/bitwise-operations.md) | ✅ |
| [computer-science/overflow-flag.md](computer-science/overflow-flag.md) | ✅ |
| [computer-science/cpu.md](computer-science/cpu.md) | ✅ |
| [computer-science/assembly.md](computer-science/assembly.md) | ✅ |
| [computer-science/addressing-modes.md](computer-science/addressing-modes.md) | ✅ |

## 待完成

| 文档 | 阶段 |
|------|------|
| computer-science/instruction-set.md | Phase 1 |
| computer-science/timing.md | Phase 1 |
| assembly/mnemonics.md | Phase 0.3 |
| assembly/addressing-modes.md | Phase 0.4 |
| nes/memory-map.md | Phase 2 |
| nes/ppu.md | Phase 4 |
| nes/apu.md | Phase 6 |
| architecture/overview.md | Phase 2 |

## 写作规范

每篇文档必须回答三个问题：

1. **现实中硬件是怎么做的？**（不是"我们代码怎么写"）
2. **为什么必须这样做？**（约束从哪来）
3. **我们的代码对应哪一部分？**（给出文件与函数名）

文档中出现的每一段代码都要能被运行或测试验证。

---

**入口：** [computer-science/README.md](computer-science/README.md)
