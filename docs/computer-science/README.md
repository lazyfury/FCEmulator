# 计算机科学基础 Computer Science Foundations

> 这一目录不是"模拟器文档"，而是**为什么代码这样写**的解释。
> AGENTS.md 规定：进入下一阶段前，必须确认这里的内容已经理解。

---

## 阅读顺序

| # | 文档 | 核心问题 | 何时需要 |
|---|------|---------|---------|
| 1 | [binary.md](binary.md) | 为什么是 0/1？bit 怎么变成数字？ | 立刻 |
| 2 | [hexadecimal.md](hexadecimal.md) | 为什么 `0x42` 就是 `0100 0010`？ | 立刻 |
| 3 | [twos-complement.md](twos-complement.md) | CPU 没有减法器怎么做减法？C 和 V 有何不同？ | 立刻（Phase 1 前必须懂） |
| 4 | [bitwise-operations.md](bitwise-operations.md) | ALU 到底能做什么？ | 立刻 |
| 5 | cpu.md | 寄存器、取指译码执行 | Phase 0.2（待写） |
| 6 | assembly.md | 助记符、机器码、汇编器 | Phase 0.3（待写） |
| 7 | addressing-modes.md | 六种寻址模式 | Phase 0.4（待写） |

---

## 为什么先学这些，而不是直接写 CPU

因为 6502 模拟器里 **90% 的 bug 都是这四章的直接后果**：

| Bug 现象 | 根因 |
|---------|------|
| 游戏画面错位、角色抖动 | 有符号/无符号混用 |
| 分数显示错误、比较永远成立 | overflow flag (V) 判断错 |
| 跳转跳飞、程序崩溃 | 相对寻址没有用补码解释偏移 |
| 标志位全乱 | 掩码写错、用 `&` 当 `&&` |
| 内存数据颠倒 | 小端序 lo/hi 弄反 |

**先花一天看透这几章，能省掉后面一周的调试。**

---

## 与代码的对应关系

```
docs/computer-science/binary.md             <->  src/core/bit.hpp  to_binary()
docs/computer-science/hexadecimal.md        <->  src/core/bit.cpp  to_hex()
docs/computer-science/twos-complement.md    <->  src/core/bit.hpp  negate(), as_signed()
docs/computer-science/bitwise-operations.md <->  src/core/bit.hpp  test/set/clear/toggle/extract()

可运行版本:  tools/demo_bitwise.cpp
自动验证:    tests/test_bit.cpp
```

---

## 建议的学习方法

```bash
# 1. 读文档
open docs/computer-science/binary.md

# 2. 跑 demo，对照输出
./build/demo_bitwise

# 3. 跑测试，看每条断言
./build/tests/fc_tests --gtest_filter='TwosComplement.*'

# 4. 改代码，故意写错，看测试如何抓住你
#    例如把 bit::negate 改成 return ~value;  (忘了 +1)
#    重新构建后应该看到哪些测试失败？

# 5. 修复，确认全部通过
```

**第 4 步最重要。** 一个"不会失败的测试"等于没有测试。
故意破坏代码、观察测试是否报警，才能证明测试真的在检查东西。

---

## 检验标准

学完这四章，你应该能**不看文档**回答：

1. `0x42` 的二进制是什么？
2. `-5` 的 8 位补码是什么？
3. `0x7F + 1` 的 C 和 V 分别是多少？为什么不同？
4. 分支偏移 `0xFB` 是向前还是向后跳几字节？
5. 如何只清掉一个 byte 的 bit 5？
6. 为什么 NES 需要 16 位地址？
7. `0xFF` 为什么可以既是 255 又是 -1？

如果第 3、4、7 题有迟疑，回到 [twos-complement.md](twos-complement.md)。
