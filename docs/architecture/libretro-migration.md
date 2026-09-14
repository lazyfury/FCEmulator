# 迁移到 libretro ABI —— 调研与计划 v2

> 状态：**L1 完成，L2+ 未执行**。
> v2 变更：确立 **libretro 为准**；列出**暂时隐藏**的功能；新增 **custom ABI 扩展**设计；
> 用实验**确认了 wasm 动态加载外部核心的可行性**（结论：原生 core 不行，专用
> wasm side module 可以，已验证）。
> 目标：Core 以 libretro ABI 为唯一对外契约；前端以 libretro frontend 为骨架；
> 自定义能力走一层可选的 custom 扩展；为日后接入 mGBA 铺路。

---

## 0. 结论（TL;DR）

1. **libretro 是权威**。所有"能不能做"以 `libretro.h` 为准；现有 `fc_*` 接口
   降级为**内部/扩展**，不再是前端与 Core 之间的主契约。
2. **Core 不重写**。仍是 `fc_core`，但对外只暴露 libretro。新增一个薄适配层
   `src/libretro/fc_libretro.cpp`，把 `retro_*` 翻译成 `Machine` 方法。
3. **不重要的功能先隐藏**（§4.2）：金手指面板、扫描线滤镜、封面/截图、
   原生手柄助手、PC/cycles 诊断读数。它们要么与 libretro 字符串模型不兼容，
   要么是 host 的职责，等 libretro 骨架稳定后再逐个接回。
4. **custom 扩展**（§6）：用**额外导出的符号 + 版本化函数指针表**
   `fc_libretro_get_ext()` 暴露非标准能力；标准前端（RetroArch）忽略它，
   自家前端 `dlsym` 到就用。
5. **wasm 加载外部核心：已确认**（§7，含可复现实验）。
   - ❌ 原生 `.dylib` / `.so`：wasm 沙箱**不能**加载。
   - ⚠️ 任意第三方预编译 wasm core：**不能**即插即用（toolchain/ABI 强耦合）。
   - ✅ **专门编译的 wasm side module**：**能**。已在 `emsdk 6.0.9` + Node 24 上
     验证 `dlopen` + `dlsym` + 反向回调（`retro_set_video_refresh` 模式）+
     跨模块共享 framebuffer 指针，全部工作。
   - 代价：必须开 `MAIN_MODULE=2` / `ALLOW_MEMORY_GROWTH=1`，与当前
     `ALLOW_MEMORY_GROWTH=0`（为防 typed array 视图失效而设）冲突，需改造。
6. **推荐路线**：A（native core）→ custom ext → wasm core（已验证形态）→
   Electron 切 libretro host → mGBA 作为第二个 wasm side module。

---

## 1. libretro 为准意味着什么

| | 旧（v1 计划） | 新（v2，libretro 为准） |
|---|---|---|
| Core 对外契约 | `fc_ffi`（`fc_*`） | **libretro `retro_*`** |
| 前端与 Core 之间 | `useEmulator.ts` 直调 `fc_*` | **libretro `CoreHost`**（标准语义） |
| 非标准能力 | 散在 `fc_*` | **custom 扩展** `fc_libretro_get_ext()` |
| `fc_*` 的地位 | 主接口 | 适配层内部实现 + 测试/工具 |
| 视频格式 | `0x00RRGGBB` 约定 | `RETRO_PIXEL_FORMAT_XRGB8888`（等价） |
| 音频 | mono float + 私有队列 | `audio_sample_batch` **int16 stereo** |
| 输入 | `fc_set_button` | `input_poll` / `input_state` + JOYPAD id |
| 存档 | `fc_save_state` | `retro_serialize` / `unserialize` |
| 金手指 | `{addr,value,freeze}` | `retro_cheat_set` **字符串** |
| 组合多个模拟器 | 无 | 天生支持第二个 libretro core |

保留 `fc_*` 的理由：它是适配层的直接实现、`wasm/headless.mjs` 的测试入口、
`tools/fc_headless` 的依赖，删掉没有收益。**只是不再作为对外的首要 ABI。**

---

## 2. 现状盘点（哪些已就绪）

Core 已经满足 libretro 的三条硬性前提：无 UI 依赖、无文件 IO、无异常，且
Native / wasm 双编译。`src/core` 分层：

