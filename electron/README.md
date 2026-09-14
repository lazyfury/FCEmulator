# FC Emulator — Electron front end

The front end. It sits on the C interface (`../src/ffi/emulator_api.h`);
the emulator itself is not in this directory and is not written in JavaScript.
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
holds the ROMs, a `screenshots/` folder, and a SQLite database describing both.
Add games from the interface with the **+** beside the title, or by dragging
`.nes` files — or a folder of them — onto the window. Either way the file is
*copied* in and the original is left where it was. Point the library somewhere
else with `--library-dir` (or `--rom-dir`, its old name):

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
| `pnpm run build` | compile the main process (`tsc`), the renderer (`vite build`) and the native gamepad helper |
| `pnpm run build:native` | build just the helper, `native/bin/fc-gamepad` |
| `pnpm start` | build, then run the production build |
| `pnpm run typecheck` | type check both, without emitting |
| `pnpm test` | the node test runner over `test/` |
| `pnpm run selftest` | run the app headlessly for 300 frames, print a hash of the picture, screenshot it to `selftest.png` |
| `pnpm run keytest` | press real keys at the window and check what the emulator heard |
| `pnpm run audiotest` | play in real time for eight seconds and report the audio ring |
| `electron . --list` | print the library and exit. A screen cannot be hashed, so this is how it gets checked |
| `electron . --gamepad` | force the gamepad source on. On this machine the native helper is on by default, so this is only needed when the helper was not built |
| `electron . --browser-gamepad` | use the browser's Gamepad API instead of the native helper. The old path; on macOS it stops the app quitting |
| `electron . --no-gamepad` | start with no gamepad source at all |
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
                      scan-and-reconcile, pinning, importing, deleting,
                      screenshots and covers, and what a dropped path amounts
                      to. Knows nothing about Electron, so it is tested from
                      plain Node (test/library.test.mjs)
  main/gamepad.ts     the native helper as a child process: spawn it, parse
                      the JSON lines it writes, filter out readings that have
                      not changed, and forward the rest. No Electron in it, so
                      plain Node tests the state machine
                      (test/gamepad.test.mjs)
  preload/index.ts    the functions the page is allowed to call
  renderer/
    useEmulator.ts    loading the wasm, the frame loop, the clock
    engineStatus.ts   the shape of the engine's report, and what it becomes
                      when the cartridge comes out. No WebAssembly in it, so
                      plain Node can test the transition
                      (test/status.test.mjs)
    usePanelWidth.ts  the divider between the middle column and the picture:
                      the drag, the clamps, the keyboard, the persistence
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
      LibraryPanel.tsx  the game list: cards, covers, search and sort
      ScreenshotsPanel.tsx  every screenshot, with 设为封面 and delete
      SavesPanel.tsx  the four save slots
      SettingsPanel.tsx  a read-only report on the machine, the library, and
                      one switch
      AboutPanel.tsx  what the project is, and the chain from ROM to pixel
      PlayPanel.tsx   the canvas, the pause overlay and the transport buttons
      StatusBar.tsx   the footer: the speaker and pad indicators with words,
                      then fps, cycles, PC, audio and the keys held
    App.tsx           the three-column shell, and what the middle column is
  shared/api.ts       the contract between main and renderer

native/
  build.sh            builds the helper into native/bin/fc-gamepad
  gamepad/            the helper itself: a Swift package using Apple's
                      GameController framework. Its README has the protocol
                      and the reason it is a separate process at all
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
it. It is a short list of named verbs, and the one that writes — `openFolder` — is handed
a directory the main process chose, not a path the page made up.

**One object per thing the screen draws.** The library and its screenshots are
one value (`LibraryState`) because they are revised together — a screenshot
changes a game's cover. The engine's report is one value (`EngineStatus`) and
`romPath` is the field that says whether a cartridge is in the slot: the title,
the transport buttons, the placeholder, the card marked as playing and the save
panel are all derived from it. So ejecting is a transition on that object
rather than a set of edits scattered through the components, and it lives in
`engineStatus.ts`, where a plain Node test can reach it. That is not tidiness:
the bug it was written for was an eject that stopped the machine but left the
game on screen in five different places at once.

