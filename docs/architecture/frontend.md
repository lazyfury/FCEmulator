# macOS 前端 Frontend

> 目标：解释 Core 和界面之间的那条线在哪里、为什么在那里，以及一个前端最少需要做什么。
>
> 相关：[bus.md](bus.md) — 为什么 Core 不依赖 UI

---

## 1. 那条线在哪里

AGENTS.md 里有一条硬性规则：**Core 不得依赖 UI。**

```
+-----------------------------------------------------+
|                     Core (C++)                      |
|   CPU / Bus / Cartridge / PPU / APU / Controller    |
|                                                     |
|   产出的全部东西：                                   |
|     const uint32_t*  256x240 像素, 0x00RRGGBB       |
|     float[]          44100 Hz 采样                  |
|   接受的唯一输入：                                   |
|     set_button(button, pressed)                     |
+--------------------------+--------------------------+
                           |
                    C 接口 (src/ffi)
                           |
+--------------------------+--------------------------+
|                Frontend (Swift)                     |
|   AppKit 窗口 / Metal 渲染 / CoreAudio 播放 / 键盘    |
+-----------------------------------------------------+
```

**这条线是物理的**：`src/ffi/emulator_api.h` 是纯 C。Swift 不能直接调用 C++，
但可以零成本调用 C。这个文件是整个项目里最笨的一个——没有类、没有模板、没有异常。

### 为什么这么划

| 如果 Core 里有 UI 代码 | 后果 |
|---|---|
| `#include <Metal/Metal.h>` | 无头环境下不能跑测试 |
| `NSWindow` | 换平台要重写核心 |
| 键盘事件处理 | 录像回放和真实按键走两条不同的路 |

**现在，测试和 CI 在没有窗口的机器上跑完整套 300+ 个测试。**

---

## 2. C 接口

```c
typedef struct fc_machine fc_machine;      /* 不透明的句柄 */

fc_machine* fc_create(void);
void        fc_destroy(fc_machine*);

bool        fc_load_rom(fc_machine*, const uint8_t* data, size_t size);
const char* fc_last_error(const fc_machine*);

bool        fc_run_frame(fc_machine*);     /* 跑一帧 */
bool        fc_is_halted(const fc_machine*);

const uint32_t* fc_framebuffer(const fc_machine*);   /* 256x240 */
size_t      fc_take_samples(fc_machine*, float* out, size_t max);
void        fc_set_button(fc_machine*, fc_button, bool pressed, int port);
```

### 三条设计约束

**1. `fc_framebuffer` 返回的指针属于 machine。**

```c
const uint32_t* p = fc_framebuffer(m);   /* 缓存它 */
for (;;) {
    fc_run_frame(m);                     /* 内容变，指针不变 */
    upload(p);                           /* 零拷贝 */
}
```

**前端不需要每帧 memcpy 240KB。** 指针稳定，内容原地更新。

**2. `fc_take_samples` 不分配内存、不加锁。**

它可以在音频回调里调用。Core 侧是 `Apu::drain()`：

```cpp
std::size_t Apu::drain(f32* out, std::size_t max_samples) noexcept
{
    const std::size_t count = std::min(max_samples, samples_.size());
    std::copy_n(samples_.begin(), count, out);
    samples_.erase(samples_.begin(), samples_.begin() + count);
    return count;
}
```

**3. 每个函数都接受 `nullptr`。** 忘记检查的前端得到 0，不是崩溃。

```cpp
TEST(CApi, EveryFunctionSurvivesANullHandle)
```

---

## 3. 三个时钟

```
    显示器刷新率 (60 Hz)
            |
            v
    MTKView 的 draw(in:)
            |
            +--> renderer.onFrame?()   <-- 跑一帧模拟
            |          |
            |          +--> fc_run_frame()
            |          +--> fc_take_samples() -> 环形缓冲
            |          +--> renderer.framebuffer = fc_framebuffer()
            |
            +--> 纹理上传 + 绘制
```

**窗口本身就是模拟器的时钟。** 没有 Timer，没有额外线程，画面和模拟天然同步。