```
src/core/nes/  src/core/cpu/     机器本身（CPU/Bus/PPU/APU/Mapper/State）
src/ffi/emulator_api.{h,cpp}     现有 C 接口（22 个测试）
wasm/glue.cpp                    Emscripten 薄壳（只做 ABI 版本自检）
electron/                        Electron 前端（库/输入/音频/UI）
```

现状能力清单与 libretro 的逐项对照见 §3。

---

## 3. 功能对照表

图例：✅ 直接支持　🟡 需适配　❌ 不支持（隐藏或走 custom）　⏸ 暂时隐藏

| 功能 | 现状 | libretro 对应 | 结论 |
|---|---|---|---|
| 生命周期 | `fc_create/destroy` | `retro_init/deinit`（单例） | 🟡 静态 `fc_machine*` |
| 加载 ROM | `fc_load_rom(内存)` | `retro_load_game` | ✅ |
| 复位 | `fc_reset` | `retro_reset` | ✅ |
| 逐帧 | `fc_run_frame` | `retro_run`（一帧 + 一次 video/audio） | ✅ |
| Halt | `fc_is_halted` | 无 | 🟡 log + `GET_CAN_DUPE` |
| 帧计数 | `fc_frame_count` | 前端自计 | ✅ |
| 视频 | `0x00RRGGBB` 256×240 | `SET_PIXEL_FORMAT` + `video_refresh` | ✅ pitch=1024 |
| 几何/区域/帧率 | 固定 | `av_info.geometry` / `get_region` / `fps` | ✅ NTSC 60.0988 |
| 音频 | mono float 44100 + 内部队列 | `audio_sample_batch` int16 stereo | 🟡 **主工作量** |
| 音频设备/缓冲 | `fc_audio_queue_*` | 前端自带 | ✅ 仅本 App 用 |
| 输入 | `fc_set_button(port)` | `input_poll/state` | 🟡 id 映射 |
| 两端口 | 2×Controller | port 0/1 + `SET_CONTROLLER_INFO` | ✅ |
| 存档状态 | `fc_save_state*` | `retro_serialize*` | ✅ 倒带因此自动可用 |
| 电池存档 | PRG RAM 存在但未暴露 | `RETRO_MEMORY_SAVE_RAM` | 🟡 加 `Cartridge::prg_ram()` |
| 内存/调试 | `fc_peek/poke` | `RETRO_MEMORY_SYSTEM_RAM` + memory maps | 🟡 加 `NesBus::ram_data()` |
| 金手指 | `{addr,value,freeze}` | `retro_cheat_set(字符串)` | ❌ 走 custom / 先隐藏 |
| 诊断 PC/cycles | `fc_total_cycles/pc` | 无标准 | ⏸ 走 custom / 隐藏 |
| ROM 摘要 | `fc_rom_summary` | `SET_MESSAGE` / log | 🟡 |
| 扫描线滤镜 | 前端绘制 | host/shaders 职责 | ⏸ 隐藏 |
| 封面/截图 | SQLite + PNG | host 职责 | ⏸ 隐藏 |
| 原生手柄助手 | Swift/C++ helper | host 输入职责 | ⏸ 隐藏（先用标准输入） |
| 游戏库 | SQLite | host playlist 职责 | 🟡 先简化（列表+加载） |
| 存档槽 / 倒带 | 前端 | host 职责（基于 serialize） | ✅ 保留 |
| 全屏 / 整数缩放 | 前端 | host 职责 | ✅ 保留 |

---

## 4. 决策

### 4.1 以 libretro 为准

- 对外契约 = `libretro.h`；新功能先问"libretro 有没有对应"。
- `fc_*` 只服务于适配层内部和现有测试，不再新增公开用法。
- 前端后续统一走 `CoreHost`（§5.2），其方法名/语义对齐 libretro。

### 4.2 暂时隐藏清单（第一批）

原则：**与 libretro 模型冲突、或属于 host 职责、或非核心体验**的功能先关掉，
减少迁移面；UI 位置保留占位，后续按需接回。

| 隐藏项 | 原因 | 替代/恢复路径 |
|---|---|---|
| 金手指面板（原始 addr/value） | libretro 只认 Game Genie/PAR 字符串 | custom 扩展接回；或 host 字符串通道 |
| 扫描线滤镜 | 属 host 渲染 | 等 libretro host 的 shader/滤镜框架 |
| 封面与截图面板 | 属 host 资源管理 | 保留数据库表，UI 暂不显示 |
| 原生手柄助手（Swift/C++） | 属 host 输入 | 先用标准 JOYPAD 输入；助手作为可选加速 |
| PC / cycles 诊断读数 | 非 libretro 标准 | custom 扩展 `cpu_pc()/total_cycles()` |
| 游戏库高级项（置顶/排序/搜索） | 非核心 | 先"列表 + 加载"，稳定后恢复 |

