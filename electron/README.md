# FC Emulator — Electron front end

One of two front ends. The other, `../frontend/`, is Swift + Metal and is
untouched by anything in here. Both sit on the same C interface
(`../src/ffi/emulator_api.h`), and that interface is the reason there can be
two of them.

The emulator itself is not in this directory and is not written in JavaScript.
It is `../src/core`, compiled to WebAssembly by `../wasm/build.sh`.

---

## Build and run

```bash
# 1. the emulator (once, and again whenever src/ changes)
./wasm/build.sh

# 2. this front end
cd electron
pnpm install
pnpm run dev
```

`pnpm run dev` starts Vite, waits for it to listen, then starts Electron
pointed at it. Press ctrl-c once to stop both.

There are no ROMs in this repository (they are copyrighted, and large). To
play something else:

```bash
pnpm run dev -- --rom "/path/to/game.nes"
```

Started with no arguments the app opens on its **library**. The library is a
folder — by default `~/Library/Application Support/fc-emulator/library` — that
holds the ROMs and a SQLite database describing them. Add games from the
interface with the **+** beside the title, or by dragging `.nes` files -- or a
folder of them -- onto the window. Either way the file is *copied* in and the
original is left where it was. Point the library somewhere else with
`--library-dir` (or `--rom-dir`, its old name):

```bash
pnpm run dev -- --library-dir "/path/to/roms"
```

A game named on the command line skips the library and loads straight away,
which is what the test modes do and what a person does when they want to play
one specific thing.

### Two things that go wrong on a fresh clone

**A blocked install script.** pnpm refuses to run a package's postinstall
script unless you say it may, and it is right to: that script runs with your
user's rights before you have read any of the package's code. esbuild needs
its. That permission lives in `pnpm-workspace.yaml`, it is already set, and if
you ever see `ERR_PNPM_IGNORED_BUILDS`, that file is where the answer is.

**A missing Electron binary.** Electron has no postinstall script any more; it
downloads the browser the first time `node_modules/electron` is required, from
GitHub. Behind a slow or blocked link that fails, and the fix is a mirror:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  node -e "console.log(require('electron'))"
```

Run it once from `electron/`, and the ~100MB download happens then instead of
at some confusing later moment.

---

## Other commands

| Command | What it does |
|---|---|
| `pnpm run build` | compile the main process (`tsc`) and the renderer (`vite build`) |
| `pnpm start` | build, then run the production build |
| `pnpm run typecheck` | type check both, without emitting |
| `pnpm test` | the node test runner over `test/` |
| `pnpm run selftest` | run the app headlessly for 300 frames, print a hash of the picture, screenshot it to `selftest.png` |
| `pnpm run keytest` | press real keys at the window and check what the emulator heard |
| `pnpm run audiotest` | play in real time for eight seconds and report the audio ring |
| `electron . --list` | print the library and exit. A screen cannot be hashed, so this is how it gets checked |
| `electron . --gamepad` | turn on gamepad support. See the note in Status first |
| `electron . --layout` | resize the window through eight sizes and check how the picture fitted |
| `./verify.sh [rom-dir]` | run every ROM through the native build and through this app, and fail if any pixel or any sample differs |
| `pnpm run wasm` | rebuild the WebAssembly module |

---

## Where things are

```
src/
  main/index.ts       the window, the app:// protocol, the IPC handlers that
                      touch the filesystem, and the --selftest / --keytest /
                      --audiotest / --list hooks
  main/library.ts     the library folder as a model: the SQLite schema, the
                      scan-and-reconcile, pinning, importing, deleting, and
                      what a dropped path amounts to. Knows nothing about
                      Electron, so it is tested from plain Node
                      (test/library.test.mjs)
  preload/index.ts    the eight functions the page is allowed to call
  renderer/
    useEmulator.ts    loading the wasm, the frame loop, the clock
    useFileDrop.ts    files dragged onto the window, and the highlight while
                      a drag is in progress
    input.ts          the key map, and the merging of input sources
    sections.ts       what the left rail can show, and each section's icon
    format.ts         bytes, cycles and dates as short strings
    audio/
      output.ts       the page-thread half of the audio ring, and the rate control
      pcm-worklet.js  the audio-thread half. Plain JS: addModule needs a URL,
                      so this one file is not bundled
    components/
      TitleBar.tsx    the unified title bar and its toolbar buttons
      Sidebar.tsx     the function area: icons and names, stacked vertically
      LibraryPanel.tsx  the game list, its search field and its sort control
      SavesPanel.tsx  the four save slots
      SettingsPanel.tsx  a read-only report on the machine, the library, and
                      one switch
      AboutPanel.tsx  what the project is, and the chain from ROM to pixel
      PlayPanel.tsx   the canvas, the pause overlay and the transport buttons
      StatusBar.tsx   fps, cycles, PC, audio and the keys held
    App.tsx           the three-column shell, and what the middle column is
  shared/api.ts       the contract between main and renderer
