# 接入 MAME —— 调研与计划

> 状态：**调研完成，未动一行接入代码**。本文回答一个问题：把 MAME 接进这个
> Electron + WebAssembly + libretro 的前端，现实吗？如果现实，代价是什么？
>
> 结论先行：**「现代 MAME」不现实；「MAME 2003-Plus（wasm libretro 核心）」
> 可行，已实测能编、能实例化、ABI 正确，但需要给前端补一套虚拟文件系统。**
> 顺带发现：MAME 2003-Plus 是**非商业许可**，这是比技术更大的决策点。
>
> 调研日期：本次会话。源码来自 GitHub（`libretro/mame2003-plus-libretro`、
> `mamedev/mame`、`libretro/mame`、`EmulatorJS/build`）。

---

## 0. 结论（TL;DR）

| 路线 | 是什么 | 可行性 | 主要代价 |
|---|---|---|---|
| **A. MAME 2003-Plus → wasm libretro 核心** | 2003 年 MAME（0.78）加 350 个回移游戏，5324 个机台 | ✅ **已实测可编**（17.8 MB wasm，能 `retro_init`） | 前端要支持 `need_fullpath` 的虚拟文件系统、BIOS/父 ROM、核心选项；输入模型要能表达 3~6 键；**非商业许可** |
| **B. 现代 MAME（`libretro/mame`）→ native 辅助进程** | 当代 MAME 的 libretro 核心，走类似手柄助手的 IPC | 🟡 技术可行，但重型 | 帧/音频过 IPC；`Makefile.libretro` **没有 emscripten 目标**，只能 native；仓库 1.8 GB，编译极久 |
| **C. 上游 MAME 0.289 → 官方 emscripten 独立应用** | `mamedev/mame` 自带 `make asmjs`，产物是 SDL 网页应用 + Emularity | ❌ 不是 libretro | 自成一个模拟器/前端，要独立 canvas、BrowserFS、Emularity loader；与现有 `CoreHost` 无关 |
| **D. 用户下载的 `mame0289-arm64`** | native SDL3 可执行文件，自带窗口 | ❌ | 它自己拥有窗口，画面进不了我们的 canvas；与 Electron 前端没有接口 |

**推荐**：如果一定要接入街机，走 **A**，并且把它当成一次「前端架构升级」（虚拟
文件系统 + 数据驱动输入 + 每游戏帧率），而不是「再编一个核心」。先做输入/FS
两件事，再谈 BIOS 与许可。

---

## 1. 先厘清「MAME」这个词的四个所指

「接入 MAME」在动手前必须区分四件不同的东西，它们的技术栈完全不同：

```
      mamedev/mame (0.289)                libretro/mame
      ────────────────────                ─────────────
      现代 MAME，SDL3/C++20               现代 MAME 的 libretro fork
      自带窗口、菜单、调试器              原生 libretro core（.so/.dylib）
      emscripten 目标 = 网页应用          Makefile.libretro 只支持
      （make asmjs + Emularity）          linux/osx/android/ios/tvos
                                          → 没有 emscripten 目标

      libretro/mame2003-plus              EmulatorJS/FBNeo 等
      ─────────────────────               ────────────────
      MAME 0.78 + 回移，面向移动/低配      其它街机 libretro 核心
      自带 platform=emscripten 目标       FB Neo 的 emscripten 目标只在
      → 可编 wasm（本文实测）             EmulatorJS fork 里
```

### 1.1 现代 MAME（0.289）—— native 与网页