**保留**：加载/运行/暂停/复位、画面、声音、键盘手柄、存档槽、快速存读、
倒带、全屏、整数缩放。这些要么是 libretro 标准，要么是 host 的通用能力。

### 4.3 custom ABI 扩展

见 §6。

### 4.4 wasm 加载外部核心

见 §7（已实验确认）。

---

## 5. 迁移方案

### 5.1 三个产物

```
fc_libretro.dylib        native libretro core      -> RetroArch / Lakka
fc_libretro.wasm         wasm  libretro core（side module）-> 自家 Electron 前端
fc_core.mjs              （可选保留）旧的单体 wasm，过渡期兜底
```

三者同源：`src/core` 不变，差异只在适配层与编译方式。

### 5.2 前端抽象 `CoreHost`（libretro 语义）

不按 `fc_*` 命名，而按 libretro 命名，让"标准 core"和"未来 mGBA"都能实现：

```ts
interface CoreHost {
  systemInfo(): { name; version; extensions: string[] };
  avInfo(): { width; height; fps; sampleRate };
  loadGame(bytes: Uint8Array): boolean;
  unload(): void;
  reset(): void;
  run(): void;                              // 一帧
  // 回调由 host 在构造 core 时注册，这里只取结果：
  takeVideo(): { ptr; width; height; pitch; format: 'XRGB8888' };
  takeAudio(): Int16Array;                  // stereo
  setInput(port: number, id: number, down: boolean): void;
  serialize(): Uint8Array;
  unserialize(b: Uint8Array): boolean;
  memory(id: 'SAVE_RAM' | 'SYSTEM_RAM'): Uint8Array | null;
  setCheat(index: number, enabled: boolean, code: string): void;
  resetCheats(): void;
  // custom 扩展（可选）
  ext?: CustomExt;
}
```

`useEmulator.ts` 直调 `fc_*` 的地方集中替换到这一层；UI/库/存档槽基本不动。
**这是 mGBA 可插拔的关键。**

### 5.3 分阶段计划

| 阶段 | 内容 | 产出 | 估时 |
|---|---|---|---|
| **L0** | 调研（本文） | 文档 + wasm 实验 | ✅ |
| **L1** | native 适配层 `fc_libretro.cpp` + `third_party/libretro/libretro.h` + CMake MODULE target；音频/视频/输入/存档转换 | RetroArch 能加载运行 | ✅ 已完成 |
| **L2** | custom 扩展符号 `fc_libretro_get_ext()`；`Cartridge::prg_ram()`、`NesBus::ram_data()`、电池标志；RAM 型金手指 | 电池存档、内存视图、custom 通道 | 进行中 |
| **L3** | Game Genie/PAR 解码 + ROM 补丁钩子 + `SET_MEMORY_MAPS` | 金手指完整、搜索可用 | 3~5 人天 |
| **L4** | wasm：`fc_core` 编译为 SIDE_MODULE，宿主编译为 MAIN_MODULE，回调桥接；解决内存增长导致的视图失效 | 浏览器/Electron 可 `dlopen` 本 core | 4~7 人天 |
| **L5** | Electron `CoreHost` 切到 libretro 宿主；隐藏 §4.2 功能；回归 | 前端 libretro 化 | 1 周 |
| **L6** | mGBA 编为 wasm side module + 系统注册表 + UI 泛化 | `.gba` 可玩 | 3~7 人天 |
| 备选 | native core host（B1）`native/core-host` + IPC | 可加载任意现成 `.dylib` | 1~2 周 |

L1~L3 只增不改；L4 起才动 wasm/前端。

---

## 6. custom ABI 扩展（新增，按 libretro 惯例）

### 6.1 为什么需要

libretro 的 `environment` 是 **core → frontend** 方向，frontend 无法用它调用
core 的额外函数；`retro_cheat_set` 只收字符串；`fc_peek/poke`、原始金手指、
mapper 完整性、诊断读数都没有标准落点。所以需要一个**可选的、非侵入的**
core 出口。

### 6.2 设计：额外导出符号 + 版本化函数指针表