```

Three rules worth knowing before changing anything:

**The emulator does not run in the main process.** It runs in the renderer, as
WebAssembly, because that is where the canvas is. `fc_framebuffer()` returns a
pointer, the pointer is an offset into wasm linear memory, and linear memory is
a JavaScript `ArrayBuffer` — so the picture the emulator draws is already in
memory the canvas can read. No copy, no IPC, no serialisation.

**The renderer does not own the clock.** Its `requestAnimationFrame` callback
asks "has a frame come due?" and runs however many have. See the comment at the
top of `useEmulator.ts` for why running exactly one frame per animation frame
is wrong by 0.16%, which is a whole second every ten minutes.

**The audio thread never waits.** Samples reach the speaker through a
`SharedArrayBuffer` ring that the page thread fills and the `AudioWorklet`
drains. Neither side ever blocks on the other: a full ring drops the newest
samples, an empty one emits silence, and both are counted. That means the
renderer must be cross origin isolated — COOP and COEP — which is why those
headers are set in two places: `vite.config.ts` for development, and the
`app://` handler in `src/main/index.ts` for everything else. If they ever
disagree, audio works in development and silently fails in the packaged app.

**The preload is the whole hole in the wall.** Everything the page can reach
in Node is in `src/preload/index.ts`; if it is not there, the page cannot do
it. It is eight verbs long, and the one that writes — `openFolder` — is handed
a directory the main process chose, not a path the page made up.