> NES 实际是 60.0988 Hz 而不是 60.000。这里用显示器刷新率近似，
> 前端要做得精确需要一个按时间戳积分的调度器。

---

## 4. 音频：环形缓冲

```
    模拟线程  --写-->  环形缓冲  --读-->  音频线程
```

模拟器一帧一帧地**突发**产生音频；声卡以**绝对固定**的速率消费它。中间必须有个缓冲。

```swift
func push(_ samples: UnsafePointer<Float>, count: Int)    // 模拟线程
private func pop(into: UnsafePointer<Float>, count: Int) -> Int   // 音频线程
```

**只有环形缓冲是共享的。** 模拟器本身只被一个线程碰，这让问题简单了一个数量级。

### 诚实说明：这里的锁不该存在

音频回调里加锁是实时性违规——如果模拟线程持锁，回调会阻塞，扬声器就会爆音。

**正确的做法是无锁 SPSC 队列**（约 30 行原子操作）。我把它写在这里而不是悄悄忽略：

```swift
private let lock = NSLock()   // TODO: replace with atomics
```

环形缓冲满了的时候丢**最旧**的采样而不是最新的——小幅跳一下比越落越远好。

---

## 5. Metal：一个纹理和二十行着色器

```swift
texture.replace(region: ..., withBytes: framebuffer, bytesPerRow: 256 * 4)
```

**没有转换。** Core 给的是 `uint32` 的 `0x00RRGGBB`，在小端机器内存里就是 `B, G, R, 0`——
正好是 `.bgra8Unorm`。所以这是一次纯拷贝。

### 两个细节

**采样器必须是 nearest。**

```swift
samplerDescriptor.minFilter = .nearest
samplerDescriptor.magFilter = .nearest
```

这里的每个像素都是刻意的。线性过滤会把像素艺术变成糊。

**着色器在运行时从字符串编译。**

```swift
let library = try device.makeLibrary(source: source, options: nil)
```

这不是为了绕过这台机器缺少 `metal` 编译器的权宜之计——它意味着前端是**四个源文件、零构建步骤**，
没有 `.metallib` 要和代码保持同步。

### 长宽比

NES 的像素**不是方的**：256 个像素铺在 4:3 屏幕上，每个像素是 8:7。

```swift
private func updateScale(for size: CGSize) {
    let viewAspect = Float(size.width / max(size.height, 1))
    let imageAspect = Float(width) / Float(height)
    ...
}
```

顶点着色器接受一个 `scale`，把画面按比例塞进视图而不变形。

---

## 6. 键盘

```swift
static let mapping: [UInt16: Emulator.Button] = [
    123: .left, 124: .right, 125: .down, 126: .up,   // 方向键
    6: .a, 38: .b,                                    // Z, J
    36: .start, 60: .select,
]
```

**这里没有的东西和有的东西一样重要：** 没有连发、没有去抖、没有长按、没有组合键。

**因为手柄里也没有。** 那些全部属于前端或游戏。如果在 Core 的 `Controller` 里实现连发，
录像回放就会和真实按键走不同的路。

### 失去焦点时必须松开所有键

```swift
override func resignFirstResponder() -> Bool {
    keyboard.releaseAll(emulator: emulator)
    return super.resignFirstResponder()
}
```

否则你按住右键切到别的窗口，马里奥会一直往右跑。

---

## 7. 无头模式：让前端可测试

```bash
FCEmulator game.nes --headless 700 --start --dump frame.ppm
```

```
frames run      : 700
frame counter   : 700
cpu cycles      : 20846468
cpu pc          : $8117
halted          : false
audio peak      : 0.685
frames audible  : 460
wrote           : /tmp/ffi_started.ppm
```

**它存在的理由有两个：**

1. 让整个前端（包括 C 接口、Swift 绑定、输入映射）**在没有显示器的环境下可验证**
2. 出问题时第一件事就是跑它——**如果 `--headless` 画出正确的画面，问题就在窗口里，不在 Core 里**

实测对照：