```c
/* src/libretro/fc_libretro_ext.h —— 只有自家 frontend 会读 */
#define FC_LIBRETRO_EXT_VERSION 1u

typedef struct fc_libretro_ext_v1 {
    uint32_t abi_version;   /* == FC_LIBRETRO_EXT_VERSION */
    uint32_t struct_size;   /* 构建时的 sizeof，便于跨版本判断 */

    int         (*peek)(uint16_t address);
    void        (*poke)(uint16_t address, uint8_t value);
    int         (*set_raw_cheats)(const uint8_t* data, int count); /* 现有 4 字节格式 */
    int         (*raw_cheat_count)(void);
    bool        (*mapper_saves_state)(void);
    const char* (*rom_summary)(void);
    uint64_t    (*total_cycles)(void);
    uint16_t    (*cpu_pc)(void);
} fc_libretro_ext_v1;

/* core 导出；frontend 用 dlsym 探测，找不到就只用标准 ABI */
const fc_libretro_ext_v1* fc_libretro_get_ext(void);
```

规则：

1. **只增不改**：新版加字段 + 提升 `abi_version`/`struct_size`，旧 frontend
   按 `struct_size` 截断读取。
2. **前缀 `fc_`**，避免与未来 libretro 官方符号冲突。
3. **标准前端忽略**：RetroArch 不 `dlsym` 这个符号，零影响。
4. **frontend 优雅降级**：`ext` 不存在 → 隐藏依赖它的 UI（金手指面板、
   诊断读数），标准功能不受影响。
5. **wasm 同样适用**：side module 用 `export_name`/`EMSCRIPTEN_KEEPALIVE`
   导出该符号，`dlsym` 行为与 native 一致（已在 §7 验证 dlsym）。
6. 若某个能力后来被 libretro 标准化，迁移到标准通道，custom 里保留但标注
   deprecated。

### 6.3 custom vs 标准 的边界

| 走标准 libretro | 走 custom 扩展 |
|---|---|
| 视频/音频/输入/存档/复位/加载 | `peek` / `poke` |
| `retro_cheat_set`（字符串） | 原始 `{addr,value,freeze}` 金手指 |
| `RETRO_MEMORY_*`（SaveRAM/SystemRAM） | mapper 完整性、ROM 摘要、PC/cycles |
| core options（`SET_VARIABLES`） | 未来 core 私有的调试/测试钩子 |

---

## 7. wasm 方式加载外部核心 —— 确认结果

### 7.1 结论

| 输入 | 能否在 wasm 中加载 | 说明 |
|---|---|---|
| 原生 `.dylib` / `.so` | ❌ | wasm 沙箱不允许 |
| 第三方预编译 libretro wasm core | ⚠️ 基本不能 | ABI/toolchain/命名空间强耦合，不能即插即用 |
| **专门用同版本 emsdk 编的 wasm side module** | ✅ **能** | 已实测 |

### 7.2 实测（可复现）

环境：仓库内 `third_party/emsdk`（Emscripten **6.0.9**）+ Node 24。

```bash
source third_party/emsdk/emsdk_env.sh

# 1) 模拟 libretro core，编成 side module
emcc core.c  -O2 -sSIDE_MODULE=1 -o core.wasm
# 2) 模拟 libretro frontend，编成 main module
emcc main.c  -O2 -sMAIN_MODULE=1 -sALLOW_MEMORY_GROWTH=1 -o frontend.mjs
# 3) 运行
node runner.mjs   # runner.mjs: import factory from './frontend.mjs'; await factory();
```

`core.c` 导出 `retro_api_version` / `retro_run` / `retro_set_video_refresh`
（用 `__attribute__((export_name(...)))`），frontend `dlopen("core.wasm")` +
`dlsym`，把**自己的函数指针**交给 core，core 每帧反向调用它并传 framebuffer。

实测输出：

```
START
api_version=1
counter=5
  [frontend] video_refresh #1: 256x240 first=0x11223344
  [frontend] video_refresh #2: 256x240 first=0x11223344
  [frontend] video_refresh #3: 256x240 first=0x11223344
callback count=3
```

**证明**：`dlopen` / `dlsym` / 反向函数指针回调 / 跨模块共享内存指针
（framebuffer）四件事在 wasm 动态链接下全部成立，足以承载 libretro ABI。

### 7.3 必须付的代价（写进 L4）