**The interface is three columns.** A function rail on the left (icons with
their names under them, like VS Code's activity bar), the middle column the
rail selects, and the play area on the right. The canvas lives in the play
column and is never unmounted: the emulator binds to it once, when the
WebAssembly module is built, so swapping it out to glance at the library
would rebuild the machine. Only the middle column changes. See the comment at
the top of `App.tsx`.

---

## The library is a database

The library is one folder that holds two things: the `.nes` files, and
`library.sqlite` beside them. Modelling it in SQLite rather than in a JSON
file of last-played dates buys three properties:

* **A game is a row, not a file name.** Pinning (置顶) and a play count have
  somewhere to live. So does a rename: a rename keeps the file's size and
  modification time, so a scan that finds one name gone and an identical file
  arrived knows it is the same game and carries its pin and its count over.
* **The folder is still the truth about what exists.** Every listing rescans
  the directory and reconciles — insert what is new, update what changed,
  forget what is gone. Dropping a ROM in with the Finder works exactly as it
  always did, and the database is a model *of* the folder rather than a second
  place to keep in sync with it.
* **A library is one folder.** Move it, copy it, delete it; the games and
  everything known about them travel together. Switching libraries in the
  interface switches the database too, which is the point.

```sql
CREATE TABLE games (
    id             INTEGER PRIMARY KEY,
    file           TEXT    NOT NULL UNIQUE,  -- relative to the library root
    title          TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    mtime_ms       INTEGER NOT NULL,         -- the reconcile's two
    added_at       INTEGER NOT NULL,
    last_played_at INTEGER NOT NULL DEFAULT 0,
    play_count     INTEGER NOT NULL DEFAULT 0,
    pinned         INTEGER NOT NULL DEFAULT 0
);
```

`file` is relative, so moving the folder does not invalidate every row. The
rows are ordered in the query by pin and play date; the panel reorders the
name tiebreak in JavaScript, because SQLite has no ICU and `localeCompare`
is what puts Chinese titles in pinyin order rather than by code point.

**Importing a game, and why the renderer may name a path.** Two ways in — the
open panel, and a drop — and one implementation: both produce a list of paths,
both go through `collectGames()`, and both end in `GameLibrary.add()`, which
copies. A dropped folder means the ROMs directly inside it, one level, because
a folder of ROMs is a folder of ROMs and a folder *containing* one is usually
somebody's Documents directory arriving by accident.

A drop is the one case where the renderer names files rather than naming a
game, so it is worth being precise about why that is not a hole. It does not
get to read them: `collectGames()` drops anything that is not a `.nes` regular
file, and `add()` only ever copies *into* the library. The worst a renderer bug
can do is copy a ROM that a person dragged in. And the path itself comes from
`webUtils.getPathForFile()`, which refuses a `File` that was not produced by a
real drag — the `path` property that used to make this trivial was removed in
Electron 32 for exactly that reason.

**Why `node:sqlite` and not an npm SQLite.** It is the same C library, compiled
into Node 24 and therefore into Electron 44. It is synchronous, which suits a
main process that runs one query between IPC calls against a table with tens of
rows, and — the actual prize — it means there is no native module to rebuild
against Electron's ABI. `better-sqlite3` would need `@electron/rebuild` in the
install path, and a clone that skipped it would fail at run time in the middle
of a game.

The journal mode is left at the default rollback journal rather than WAL, so
that the only file added to a folder full of ROMs is `library.sqlite`. A test
asserts exactly that (`test/library.test.mjs`).

**What is not migrated.** Older builds kept last-played dates in
`userData/library.json` and read ROMs from `~/Documents/FC games`. That file is
no longer read: the dates describe absolute paths in a folder that is no longer
the library, so there is nothing to carry them to. The first import rebuilds
the history from scratch.

---

## Look and feel

The window is a macOS application, so it is drawn the way macOS draws one: a
unified title bar with the real traffic lights over it (`titleBarStyle:
'hiddenInset'`), a translucent rail on the left, a document area in the
middle, and the content — here a television set — in the space that is left.
The vocabulary is Aqua's, reduced to the parts a window made of HTML can
honestly reproduce: one accent colour used only for selection and focus, 1px
separators rather than shadows between regions, rounded rectangles no larger
than 9px, the system font, and a monospaced one for the columns of numbers.

Both appearances are implemented through `prefers-color-scheme`, and
`color-scheme` goes with them, so form controls, scroll bars and the caret are
Chromium's own in the right shade rather than restyled by hand and subtly
wrong. Nothing is fetched at runtime — the application is offline, and always
has been — so the two third-party packages are bundled, not loaded:

| package | what it is for |
| --- | --- |
| `lucide-react` | the icons. The rail, the toolbar and every button |
| `@radix-ui/react-toggle-group` | the sort control. A segmented control is a single-select toggle group, and this one has the roving tab index and the arrow keys |
| `@radix-ui/react-switch` | the scanline filter. A real `role="switch"`, styled from scratch |
| `@radix-ui/react-tooltip` | the toolbar buttons' tooltips, in a portal so a tooltip near the edge of a clipped column is whole |

Radix was chosen because it is headless: it brings the behaviour and the
accessibility, and the stylesheet keeps the look. A component library with its
own opinions about spacing and colour would have to be fought, and the fight
would show.

Where the emulator's own numbers appear — fps, cycles, PC, the audio ring —
they are monospaced and tabular so that a readout does not jitter sideways
twice a second.

---

## Status

M7. The emulator runs, draws, takes input, plays sound, pauses, saves and
loads, rewinds, and is checked against the native build pixel for pixel and
sample for sample — including through a save and reload, and through a rewind
and replay. Around it is a macOS-style window in three columns: a function
rail, a game library modelled in SQLite (pin, import, delete, play counts),
and the picture.

Gamepad support is written and tested but **switched off by default**. See
below; it is not caution.

What is not here: controller support that can be switched on safely, and
packaging (`electron-builder` and a `.dmg`).

### Fitting the picture to the window

The canvas stays 256x240 — that is the emulator's output and nothing changes
it. What changes is how large those pixels are drawn, and the rule is that a
NES pixel is a **whole number of device pixels**. Filling the window, or
letting the browser fit it with `max-width`, divides neighbouring pixels into
different physical widths, and a row of identical ground tiles comes out
looking like it is breathing.

Two details that are easy to get wrong, both handled in
`src/renderer/usePixelScale.ts`:

* **Device pixels, not CSS pixels.** On a 2x display a CSS scale of 3 is 6
  device pixels and is fine; on a 1.5x display it is 4.5 and is not. At 1.5x
  the picture is drawn 683 CSS pixels wide — 4 device pixels per game pixel,
  which is 2.667 CSS pixels, and a fractional CSS size is exactly right.
* **Moving the window between monitors.** The container does not change size,
  so a resize observer sees nothing. What changes is `devicePixelRatio`, and
  the only event for it is a media query at the current ratio.

```
$ pnpm exec electron . --layout
window        stage        canvas       scale  ratio  centred  fits
1280x800   1280x662     640x600     5.00x  1.067  yes     yes
 420x380   420x314      256x240     2.00x  1.067  yes     yes
 300x260   300x194      128x120     1.00x  1.067  yes     yes
PASSED
```

`ratio 1.067` is 256:240 exactly, so nothing is stretched; `scale` is in device
pixels, so it is a whole number on any display; `centred` compares the two
horizontal gaps with each other and the two vertical ones with each other,
which is what centring means for a picture that is not square.

### Rewind

Ten seconds of it, held on Backspace. Snapshots are taken every two frames
into a ring, and the storage lives in the emulator's own memory rather than in
JavaScript — thirty `Uint8Array` allocations a second is thirty garbage
collections a minute, and this project has already had one audio glitch caused
by forgetting that a per-frame allocation is a per-frame allocation. See
`wasm/emulator.mjs`'s `StateBuffer`.

It is checked the same way save states are: winding back and replaying has to
land on exactly the frame it left. `electron . --selftest` does that at the end
of every run, and the two hashes are compared:

```
$ pnpm run selftest
hash 300 a1cacd38b1d7493b1cfce739fb5ffb3652745e9ee0a11aa6b54d9d6071af2d1e
rewind a1cacd38b1d7493b1cfce739fb5ffb3652745e9ee0a11aa6b54d9d6071af2d1e
rewind check   : lands on the same frame
```

### Why the gamepad is off

`--gamepad` turns it on. The code is complete: it polls once per animation
frame, merges into the same `InputManager` the keyboard uses (so a button held
on a pad is not released by letting go of a key), has a deadzone, and lets go
of everything when a pad is unplugged or runs out of battery.

It is off because on macOS it makes the application impossible to quit.

A page that so much as adds a `gamepadconnected` listener — without ever
calling `navigator.getGamepads()` — starts Chromium's gamepad service in the
browser process. That service holds a HID connection, and once it is up the
process cannot be shut down: `app.quit()`, `app.exit()` and `process.exit()`
all leave it sitting in an uninterruptible wait (`ps` state `U`) until it is
killed with SIGKILL.

This was found because the test modes stopped exiting. It would have hit a
player the first time they closed the window, which is why it is a default
rather than a footnote.

The mapping itself is a plain function, `mapPad()`, and is tested — including
the two things that go wrong in every gamepad implementation: the face buttons
swapped, and a worn stick drifting the player into a wall. What cannot be
tested here is the reading, and that is the part that misbehaves.

### Keys

| Key | |
|---|---|
| arrows / WASD | d-pad |
| Z / J | B |
| X / K | A |
| Enter, Space | Start |
| Tab, Right Shift | Select |
| Escape, P | pause |
| R | reset |
| F1, F2, F3 | save to slot 1, 2, 3 |
| Shift + F1, F2, F3 | load from slot 1, 2, 3 |
| F5, F6 | quick save, quick load (slot 0) |
| Backspace (hold) | rewind |

### How the save states are checked

Three layers again, and the first one is the only one that matters.

**The property.** Saving and immediately reloading has to change *nothing*.
A state missing one field loads happily and diverges a few frames later, so
"the bytes came back" is not a test. `tests/test_state.cpp` runs sixty frames,
saves, reloads, runs sixty more, and requires the picture to be exactly where
it would have been without the round trip.

**Between the builds.** `wasm/verify.sh` now runs every ROM four times —
native and wasm, each straight through and each with a save and reload in the
middle — and requires all four to agree. The state *files* are compared too,
which is the strictest possible form of "the two builds agree about what a
machine is", and is only possible because the format writes little endian
explicitly instead of copying the host's bytes.

```
$ ./wasm/verify.sh
PASSED: 38 run(s) byte for byte identical, 8 skipped
```

Every mapper this emulator implements saves its bank registers, and every ROM
in the folder round trips. Nine mappers are covered — 0, 1, 2, 3, 4, 7, 19,
163 and 177 — and `tests/test_state.cpp` fails the build if one of them stops
covering itself.

`fc_mapper_saves_state()` is what a front end asks before promising the player
a save that quietly is not one. Every mapper here answers yes now, but a
newly written mapper will not until its two methods exist, and the difference
is invisible until somebody tries it.

**In the application.** Every Electron self test now performs a save and
reload in the middle of its run, through the real path: serialize, hand the
bytes to the main process, let it write a file, read it back, restore. If that
changed anything, the frame hashes would stop matching the native build. So
`verify.sh`'s 46 passing runs also say that save states work in the app,
without a test of their own.

### How the input is checked

Three layers, because each one can fail while the others pass:

| Where | What it proves | Command |
|---|---|---|
| `test/input.test.mjs` | the key map is right, and a button held by two sources is not dropped when one of them lets go | `pnpm test` |
| `verify.sh` | the emulator behaves identically under scripted input in Electron and natively, on every ROM | `./verify.sh` |
| `--keytest`, below | a real keystroke reaches the emulator | `pnpm run keytest` |

The middle one drives `setButton` directly, so on its own it would still pass
on a front end with no keyboard handling at all. The last one is what closes
that gap: Chromium delivers a genuine `KeyboardEvent` to the page, and the
result is read back out of the emulator's input manager.

```
$ pnpm run keytest
key            held after keyDown           expected   result
z              B                             B          ok
Left           LEFT                          LEFT       ok
Return         START                         START      ok
Tab            SELECT                        SELECT     ok
```

### How the audio is checked

Three layers again, and the third one is the only place in the project that
is allowed to take real time.

**The samples are right.** The self test hashes the raw float32 samples the
APU produced, and `verify.sh` compares that hash against
`fc_headless --samples` -- which shares no code with it. Every ROM, both
scenarios, bit for bit:

```
$ ./verify.sh
    super-mario-bros    identical (4 frames + audio)
PASSED: 2 run(s) identical pixel for pixel and sample for sample
```

Bit for bit is a real claim here. The APU mixes in floating point, and a
cross compilation is allowed to fuse `a*b+c` into a multiply-add on one side
and not the other. It does not, which is worth knowing and worth keeping.

**The samples arrive.** A hash says the emulator computed the right numbers;
it says nothing about whether a speaker ever saw them. `--audiotest` runs the
application in real time, presses Start once a second through real key events,
and then reads the audio ring back:

```
$ pnpm run audiotest
  t+1s  peak 0.000  fill 3058  underruns 0  dropped 0
  t+4s  peak 0.512  fill 2406  underruns 0  dropped 0
  t+8s  peak 0.673  fill 3088  underruns 0  dropped 0
frames         : 484  (60.30 fps, want 60.10)
audio state    : running
result         : ok
```

That one check covers more than it looks like it does. It is the only test
that runs the emulator through its real animation-frame loop, and it found a
bug no other test could reach: the status line was doing arithmetic on the
cycle counter, which the C API returns as a `uint64_t` and Emscripten hands
back as a `BigInt`. Every earlier test disabled the frame loop, so nothing ever
displayed the status line. See `test/emulator.test.mjs`.

**What none of it proves: that any of it sounds right.** A hash cannot hear
the mix. What it can do is rule out everything upstream, and report the numbers
to look at when something is wrong -- `fill` should sit near its target, and
`underruns` and `dropped` should stay at zero.