```
无输入 400 帧:   audio peak 0.000,   frames audible   0   <- 标题画面静音
按 Start 700 帧: audio peak 0.685,   frames audible 460   <- 音乐在放
```

**这和一个真实的 NES 行为一致**（见 [../nes/apu.md](../nes/apu.md) 第 9 节）。

---

## 8. 构建

```bash
./frontend/build.sh
```

它做三件事：

```
1. cmake 构建 Core（libfc_core.a + libfc_ffi.a）
2. swiftc 编译四个 Swift 文件，用 -import-objc-header 桥接 C 头文件
3. 拼出 .app bundle + Info.plist + ad-hoc 签名
```

**没有 Xcode 工程，没有 SwiftPM。**

一个需要工程文件才能构建的前端，是一个没人会去构建的前端。

> 本机只有 Command Line Tools，没有完整 Xcode，所以没有 `metal` 离线编译器。
> 用运行时编译着色器绕过了这一点，而且这本来就是个更好的设计。

---

## 9. 代码对应

| 概念 | 文件 |
|------|------|
| C 接口 | `src/ffi/emulator_api.h` / `.cpp` |
| C 接口测试 | `tests/test_ffi.cpp`（22 个） |
| Swift 包装 | `frontend/Sources/Emulator.swift` |
| Metal 渲染 | `frontend/Sources/Renderer.swift` |
| 音频 | `frontend/Sources/AudioOutput.swift` |
| 窗口 / 键盘 / 主循环 | `frontend/Sources/main.swift` |
| 构建 | `frontend/build.sh` |

```bash
./frontend/build.sh
./frontend/build/FCEmulator.app/Contents/MacOS/FCEmulator game.nes --headless 700 --start --dump f.ppm
open frontend/build/FCEmulator.app --args game.nes
```

---

## 10. 还没做的

| 项目 | 说明 |
|------|------|
| **无锁音频队列** | 现在用 `NSLock`，实时性违规 |
| **精确的 60.0988 Hz** | 现在跟显示器刷新率 |
| **音频驱动同步** | 现在音频只是被动播放，不参与节流 |
| **存档 / 读档** | Core 还没有 serialize |
| **录像回放** | 接口已经支持（`set_button`），前端没有 UI |
| **游戏手柄（HID）** | 只做了键盘 |
| **跳帧** | 慢的机器上会掉速 |
| **Metal 的整数倍缩放** | 现在按比例缩放，不是整倍 |

---

## 11. 自测

1. 为什么 Core 和前端之间是 C 接口而不是 C++？
2. `fc_framebuffer` 返回的指针能缓存吗？为什么？
3. 为什么 `fc_take_samples` 不能分配内存？
4. 为什么音频需要一个环形缓冲？
5. 为什么采样器必须是 nearest 而不是 linear？
6. 为什么着色器从字符串编译，而不是 `.metal` 文件？
7. 为什么连发和去抖不能放在 Core 的 `Controller` 里？
8. `--headless` 模式除了测试还有什么用？

<details>
<summary>答案</summary>

1. Swift 不能直接调用 C++，但可以零成本调用 C。C 接口也是唯一一个能同时被 Swift / C / Rust 调用的边界
2. 能。指针属于 machine，machine 活着它就有效，内容原地更新。这正是零拷贝上传的前提
3. 因为它要在音频回调里被调用，而实时线程不能分配内存（会阻塞、可能触发 GC/锁）
4. 因为模拟器按帧突发产生音频，而声卡按绝对固定的速率消费。速率不匹配必须有缓冲
5. 因为 NES 的每个像素都是刻意的。线性过滤会把像素艺术变成糊
6. 因为这样前端就是四个源文件、零构建步骤，没有 `.metallib` 要和代码同步。运行时编译也绕开了缺少离线编译器的问题
7. 因为那样录像回放和真实按键就会走不同的代码路径。手柄硬件本身没有这些功能，前端和游戏才有
8. 定位问题在 Core 还是在窗口。如果 `--headless` 画出正确的画面，问题就在前端

</details>

---

**上一章：** [bus.md](bus.md)