1. **构建模式改变**：需要 `-sMAIN_MODULE=2`（宿主）+ `-sSIDE_MODULE=1`（core），
   `MAIN_MODULE` 会把输出变成 `export default factory`（模块化工厂），
   与当前 `wasm/CMakeLists.txt` 的 `--no-entry` + `-sMODULARIZE=1` 组合需要重排。
2. **必须开 `ALLOW_MEMORY_GROWTH=1`**：动态链接会在加载/运行时增长内存。
   当前刻意设 `=0` 是为了避免"内存增长后缓存的 typed array 视图失效"
   这一类经典漏洞。改开后，**所有 HEAPU8/HEAPF32 视图必须在可能增长后重取**，
   framebuffer 指针每次 `takeVideo()` 重新解析。
3. **core 必须与宿主同版本 emsdk 编译**：不能直接吃 RetroArch 的预编译 core；
   mGBA 需要我们自己用 `-sSIDE_MODULE=1` 编。
4. **`FILESYSTEM=0` 下 `dlopen` 取不到文件**：需要在宿主里加 fetch/预加载逻辑，
   或把 core wasm 作为数据传入。
5. **单线程**：C++ 异常/RTTI/线程受限；mGBA 单线程可用，含音频线程的 core 需裁剪。
6. **`RTLD_NOW`**：未解析符号会在 `dlopen` 时直接失败，core 的依赖要齐。
7. **调试更难**：跨模块栈/符号，DevTools 支持有限。

### 7.4 对 mGBA 的直接影响

- 想在 Electron（wasm 路径）跑 mGBA → **把 mGBA 编成 libretro side module**（L6）。
  可行但需要移植 mGBA 的 build 到 emsdk 6.0.9 + `-sSIDE_MODULE=1`。
- 想直接跑官方 `mgba_libretro.dylib` → 走**备选 B1 native host**，代价是 IPC。
- 两条路都成立，**不冲突**：native 产物给 RetroArch/桌面 host；wasm 产物给
  渲染进程内 host。

---

## 8. mGBA 接入（本次不执行，仅预留）

### 8.1 需要现在预留的接口（L5 的 `CoreHost` / 系统注册表）

1. **系统注册表**：`{ systemId, extensions, controllerInfo, saveRAMKind, fps }`，
   按扩展名分发（`.nes`→fc，`.gba`→mgba）。
2. **存档分级**：路径含 system + rom；`serialize` 字节 opaque，前端不得假设格式。
3. **输入描述数据化**：由 `SET_INPUT_DESCRIPTORS` / `SET_CONTROLLER_INFO`
   驱动 UI（GBA 是十字键 + A/B + L/R，无 2P），不要硬编码 NES 8 键。
4. **动态分辨率/帧率**：来自 `av_info`（GBA 240×160，59.7275 fps），
   前端时钟与缩放不得写死。
5. **音频统一为 int16 stereo**：与 FC 适配层同一形态，避免分叉。
6. **custom 扩展可选存在**：mGBA 没有 `fc_*`，`CoreHost.ext` 为 undefined，
   相关 UI 自动隐藏。

### 8.2 mGBA 特有事项

- BIOS：可选（内置 HLE），`GET_SYSTEM_DIRECTORY` 支持外部 `gba_bios.bin`。
- 存档类型：SRAM/Flash/EEPROM 大小不一，由 `RETRO_MEMORY_SAVE_RAM` size 决定。
- RTC：`RETRO_MEMORY_RTC`（宝可梦）。
- 金手指：CodeBreaker/GameShark 字符串，core 自解析，前端只透传。
- e-Reader / 多卡：`load_game_special`，可先不支持。

---

## 9. 风险与决策点

| # | 决策 | 结论/建议 |
|---|---|---|
| D1 | 谁为准 | **libretro.h**；`fc_*` 降级为内部实现 |
| D2 | `fc_*` 是否删除 | 保留（测试/工具/适配层实现），不再新增公开用法 |
| D3 | 不重要功能 | 按 §4.2 第一批隐藏，UI 留占位 |
| D4 | custom 扩展形态 | 额外导出符号 `fc_libretro_get_ext()`，版本化指针表 |
| D5 | wasm 外部核心 | 可以，但必须自编 side module；原生 dylib 不行（§7） |
| D6 | 内存增长 | L4 必须处理 typed array 视图失效，是最大技术债 |
| D7 | 金手指 ROM 补丁 | 需要碰 mapper 读路径，排 L3 |
| D8 | 线程安全 | 先假设 serialize/run 同线程，文档标注；需求出现再加锁 |
| D9 | AGENTS.md 教学要求 | 新文件按现有风格解释"模拟现实的哪一部分" |
| D10 | mGBA 路线 | 优先 wasm side module（与现架构一致）；native dylib 走备选 host |

