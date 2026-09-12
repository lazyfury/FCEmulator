# 6502 汇编 assembly/

> 状态：Phase 0.3 / 0.4 待填充

## 计划内容

- `mnemonics.md` — 56 条合法指令、助记符、机器码对照
- `addressing-modes.md` — Immediate / Zero Page / Absolute / Indexed / Indirect / Relative
- `opcode-table.md` — 256 个 opcode 完整表

## 已经可以解释的知识点

AGENTS.md 要求出现下列符号必须解释：

| 符号 | 含义 | 例子 |
|------|------|------|
| `LDA` | 助记符：Load Accumulator | `LDA #$42` → `A = 0x42` |
| `#` | Immediate，操作数是立即数而非地址 | `#$42` = 数字 66 |
| `$` | 十六进制前缀（等价 C 的 `0x`） | `$42` = `0x42` |
| `()` | Indirect，先取地址再取内容 | `($0200)` |
| `,` | Indexed，加索引寄存器 | `$8000,X` |

## 最小例子

```
Assembly:   LDA #$42
Machine:    A9 42
            ^^ opcode (LDA immediate)
               ^^ operand (0x42)
```

CPU 执行后：`A = 0x42`，且 `Z` flag 清零（结果非零），`N` flag 清零（bit7 = 0）。

## 前置知识

必须先读完 [../computer-science/twos-complement.md](../computer-science/twos-complement.md)
和 [../computer-science/bitwise-operations.md](../computer-science/bitwise-operations.md)，
否则无法理解相对寻址的偏移量和标志位。