**The interface is three columns.** A function rail on the left (icons with
their names under them, like VS Code's activity bar), the middle column the
rail selects, and the play area on the right. The canvas lives in the play
column and is never unmounted: the emulator binds to it once, when the
WebAssembly module is built, so swapping it out to glance at the library
would rebuild the machine. Only the middle column changes. See the comment at
the top of `App.tsx`.

**Fullscreen is the console, not the whole window.** F11, or the button in the
strip above the picture, makes the shell fullscreen and hides what is about
*choosing* a game: the title bar, the rail, the list and the divider. What
stays is everything that is about playing one -- the picture, the strip above
it with the game's name and the machine's lights, the transport buttons below,
and the readout at the bottom. A picture you cannot pause from the sofa is a
worse picture. It is the DOM's `requestFullscreen`, not
`BrowserWindow.setFullScreen`, so it is `:fullscreen` in the stylesheet that
decides the layout, and Escape that leaves -- the browser owns that key, and an
application you cannot leave is a worse bug than one you cannot enter. The
scale stays a whole number of device pixels per game pixel, because
`usePixelScale` measures the box and does not care how large it is. See
`useFullscreen.ts`.

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

CREATE TABLE screenshots (
    id         INTEGER PRIMARY KEY,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    file       TEXT    NOT NULL UNIQUE,      -- screenshots/<stamp>-<rand>.png
    created_at INTEGER NOT NULL,
    is_cover   INTEGER NOT NULL DEFAULT 0    -- at most one per game
);
```

`file` is relative, so moving the folder does not invalidate every row. The
rows are ordered in the query by pin and play date; the panel reorders the
name tiebreak in JavaScript, because SQLite has no ICU and `localeCompare`
is what puts Chinese titles in pinyin order rather than by code point.

**Screenshots, and why the cover is a flag.** A screenshot is a PNG in
`screenshots/`, named `<milliseconds>-<four random bytes>.png` — opaque on
purpose, because the directory is storage and the database is the model: a name
that encoded the game and the date would be a second, weaker copy of rows that
already hold both, and it would have to be rewritten every time a game was
renamed. The association lives in `screenshots.game_id`, which is also what
makes a rename free: the row keeps its id, so the pictures follow the game.

There are two ways to take one, and the difference is what happens to the card.
**截图** (F12) keeps the picture, and the *first* screenshot of a game also
becomes its cover, because a game with a picture and no cover is a card showing
a coloured rectangle for no reason. **更新封面** (⇧F12) keeps the picture *and*
puts it on the card, replacing whatever was there — that is the `asCover`
argument, and it is the only thing that differs between them. Both go through
one `saveScreenshot`, so "exactly one cover per game" has one implementation:
clear the old flag and insert the new row in a single transaction.

The cover is not a second picture and not a path stored on `games`. It is
`is_cover` on one of the game's own screenshots, and that choice does a lot of
work: there is one copy of every picture, so setting a cover cannot leave a
stale one behind; deleting the cover is not a special case — the row goes and
the newest remaining picture is promoted; and `games` never changes shape,
which is why upgrading a version 1 library is a `CREATE TABLE` rather than a
copy of every row through a new table. Deleting a game deletes its pictures,
from the database and from disk both, and the test for it deletes the ROM in
the Finder rather than through the application, because that path has to work
too.

**Why the pictures go through a URL.** The renderer cannot read the filesystem,
so a cover arrives the way every other subresource in a page does:
`app://library/screenshots/x.png`, fetched by Chromium, cached by Chromium,
decoded off the main thread. The alternative — bytes over IPC, turned into a
blob URL per card — would be a round trip and a live object per thumbnail. The
protocol handler serves exactly one directory and exactly one file type
(`screenshots/*.png`), so it is a picture frame rather than a window into the
disk: a ROM, the database, and anything reachable with `..` are refused, and
the suite checks each of those.

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

**The middle column is resizable.** A divider between it and the picture,
dragged with the mouse or nudged with the arrow keys (Home and End for the
limits, double click to put it back). Four things about it are worth knowing
before changing it, and `usePanelWidth.ts` explains all four:

* the drag listens on the **window**, not on the seven-pixel handle, because a
  handle that only works while the cursor is inside it stops dead the moment
  the hand outruns the events;
* the width is a **number in state**, not a measurement, so the drag cannot
  chase its own layout;
* the column is `flex: 0 0 var(--panel-width)` — with the default shrink, a
  window too small for the row would silently override the dragged width and
  the divider would stop following the pointer. Below 700px the divider is
  hidden and the column goes back to being shrinkable, so a small window still
  gives the picture a share instead of squeezing it out;
* the ceiling is recomputed on window resize, so shrinking the window and
  growing it again cannot resurrect a width that no longer fits.

The width is remembered in `localStorage`: it describes this screen, not the
games, so it has no business in the library's database.

---

## Status

M7. The emulator runs, draws, takes input, plays sound, pauses, saves and
loads, rewinds, and is checked against the native build pixel for pixel and
sample for sample — including through a save and reload, and through a rewind
and replay. Around it is a macOS-style window in three columns: a function
rail, a game library modelled in SQLite (pin, import, delete, play counts),
and the picture.

Gamepad support runs in a **native helper** by default: a separate process
using Apple's GameController framework, so Chromium never touches HID and the
application still quits. See below.

The machine — the WebAssembly module, the `Emulator` and the audio ring — is
built **on demand**, the first time a game is loaded, rather than when the
window opens. The library screen is up immediately and does not wait for it.
The test modes pass `--fc-eager` to build it at start up instead; see the
`eager` flag in `src/shared/api.ts`.

Packaging is `electron-builder`: `pnpm run dist` writes a `.dmg` into
`release/`, with the native gamepad helper copied into the application bundle
by the `extraResources` rule in `package.json`.

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

### How the gamepad works, and why it is a separate process

The reading happens in `native/bin/fc-gamepad`, a small Swift program in
`native/gamepad/` that uses Apple's GameController framework and writes JSON
lines to stdout. The main process spawns it, parses the lines
(`src/main/gamepad.ts`), and pushes each reading over IPC to
`NativeGamepadSource` in the renderer, which reports into the same
`InputManager` the keyboard uses. A button held on a pad is therefore not
released by letting go of a key, and the pad is released when it is unplugged
or runs out of battery.

It is a separate process for one reason, and the reason is in git history.

**The browser path does not quit.** On macOS a page that so much as adds a
`gamepadconnected` listener — without ever calling `navigator.getGamepads()` —
starts Chromium's gamepad service in the browser process. That service holds a
HID connection, and once it is up the process cannot be shut down:
`app.quit()`, `app.exit()` and `process.exit()` all leave it sitting in an
uninterruptible wait (`ps` state `U`) until it is killed with SIGKILL. This was
found because the test modes stopped exiting; it would have hit a player the
first time they closed the window.

A child process can be killed, so the reading moved there. `--browser-gamepad`
is kept because it is the path that reproduces the bug, and being able to
switch it on is how the fix is checked.

```bash
pnpm run dev:gamepad      # the dev server, native helper
pnpm run gamepad          # the built application, native helper
pnpm run gamepad:browser  # the built application, browser Gamepad API
```

`pnpm run build` builds the helper, so `pnpm start` and every test script have
it. A checkout that has not built it logs `gamepad: helper not built` and the
source simply does not start — a gamepad that does nothing and says so, rather
than one that does nothing and says nothing.

The mapping is tested in both directions now: `mapPad()` in the renderer (the
browser path), and `parseGamepadLine()` in the main process (the native one).
Both cover the two things that go wrong in every gamepad implementation — the
face buttons swapped, and a worn stick drifting the player into a wall. What
cannot be tested from Node is the actual reading; that is what a pad on the
desk is for, and it is why the helper logs every connection, press and
release.

#### When a pad does nothing

Everything the gamepad path knows is logged, prefixed `gamepad:`, and the main
process prints the renderer's console to the terminal — so the answer is in the
output of the run, in this order.

The native path is the default and says this:

| what appears | what it means |
|---|---|
| `gamepad: helper started (/…/native/bin/fc-gamepad)` | the main process spawned the helper. No line means the helper was not built — run `pnpm run build:native` |
| `gamepad: helper not built (…)` | the binary is missing; the gamepad source does not start |
| `gamepad: native source started, watching for a pad` | the renderer is listening for pushed readings |
| `gamepad: connected "…" (native, GameController)` | the helper found a pad and named it |
| `gamepad: down          A` | a press arrived and went into the input manager. A press with no line is a press the helper never reported |
| `gamepad: disconnected  "…"` | the pad went away, and every button it held was released |
| `gamepad: helper exited (…)` | the helper died mid-run. The framework's own message is on stderr, one line above |

The browser path (`--browser-gamepad`) says this instead:

| what appears | what it means |
|---|---|
| `gamepad: browser path enabled by --gamepad` | the flag was parsed by the main process. No line means the argument never reached it |
| `gamepad: browser source started, watching for a pad` | the source is polling |
| `gamepad: not enabled -- see the main process log for why` | nothing is reading pads, and the line above says which reason applies |
| `gamepad: disabled for a scripted run -- …` | `--selftest` or `--keytest`: a real pad would make the test nondeterministic |
| `gamepad: connected "…" mapping=standard` | the browser sees the pad, and its buttons are where this expects them |
| `gamepad: connected "…" mapping=(none)` | the browser sees the pad but has no standard layout for it; the indices in `gamepad.ts` are a guess, and the `(index N)` in the log says which button actually fired |
| `gamepad: down          A (index 0)` | a press arrived and went into the input manager |
| `gamepad: no pad after two seconds…` | the browser is reporting nothing at all |

When no pad turns up, the reasons worth checking are:

1. **The pad is not paired, or is asleep.** Press a button on it to wake it.
2. **The window has to be focused** — for the *browser* path only. The Gamepad
   API exposes pads to the focused document and nobody else; the native helper
   has no such rule, and also sees a pad that was connected before the app
   started.
3. **Chromium only lists a gamepad once it has been used** — browser path only.
   A pad that is plugged in and untouched sends nothing, which is
   indistinguishable from a broken one.
4. **macOS may be withholding the device.** System Settings → Privacy &
   Security → **Input Monitoring**, tick Electron (or this application), then
   quit and start again — macOS reads that list at launch. Chromium asks for
   this itself the first time the *browser* path polls for gamepads
   (`IOHIDRequestAccess`); if that prompt was answered "Don't Allow", macOS
   remembers and only System Settings can undo it. The native helper goes
   through GameController instead, which is why the same pad can work on one
   path and not the other.

The sandbox is not a factor on the browser path, and it is worth saying so
because it looks like one: `webPreferences.sandbox` is already `false`, and the
Gamepad API is a renderer web API rather than a Node one, so the sandbox
setting does not gate it either way.

The same information is on screen, without the terminal: the 设置 panel has a
手柄 group (switch, state, name, layout), and the gamepad dot at the bottom of
the rail is lit only when a pad is actually being reported — the difference
between "switched on" and "a pad is here" being the whole of the question.

### Two players, one keyboard, and more than one pad

The console has two controller ports, and the settings panel's **输入** group is
where the two things a person can hold are wired to them.

**The keyboard is one player or two.** In 单人 (one player) every key drives the
same port — so the arrows and WASD are the same person, which is what the table
below has always meant — and 作为 picks whether that person is player 1 or
player 2. In 双人 (two players) the bindings keep their own ports, and the
default split puts WASD, J/K, Enter and Tab on player 1 and the arrows, Z/X,
Space and right Shift on player 2. The same list is read two ways; that is the
whole of the difference, and it is why a custom binding does not have to know
which mode it was made in. `bindings.ts` holds the list and the resolver, and
`test/bindings.test.mjs` pins the rule.

**Every key can be rebound.** Click a key cap in 按键绑定 and press the key you
want. The capture is a capture-phase window listener, which is what keeps the
key from reaching the game while it is being assigned. Rebinding a key that is
already taken swaps the two rather than making one of them dead, because the
resolver takes the first binding for a key and drops the rest. Escape, P, R,
Backspace and F1–F12 belong to the application and cannot be bound.

**Each pad picks its player.** 手柄 lists every connected pad by its slot, name
and layout, with 1P / 2P / 关闭 next to each. With no assignment the first pad
is player 1 and the second is player 2; an explicit assignment, including
"off", wins. The slot is the handle, not the name: two identical controllers
report the same `id`. The helper reports every pad it can see, not just the
first — see `native/gamepad/README.md` for the protocol.

All of it lives in the same `config.json` the library root does, under `input`,
written through `WriteInputSettings`. It is one object rather than a field at a
time, because a rebinding is only meaningful together with the keyboard mode it
was made under. The main process validates it on the way in, so a config file
somebody edited by hand cannot make the application start with a binding that
means nothing.

### Keys

These are the defaults. The settings panel is where they are changed, and where
the keyboard is set to one player or two.

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