---

## 10. 验收与测试

**L1（RetroArch）**
- [ ] 加载 `fc_libretro.dylib` 不报缺符号
- [ ] 游戏出画面/出声/可操作
- [ ] 存档 → 重开 → 逐像素一致
- [ ] RetroArch 自带倒带可用（证明 serialize 完整）
- [ ] `.srm` 电池存档落盘/读回

**L2/L3**
- [ ] `fc_libretro_get_ext()` 可被 dlsym；缺失时前端优雅降级
- [ ] `RETRO_MEMORY_SAVE_RAM` / `SYSTEM_RAM` 指针与大小正确
- [ ] Game Genie 6/8 位与 PAR 代码生效；内存搜索可用

**L4/L5（wasm）**
- [ ] side module 能被宿主 dlopen/dlsym，回调与 framebuffer 指针正确
- [ ] 内存增长后视图重取，画面不冻结/不撕裂
- [ ] 现有 429 单测与 `wasm/verify.sh` 逐像素逐采样仍通过
- [ ] `CoreHost` 切换后现有 NES 行为零回归

**通用**
- [ ] 假 frontend 单测：直接调 `retro_*`，断言回调次数/内容
- [ ] 音频 mono→stereo、float→int16 单测
- [ ] 输入 id 映射单测

---

## 11. 明确不做

- 不重写 Core；libretro 适配层与 `fc_ffi` 并列存在。
- 不把前端功能塞进 core（库/封面/手柄助手/滤镜/音频队列都不进）。
- 不实现 FDS / UNIF / PAL / 多机种子系统。
- 本次不写 mGBA 集成代码，只预留 `CoreHost`、系统注册表、custom 扩展。
- 不删除 `src/ffi/emulator_api.h`。

---

## 附录 A：libretro 符号 ↔ 现有实现

| retro_* | 现有/新增实现 |
|---|---|
| `retro_init` / `retro_deinit` | `new/delete fc_machine`（静态单例） |
| `retro_load_game` / `retro_unload_game` | `fc_load_rom` / 释放 |
| `retro_reset` | `fc_reset` |
| `retro_run` | `fc_run_frame` + video + audio + input |
| `retro_serialize_size/serialize/unserialize` | `fc_state_size` / `fc_save_state_into` / `fc_load_state` |
| `retro_get_memory_data(SAVE_RAM)` | **新增** `Cartridge::prg_ram()` |
| `retro_get_memory_data(SYSTEM_RAM)` | **新增** `NesBus::ram_data()` |
| `retro_cheat_set/reset` | **新增** Game Genie/PAR 解码 → `CheatSet` |
| `retro_get_region` | 常量 NTSC |
| `retro_get_system_av_info` | 常量 256×240 / 60.0988 / 44100 |
| `fc_libretro_get_ext`（custom） | peek/poke/raw cheats/diagnostics |

## 附录 B：最小 environment 命令

```c
case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:      // XRGB8888
case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
case RETRO_ENVIRONMENT_GET_CAN_DUPE:          // true
case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:       // $0000-$07FF
case RETRO_ENVIRONMENT_GET_VARIABLE:
case RETRO_ENVIRONMENT_SET_VARIABLES:
case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
case RETRO_ENVIRONMENT_SET_GEOMETRY:
case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
default: return false;
```

## 附录 C：wasm 加载实验复现

见 §7.2。要点：

```c
/* core.c（side module） */
__attribute__((export_name("retro_set_video_refresh")))
void retro_set_video_refresh(video_cb cb) { g_video = cb; }
__attribute__((export_name("retro_run")))
void retro_run(void) { if (g_video) g_video(frame, 256, 240); }
```

```c
/* main.c（frontend, MAIN_MODULE=1） */
void* h = dlopen("core.wasm", RTLD_NOW);
set_cb set = dlsym(h, "retro_set_video_refresh");
set(my_video);         /* 把 main 的函数指针交给 core */
for (...) run();       /* core 反向调用 main */
```

结论：libretro 的"回调注册 + 逐帧反向调用"模型在 wasm 动态链接下成立。