- 上游 `mamedev/mame` 的 Emscripten 支持写在
  `docs/source/initialsetup/compilingmame.rst`，要求 Emscripten 6.0.2+，并且：
  - 先 `embuilder build sdl3 sdl3_ttf`（依赖 SDL）；
  - 用 `SUBTARGET=` + `SOURCES=` 裁剪驱动，否则「a full MAME compile is too
    large to load into a web browser at once」；
  - 产物是 `.js`/`.wasm`，**不能单独运行**，要配
    [Emularity](https://github.com/db48x/emularity) 的 HTML loader 和一个
    BrowserFS 来喂 ROM zip。
- 也就是说，上游的 wasm MAME 是**一个独立的网页模拟器**，不是 libretro
  core。要接进本项目，等于在 Electron 里再塞一个第二前端，画面/输入/存档都
  不走现有 `CoreHost`。
- 它还是 threaded、SDL3、几百万行驱动的工程；就算裁剪到只留一个驱动，其
  `SUBTARGET` 构建也不产出 `retro_*` 符号。

**用户 `~/Downloads/mame0289-arm64.zip`（0.289，122 MB）** 就是这条路的
native 形态：`mame` 可执行文件自建 SDL3 窗口。它和 Electron 没有接口，不能
把画面画进 `canvas`。

### 1.2 `libretro/mame`——现代 MAME 的 libretro fork

- GitHub 上 `libretro/mame` 是 `mamedev/mame` 的 fork（`fork: true`，
  `parent: mamedev/mame`），仓库 1.8 GB，带一个 `Makefile.libretro`。
- 但 `Makefile.libretro` 的平台分支只有
  `android-arm / android-arm64 / android-x86 / android-x86_64 / ios-arm64 /
  linux32 / osx / tvos-arm64`——**没有 emscripten**。
- 想把它编成 wasm，需要自己移植 emscripten 目标，并面对现代 MAME 的线程、
  SDL、1.8 GB 源码和数小时编译。
- 作为 native core 是可行的（这正是 RetroArch 的 `mame` 核心），但本项目的
  wasm 沙箱加载不了 native `.dylib`（`libretro-migration.md` §7 已实测），
  只能另开一个 native 辅助进程走 IPC。

---

## 2. 可行的那条路：MAME 2003-Plus

### 2.1 它是什么

- `libretro/mame2003-plus-libretro`：以 MAME 0.78（2003）为基础，回移了 350
  个游戏与若干功能，**5324 个机台**（`metadata/mame2003-plus.xml` 里
  `<game ...>` 的数量）。
- 目标是手机 / 树莓派 / 低配，所以刻意保留老 MAME 的轻量架构（解释型 CPU，
  没有现代 MAME 的重依赖）。
- 上游 Makefile 自带 `platform=emscripten` 分支（第 544 行），这是 mgba/Mesen
  故事的重演：**又一个第三方 libretro 核心，又一个 `emmake make`。**

### 2.2 实测：能编，能跑 ABI

本次实际验证过（不是读文档猜的）：

```bash
git clone --depth 1 https://github.com/libretro/mame2003-plus-libretro.git
source third_party/emsdk/emsdk_env.sh

# 关键：覆盖 emscripten 分支硬编码的 STATIC_LINKING=1，并跳过 Makefile 的归档
emmake make -f Makefile platform=emscripten STATIC_LINKING=0 LD=true -j10

# 自己链成独立模块（同 Mesen/mgba 的做法）
em++ $(find . -name '*.o') -O3 --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1 \
    -sEXPORT_NAME=createMame2003PlusLibretro \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=1048576 \
    -sALLOW_TABLE_GROWTH=1 "-sEXPORTED_FUNCTIONS=$EXPORTS" \
    "-sEXPORTED_RUNTIME_METHODS=$RUNTIME" -o mame2003plus_libretro.mjs
```

结果：

| 项 | 值 |
|---|---|
| 编译对象 | 1807 个 `.o`（emscripten 6.0.9，macOS arm64） |
| 链接产物 | `mame2003plus_libretro.wasm` = **17.8 MB**（mgba 约 0.9 MB，Mesen 约 2.4 MB） |
| 模块实例化 | 成功，初始 heap 256 MB |
| `retro_api_version()` | `1` |
| `retro_get_system_info()` | `MAME 2003-Plus`，`valid_extensions="zip"`，**`need_fullpath=true`**，`block_extract=true` |
| 用一段假 ROM 调 `retro_load_game` | 返回 `false`，不崩溃（被 `libretro.mjs` 的 try/catch 兜住） |

### 2.3 唯一一个编译上的坑：`STATIC_LINKING`

`platform=emscripten` 分支里硬编码了：

```make
else ifeq ($(platform), emscripten)
    TARGET := $(TARGET_NAME)_libretro_$(platform).bc
    HAVE_RZLIB := 1
    STATIC_LINKING := 1          # <-- 这里
    PLATCFLAGS += -D__EMSCRIPTEN__
```

而 `Makefile.common` 里 libretro-common 那一整段是**反条件**编译的：

```make
ifeq ($(STATIC_LINKING),1)
else
SOURCES_C += \
    $(LIBRETRO_COMM_DIR)/streams/interface_stream.c \
    $(LIBRETRO_COMM_DIR)/streams/file_stream.c \
    $(LIBRETRO_COMM_DIR)/streams/rzip_stream.c \
    $(LIBRETRO_COMM_DIR)/vfs/vfs_implementation.c \
    ...
endif
```

原因：`STATIC_LINKING=1` 时，这些符号由**前端**（RetroArch 本身）提供。
EmulatorJS 的构建流程正是先编核心 `.bc`、再和自编的 RetroArch 链在一起，所以
它不报错。我们只编核心、自己链，就会看到：

```
wasm-ld: error: ./src/cheat.o: undefined symbol: intfstream_open_file
wasm-ld: error: ./src/fileio.o: undefined symbol: path_is_directory
wasm-ld: error: ./src/mame2003/mame2003.o: undefined symbol: filestream_vfs_init
```

修法：`make ... STATIC_LINKING=0`（命令行变量优先于 Makefile 赋值），让核心把
libretro-common 一起编进去。这会把对象从 1785 增加到 1807，然后链接通过。
链接时有一条良性告警：`start_system18_vdp` 在 `segas18.o` 与
`segac2_vidhrdw.o` 里签名不同（老 MAME 的已知同名冲突），不影响运行。

---

## 3. 真正的接入障碍：`need_fullpath` 与虚拟文件系统

这是本文最重要的一节。MAME 2003-Plus 和 fc/mgba/Mesen 有本质区别：

```c
/* src/mame2003/mame2003.c */
void retro_get_system_info(struct retro_system_info *info) {
    info->valid_extensions = "zip";
    info->need_fullpath = true;   /* <-- */
    info->block_extract  = true;
}

bool retro_load_game(const struct retro_game_info *game) {
    if (string_is_empty(game->path)) return false;       // 必须有路径
    if (!path_is_valid(game->path))  return false;       // 文件必须存在
    driver_lookup = strdup(path_basename(game->path));   // 用文件名当机台名
    for (driverIndex = 0; driverIndex < total_drivers; driverIndex++) {
        if (strcmp(drivers[driverIndex]->name, driver_lookup_without_ext) == 0) break;
    }
    ...
    options.libretro_content_path = strdup(game->path);  // 父 ROM 从这里找
    environ_cb(RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY, &options.libretro_system_path);
    ...
}
```

四点要求，缺一不可：

1. **文件必须存在**：核心自己用 `filestream` 打开 zip，不是从前端拿内存。
2. **文件名就是机台名**：`sf2.zip` → driver `sf2`。文件名不能改，改了核心就
   找不到驱动。
3. **父 ROM / BIOS 在内容目录或系统目录**：例如 Neo Geo 的 `neogeo.zip`、
   某些机台的 `qsound.zip`。核心先看 `GET_SYSTEM_DIRECTORY`，没有就回退到
   内容文件所在目录。
4. **不要解压**（`block_extract=true`）。

而当前前端是怎么给 ROM 的（`wasm/libretro.mjs` 的 `loadRom`）：

```js
const data = mod._malloc(bytes.length);
mod.HEAPU8.set(bytes, data);
// retro_game_info { path, data, size, meta }
mod.HEAPU32[(info >> 2) + 0] = 0;        // path = NULL
mod.HEAPU32[(info >> 2) + 1] = data;     // 内存
mod.HEAPU32[(info >> 2) + 2] = bytes.length;
isLoaded = mod._retro_load_game(info) !== 0;
```

**没有路径，也没有文件。** MAME 需要的是另一套做法：

```
Electron 渲染进程                  Emscripten MEMFS
──────────────                    ────────────────
readRom(path)  → bytes
文件名 basename(path) = sf2.zip
                                  FS_createPath('/', 'roms')
                                  FS_createDataFile('/roms', 'sf2.zip', bytes, ...)
retro_game_info.path = "/roms/sf2.zip"
retro_load_game(info)
```

要接入，`libretro.mjs` 至少需要新增：

- `loadRom(bytes, name)`：把字节写进一个虚拟目录，`path` 用 `/roms/<name>`；
- `provideSystemFile(name, bytes)`：把 `neogeo.zip` 等写进 `GET_SYSTEM_DIRECTORY`
  指向的目录（现在是 `/`）；
- 相应地，`CoreHost` / `wasm.d.ts` / `useEmulator` 要把「文件名」从库一路传
  下来（现在只传 `bytes`）。

### 3.1 由此引出的连带问题

| 问题 | 说明 | 影响 |
|---|---|---|
| 前端拿不到文件名 | `engine.loadRom(bytes)` 只有字节；`applyRom` 其实有 `path` | `useEmulator` 小改 |
| BIOS / 父 ROM | 库只加载被点的那一个文件，`neogeo.zip` 不在虚拟盘 | 需要「把整个 ROM 目录按需挂载」或让用户指定系统目录 |
| 编绎内存模型 | MAME 需要 `-sALLOW_MEMORY_GROWTH=1`（fc 刻意 `=0`） | 见 §4.3 |
| 库的扩展名 | 现在只收 `.nes/.gba/.gb/.gbc`；`.zip` 太通用 | 需要「街机」机种与筛选策略 |

---

## 4. 其它必须一起解决的架构冲突

### 4.1 每游戏一个帧率

MAME 2003-Plus：

```c
info->timing.fps = Machine->drv->frames_per_second;   // 每个机台不同
info->timing.sample_rate = options.samplerate;        // 固定（默认 48000）
```

而 `systems.ts` 的模型是「每个 (核心, 机种) 一个固定 `frameSeconds`」，
`useEmulator` 的节奏累加器用的是这个常量：

```ts
nextFrameTime += core.frameSeconds * (1 + (audio?.rateCorrection ?? 0));
```

街机刷新率五花八门（Neo Geo ≈ 59.19、CPS1 ≈ 59.63、有些 55~57 Hz），用固定
60.1 会累积漂移、音画不同步。**需要把定速改成用 load 之后 `avInfo.fps` 的
`engine.frameSeconds`。** 这本身是对前端的一个通用改进，NES/GBA 不受影响。

### 4.2 输入模型：8 个开关不够

- 前端现在只有 NES 的 8 个按钮（`Button` 枚举），libretro 侧映射到
  `CONSOLE_TO_JOYPAD`。
- MAME 2003-Plus 的映射（`mame2003.c`）：

  | libretro id | 街机含义 |
  |---|---|
  | `B / A / Y / X / L / R` | Fire 1..6 |
  | `SELECT` | Coin |
  | `START` | Start |
  | 十字键 | 方向 |

- 也就是说：**2 键游戏（大多数经典）用现有 UI 就能玩，`SELECT` 正好是投币**；
  3~6 键（CPS1/CPS2/格斗）需要把 `InputManager`/按键绑定从「NES 8 键」扩展到
  通用的 libretro id 集合。
- 端口也只有 2 个（NES 的 2P），4 人机台不可用。

### 4.3 内存：`ALLOW_MEMORY_GROWTH`

- fc 核心刻意用 `-sALLOW_MEMORY_GROWTH=0`，理由是「缓存的 typed array 视图
  永不失效」（`wasm/libretro.mjs` 顶部注释）。
- MAME 运行时分配很大且不可预知，实测链接用的是 `-sALLOW_MEMORY_GROWTH=1` +
  初始 256 MB。
- 好消息：`libretro.mjs` 每次都重新读 `mod.HEAPU8[...]`、每帧重新 `subarray`
  取 framebuffer，没有长期缓存堆视图；`StateBuffer` 用 `_malloc`。所以增长的
  风险大概率可控，但**必须在 MAME 路径上逐帧验证不花屏/不崩**，这是一条要写
  进测试的假设。

### 4.4 核心选项与「警告屏」

MAME 需要 `RETRO_ENVIRONMENT_SET_VARIABLES` / `GET_VARIABLE` /
`GET_VARIABLE_UPDATE`。当前 `libretro.mjs` 的 environment 对这些一律返回 0，
于是核心用默认值——默认会显示版权警告屏并等待按键（EmulatorJS 用
`mame2003_skip_disclaimer=enabled`、`mame2003_skip_warnings=enabled` 跳过）。
要么实现核心选项通道，要么默认关掉警告屏。

### 4.5 电池 / NVRAM / 高分

`mame2003-plus` 的 `retro_get_memory_data` 直接返回 0：

```c
void *retro_get_memory_data(unsigned type) { return 0; }
size_t retro_get_memory_size(unsigned type) { return 0; }
```

所以：
- **存档槽 / 倒带**：走 `retro_serialize`，可用；
- **电池存档 / 高分榜（NVRAM）**：没有 `RETRO_MEMORY_SAVE_RAM` 通道，
  前端无法像 `.srm` 那样落盘。要做只能走自定义扩展或核心选项。

### 4.6 许可

| 核心 | 许可 | 能否随应用分发 |
|---|---|---|
| MAME 2003-Plus | **经典 MAME 非商业许可**（MAME 0.78 license） | 可以分发，但**不得售卖**、必须附完整许可文本；商业用途被禁止 |
| FB Neo | 非商业 + 共享类似 + 禁止募捐 | 同上更严格 |
| 现代 MAME（`mamedev`） | BSD-3-Clause（部分 GPL） | 较宽松，但技术路线不可行（§1） |

本项目是一个免费的开源学习工程，非商业条款本身不致命，但：
1. 它和现有 mgba（MPL）/ Mesen（GPL）不同，**GPL 允许售卖，MAME 非商业不允许**；
2. 需要把完整许可文本和来源声明随发行版一起带；
3. 若这个项目将来有任何商业化（付费包、捐赠换功能），街机核心必须能卸载/剥离。

---

## 5. 三条路线的详细对比

### A. MAME 2003-Plus → wasm libretro（推荐，如果要做）

```
libretro/mame2003-plus-libretro
        │  emmake make platform=emscripten STATIC_LINKING=0
        ▼
mame2003plus_libretro.wasm (17.8MB)   ← 与 fc/mgba/Mesen 同形
        │  wasm/libretro.mjs（需要扩展：虚拟 FS + 核心选项）
        ▼
Electron renderer（现有 CoreHost / 画布 / 音频 / 存档）
```

- 优点：与现有架构完全一致；是「再编一个核心 + 补两处前端能力」；5324 个
  机台；性能对老硬件友好，wasm 下 CPS1/Neo Geo 大概率可玩。
- 代价：虚拟文件系统；BIOS/父 ROM；输入扩展；每游戏帧率；17.8 MB 模块；
  非商业许可。
- 估时（按本项目既有节奏）：
  - FS + `loadRom(bytes, name)` + BIOS 注入：**2~3 人天**
  - 核心选项 + 警告屏跳过：**0.5 人天**
  - 每游戏帧率 / 采样率打通：**0.5 人天**
  - 「街机」机种、库收 `.zip`、标题与筛选：**1 人天**
  - 输入扩展到 6 键 + 投币语义：**1~2 人天**
  - 测试（含一个自由分发的自制街机 ROM）：**1~2 人天**
  - 合计 **约 1.5~2 周**，且第一周花在前端架构而不是 MAME 本身。

### B. 现代 MAME（`libretro/mame`）→ native 辅助进程

```
electron main ──spawn──► mame_libretro host (native, dlopen .dylib)
      ▲                          │
      └──── IPC：帧 / 音频 / 输入 / 存档 ────┘
```

- 优点：现代 MAME，机台最全，不进 wasm 沙箱。
- 缺点：`libretro/mame` 没有 emscripten 目标；native core 要通过 IPC 传帧
  （一帧 256×240×4 ≈ 245 KB）和音频；要新增一套进程管理与协议；
  仓库 1.8 GB、编译以小时计；许可里也有非商业成分。
- 这是本仓库 `libretro-migration.md` §5.3 里「备选 B1 native core host」的
  具体化，估时以周计。

### C. 上游 MAME emscripten 独立应用

- 把 `make asmjs` 的产物 + Emularity + BrowserFS 塞进 Electron。
- 结果：应用里有两个互不相干的模拟器前端，画面/输入/存档/库都不统一。
- 不推荐，除非目标就是「在应用里跑完整 MAME」。

---

## 6. 建议与分阶段计划（若选 A）

**原则**：先补前端的通用能力，再接 MAME；每一步都能单独验收，且不破坏
NES/GBA/GB 的现有测试（`electron/verify.sh` 的 parity 必须保持）。

| 阶段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| **M0** | 虚拟文件系统：`libretro.mjs` 支持 `loadRom(bytes, name)` + `provideSystemFile`；`CoreHost`/`useEmulator` 传文件名 | 核心能拿到真实路径 | fc/mgba/Mesen 零回归；假 FS 单测 |
| **M1** | 核心选项通道：`SET_VARIABLES`/`GET_VARIABLE`/`GET_VARIABLE_UPDATE` | 可关 MAME 警告屏 | 单测 + 在 mame2003-plus 上看到标题 |
| **M2** | `wasm/mame2003-plus/build.sh` + 冒烟测试 `wasm/mame_test.mjs` | 17.8 MB wasm + 测试 | 能加载一个自由分发的街机 ROM（如 homebrew） |
| **M3** | 「街机」机种 + 库收 `.zip` + 每游戏帧率（`engine.frameSeconds`） | 设置里多一个机种 | 库/路由单测 |
| **M4** | 输入扩展到 6 键 + 投币语义；数据驱动按键面板 | 格斗游戏可玩 | 输入单测 |
| **M5** | BIOS/父 ROM 的注入策略（同目录扫描 + 系统目录） | `neogeo.zip` 可用 | 集成测试 |

**M0–M2 是「可行性验证」**，做完就能判断这条路的体验是否值得。**M3–M5 是
「产品化」**，工作量更大且更靠近 UI。

### 不做什么

- 不接现代 MAME 到 wasm（技术不可行，见 §1）。
- 不内置任何 ROM / BIOS（版权；与现有 `.nes` 政策一致）。
- 不为街机重写整个输入系统；先把 2 键 + 投币跑通，再扩 6 键。
- 不在 `wasm/libretro.mjs` 里引入 Node/Electron 依赖（它同时被 Node 测试用）。

---

## 7. 风险与决策点

| # | 决策 | 结论/建议 |
|---|---|---|
| D1 | 接哪个 MAME | MAME 2003-Plus（wasm），现代 MAME 只作 native 备选 |
| D2 | 许可 | **先确认非商业条款可接受，再动手**；发行版附完整许可与来源 |
| D3 | `need_fullpath` | 必须做虚拟 FS；这是最大的一块前端工作 |
| D4 | BIOS/父 ROM | 需要「挂载目录」能力，否则 Neo Geo 等一大类不能玩 |
| D5 | 内存增长 | 允许 MAME 模块 `ALLOW_MEMORY_GROWTH=1`，逐帧验证视图不失效 |
| D6 | 帧率 | 定速改用 `engine.frameSeconds`（load 后的 av_info） |
| D7 | 输入 | 数据驱动（`SET_INPUT_DESCRIPTORS`），不要再硬编码 |
| D8 | 库扩展名 | `.zip` 太通用，考虑「街机」独立目录/机种，而不是混进 NES 列表 |
| D9 | 模块体积 | 17.8 MB 的 wasm 要按需下载/懒加载，不能进首屏 |
| D10 | ROM 版本 | mame2003-plus 要 0.78 时代的 set；现代 set 会缺 ROM，需要在 UI 里解释失败原因 |

---

## 8. 复现命令（本次调研用过的）

```bash
# 1. 取源码
git clone --depth 1 https://github.com/libretro/mame2003-plus-libretro.git
cd mame2003-plus

# 2. 编译（关键是 STATIC_LINKING=0，把 libretro-common 编进来）
source ../../third_party/emsdk/emsdk_env.sh
emmake make -f Makefile platform=emscripten STATIC_LINKING=0 LD=true -j10

# 3. 链接成独立 ES 模块（同 wasm/mesen/build.sh 的形态）
em++ $(find . -name '*.o') -O3 --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1 \
     -sEXPORT_NAME=createMame2003PlusLibretro \
     -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456 -sSTACK_SIZE=1048576 \
     -sALLOW_TABLE_GROWTH=1 \
     '-sEXPORTED_FUNCTIONS=[...retro_*...,"_malloc","_free"]' \
     '-sEXPORTED_RUNTIME_METHODS=[...]' \
     -o mame2003plus_libretro.mjs

# 4. 冒烟：ABI 是否正确（本次结果见 §2.2）
#    - api=1
#    - system: MAME 2003-Plus, ext=zip, needFullpath=true
#    - loadRom(假ROM) -> false（不崩）
```

对照数据（来自 EmulatorJS 的预编译包，`@emulatorjs/core-*`，unpacked 大小）：

| 核心 | 大小 | 说明 |
|---|---|---|
| `core-mgba` | 4.1 MB | 本仓库已接 |
| `core-fbalpha2012_cps1` | 4.1 MB | 只覆盖 CPS1，最小 |
| `core-mame2003` | 19.0 MB | MAME 0.78 |
| `core-mame2003_plus` | 20.4 MB | 本文主角 |
| `core-fbneo` | 31.4 MB | 兼容性最好，也最大 |

> 这些预编译包是「核心 + 定制 RetroArch」的 EJS 产物，不能直接拿来当
> `_retro_*` 模块用——这一点与 mgba 当时发现的一样。所以 §2 才自己编。

---

## 9. 一句话给决策者

**技术上，MAME 2003-Plus 能进这个前端，成本主要花在前端的虚拟文件系统、每
游戏帧率和输入模型上，而不是 MAME 本身；现代 MAME 进不来（wasm 下它是另一个
独立应用，native 下它要走 IPC）。动手前先回答两个问题：街机是不是这个项目的
目标？非商业许可能不能接受？**
