// ---------------------------------------------------------------------------
// The contract between the main process and the renderer.
//
// Both sides import this file, which is the only reason it exists: a channel
// name spelled once cannot be misspelled on one side, and changing the shape
// of a message breaks the build instead of failing at runtime in the middle of
// a game.
//
// Keep it small. Everything the renderer can ask the main process for is a
// hole in the wall between the emulator and the operating system, and every
// hole needs a reason.
// ---------------------------------------------------------------------------

export const IpcChannel = {
    /** Read the ROM named on the command line. Returns BootRom or null. */
    GetBootRom: 'fc:get-boot-rom',

    /** The whole library: every game and every screenshot. */
    Library: 'fc:library',

    /** Read one ROM by path, for when the player picks one from the list. */
    ReadRom: 'fc:read-rom',

    /** Remember that a game was played, so the list can put it first next time. */
    NotePlayed: 'fc:note-played',

    /** Write save state bytes into a slot. Returns false if it could not. */
    SaveState: 'fc:save-state',

    /** Read a slot back, or null if it is empty. */
    LoadState: 'fc:load-state',

    /** Which slots have something in them. */
    ListSaves: 'fc:list-saves',

    /** Show the ROM folder in the Finder. */
    OpenFolder: 'fc:open-folder',

    /** Copy ROMs into the library, chosen through a native open panel. */
    AddGames: 'fc:add-games',

    /** Pin a game to the top of the list, or unpin it. */
    TogglePinned: 'fc:toggle-pinned',

    /** Delete a game from the library, after a native confirmation. */
    RemoveGame: 'fc:remove-game',

    /** Point the library at another folder, chosen through a native panel. */
    ChooseLibraryDirectory: 'fc:choose-library-directory',

    /** Which cartridge is in the slot, so its save states can be filed. */
    SetCartridge: 'fc:set-cartridge',

    /** Write a PNG taken from the picture into the library. */
    SaveScreenshot: 'fc:save-screenshot',

    /** Make one screenshot the game's cover. */
    SetScreenshotCover: 'fc:set-screenshot-cover',

    /** Delete a screenshot: its file, and its row. */
    RemoveScreenshot: 'fc:remove-screenshot',

    /** Rewrite the input settings: keyboard mode, bindings, pad assignment. */
    WriteInputSettings: 'fc:write-input-settings',

    /** The cheats saved for one cartridge. */
    ReadCheats: 'fc:read-cheats',

    /** Replace the cheats saved for one cartridge. */
    WriteCheats: 'fc:write-cheats',

    /** The window preferences: scanline overlay, middle column width. */
    ReadPreferences: 'fc:read-preferences',

    /** Change one window preference, and remember it. */
    WritePreference: 'fc:write-preference',

    /** The native gamepad helper's current reading, asked for on start up. */
    GetGamepadState: 'fc:get-gamepad-state',

    /** Pushed by the main process whenever the pad changes. */
    GamepadState: 'fc:gamepad-state',
} as const;

/** One game in the library. */
export interface GameEntry {
    path: string;
    /** The file name without its extension, which is the closest thing to a
     *  title that can be read without running the game. */
    name: string;
    size: number;
    /** Pinned games sort to the top of every list and have a section of their
     *  own. This is the first thing the library database can express that a
     *  directory listing cannot. */
    pinned: boolean;
    /** How many times the cartridge has been run. */
    playCount: number;
    /** When it entered the library, and when it was last run. 0 means never. */
    addedAt: number;
    lastPlayedAt: number;
    /**
     * The screenshot used as this game's cover, relative to the library root,
     * or null if it has none. Null is not an error state: a game with no
     * cover is drawn as a coloured card with its name on it.
     *
     * Relative rather than absolute, and a path rather than a URL, because
     * this is what the database stores -- see src/main/library.ts. Turn it
     * into something an `<img>` can fetch with `libraryAssetUrl`.
     */
    cover: string | null;
    /** How many screenshots have been taken of it. */
    screenshots: number;
}

/** One screenshot, as the screenshots section sees it. */
export interface Screenshot {
    id: number;
    /** The game it was taken from. */
    gamePath: string;
    game: string;
    /** Relative to the library root. */
    file: string;
    createdAt: number;
    /** Whether this is the game's cover. At most one per game. */
    isCover: boolean;
}

/**
 * The library and its screenshots, in one answer.
 *
 * The two move together -- taking a screenshot changes the cover and the
 * screenshot count on a game -- so the verbs that change either one return
 * both. One round trip, and no window in which the screen is showing a game
 * with a cover it no longer has.
 */
export interface LibraryState {
    library: Library;
    screenshots: Screenshot[];
}

export interface Library {
    /** Where these came from, so the screen can say so. */
    directory: string;
    /** The SQLite file inside it, which models these rows. */
    database: string;
    games: GameEntry[];
}

/**
 * The console's eight switches, named the way the C enum names them.
 *
 * Spelled out here rather than in the renderer because the main process has
 * to understand them too: the native helper reports these names on stdout, and
 * a name that only one side knows is a mapping that silently drops a button.
 */
export type GamepadButtonName =
    | 'A' | 'B' | 'SELECT' | 'START'
    | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/**
 * One physical pad, as the helper or the browser sees it.
 *
 * `index` is the slot it was found in, which is what the settings screen
 * lists and what a player assignment names. It is stable for as long as the
 * pad stays connected, and it is the only handle there is: two identical
 * controllers report the same `id`, so the name cannot identify one.
 */
export interface PadReading {
    index: number;
    /** The framework's or browser's name for the pad. */
    id: string;
    /** Which of the eight are down. */
    buttons: Record<GamepadButtonName, boolean>;
}

/**
 * Every pad that is connected right now.
 *
 * A list rather than one pad, because the console has two ports and two
 * players may each want a controller. One of these crosses the IPC boundary
 * every time the list changes, and not once per frame: a reading that is the
 * same as the last one is filtered out by the main process before it is sent.
 */
export interface GamepadReading {
    pads: PadReading[];
}

/** Nothing plugged in, which is where every session starts. */
export const NO_GAMEPAD_READING: GamepadReading = { pads: [] };

/**
 * One key on the keyboard, and where it goes.
 *
 * `code` is a `KeyboardEvent.code` -- the physical key, not the character it
 * produces -- so the same binding works on an AZERTY keyboard. `port` is the
 * console's controller port: 0 is player 1, 1 is player 2.
 */
export interface KeyBinding {
    code: string;
    port: number;
    button: GamepadButtonName;
}

/**
 * How the keyboard and the pads are wired to the console's two ports.
 *
 * The keyboard can be one player or two. As one, every key drives the same
 * port -- so the arrows and WASD are the same person, which is what a single
 * player expects. As two, the keys keep their own ports and the usual split
 * puts WASD on player 1 and the arrows on player 2.
 */
export interface InputSettings {
    /** Whether the keyboard is one player or two. */
    keyboard: '1p' | '2p';
    /** In '1p' mode, the port the keyboard drives. Ignored in '2p'. */
    keyboardPlayer: number;
    /** The bindings, or null for the built-in defaults. */
    bindings: KeyBinding[] | null;
    /**
     * Which port each connected pad drives, by pad index. `-1` means the pad
     * is ignored. A missing entry falls back to the index: pad 0 to player 1,
     * pad 1 to player 2, everything after that unused.
     */
    padPorts: number[];
}

/** Everything at its default, which is also what a fresh config file means. */
export const DEFAULT_INPUT_SETTINGS: InputSettings = {
    keyboard: '1p',
    keyboardPlayer: 0,
    bindings: null,
    padPorts: [],
};

/**
 * One cheat: a byte, at an address, put back when the game overwrites it.
 *
 * The address is in the CPU's own 16 bit space -- console RAM lives at
 * $0000-$07FF, and `address` is one of those -- which is the same space a Game
 * Genie code names and the same one the debugger shows. `label` is for the
 * list on screen and nothing else; the machine never sees it.
 */
export interface Cheat {
    label: string;
    address: number;
    value: number;
    /** Rewrite it at the start of every frame, rather than only once. */
    freeze: boolean;
    /** Remembered but switched off. */
    enabled: boolean;
}

/** The host the `app://` protocol serves library files under. */
export const LIBRARY_HOST = 'library';

/**
 * A URL for a file inside the library, for an `<img>` to fetch.
 *
 * The renderer cannot read the filesystem, so the picture has to arrive the
 * way every other subresource in a page does: a URL, fetched by Chromium,
 * cached by Chromium, and decoded off the main thread. The alternative -- the
 * bytes over IPC, made into a blob URL per card -- would mean a round trip and
 * a live object per thumbnail, for no benefit at all.
 *
 * The handler behind this URL serves one directory and one file type; see
 * registerAppProtocol in src/main/index.ts. It is not a window into the disk.
 */
export function libraryAssetUrl(file: string): string {
    return `app://${LIBRARY_HOST}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The preferences that belong to this window rather than to the library.
 *
 * They used to live in the renderer's `localStorage`, which turned out to be a
 * start up hazard: the first synchronous DOM Storage access blocks the
 * renderer for seconds while Electron's storage service starts -- measured at
 * 3.7 seconds, which was the whole of the application's start up time. They
 * are ordinary settings, so they live in the same config file the library root
 * does (see src/main/index.ts) and reach the page over ordinary asynchronous
 * IPC, which answers in about two milliseconds.
 */
export interface Preferences {
    /** Whether the scanline overlay is drawn over the picture. */
    scanlines: boolean;
    /** Middle column width in CSS pixels, or null when it has never been set. */
    panelWidth: number | null;
    /** How the keyboard and the pads are wired to the two ports. */
    input: InputSettings;
}

/** Which preference a write is about. */
export type PreferenceName = 'scanlines' | 'panelWidth';

/** The value of a preference. The name says which type it has to be. */
export type PreferenceValue = boolean | number;

/**
 * A ROM the main process read off disk, on its way to the renderer.
 */
export interface BootRom {
    /** Where it came from, for the window title. */
    path: string;
    /** The whole .nes file. Structured clone handles a Uint8Array directly. */
    bytes: Uint8Array;
}

/** What the renderer reports back about a run. */
export interface FrameStats {
    frameCount: number;
    totalCycles: number;
    cpuPc: number;
    sampleRate: number;
    /** Highest APU sample seen, so a silent emulator is visible as 0.000. */
    audioPeak: number;
    /** Frames per second actually achieved, measured over the last second. */
    fps: number;
}

/**
 * The only thing this app puts on `window`. Deliberately not "electron" and
 * deliberately not forty methods: the renderer is a game screen, and the
 * smaller this surface stays, the less there is to get wrong.
 */
export interface FcBridge {
    getBootRom(): Promise<BootRom | null>;

    /**
     * The whole library: every game, and every screenshot.
     *
     * One call rather than two, because the two are drawn together -- a card
     * shows a game's cover and its screenshot count, and the screenshots
     * section lists the pictures themselves -- and two calls would be two
     * chances for the screen to be showing half of one state and half of
     * another.
     */
    library(): Promise<LibraryState>;

    /**
     * Read one ROM by path.
     *
     * The path is checked against the library folder before anything is
     * opened: the renderer can name a game, not a file. It is given no ability
     * to read from the filesystem, and this is the one place that could become
     * one.
     */
    readRom(path: string): Promise<Uint8Array | null>;

    /**
     * Say that a game was played.
     *
     * The library's memory belongs in the main process because it outlives
     * the renderer, and because it is a row in a database that only the main
     * process has open.
     */
    notePlayed(path: string): Promise<void>;

    /**
     * Save states on disk.
     *
     * A slot is a small integer. Slot 0 is the quick save key; 1, 2 and 3 are
     * F1 to F3. The main process owns the files, because the renderer has no
     * filesystem access and should not be given any to write a save file.
     */
    saveState(slot: number, bytes: Uint8Array): Promise<boolean>;
    loadState(slot: number): Promise<Uint8Array | null>;
    listSaves(): Promise<number[]>;

    /**
     * Open the library folder -- or a folder inside it -- in the Finder.
     *
     * The empty state can say where the games go, but a path is only useful
     * if the player can get to it, and the screenshots live in a subfolder
     * that is otherwise invisible. This is the one convenience the renderer is
     * given over the filesystem, and it names a folder rather than a file: the
     * main process decides what "inside the library" means, and creates the
     * folder if it is not there yet.
     */
    openFolder(subdirectory?: string): Promise<boolean>;

    /**
     * Copy ROMs into the library.
     *
     * With no argument, the files are chosen through a native open panel,
     * which the renderer cannot open and cannot influence: it says "let the
     * player pick some games", and the main process decides what that means.
     *
     * With paths -- from a drag and drop -- those are what gets copied. The
     * renderer is allowed to name them because a drop is a person pointing at
     * a file; the main process still filters them down to ROMs before
     * anything is opened, so the worst a renderer bug can do is copy a .nes
     * it should not have.
     *
     * Returns null if the player closed the panel, or if what arrived was not
     * a ROM.
     */
    addGames(paths?: readonly string[]): Promise<LibraryState | null>;

    /**
     * The path a dropped `File` came from.
     *
     * This is the one question about a file the renderer can ask, and it is
     * the only way to answer it: Electron removed the `path` property from
     * `File` objects in version 32, because a page that can turn a file into
     * a filesystem path is a page that can probe the disk. The replacement is
     * `webUtils.getPathForFile`, which the preload wraps -- and which only
     * ever answers for a file the operating system actually dragged in.
     */
    filePath(file: File): string;

    /** Pin a game to the top of the list. Returns the library, re-read. */
    togglePinned(path: string, pinned: boolean): Promise<LibraryState>;

    /**
     * Delete a game, file and row -- and its screenshots with it.
     *
     * Confirmed with a native alert first, in the main process, because this
     * is the one button in the interface that destroys something. Returns
     * null if it was declined.
     */
    removeGame(path: string): Promise<LibraryState | null>;

    /**
     * Point the library at another folder.
     *
     * The choice is remembered across runs. The database lives in whichever
     * folder is chosen, which is why switching libraries switches everything:
     * a library is a folder.
     */
    chooseLibraryDirectory(): Promise<LibraryState | null>;

    /**
     * Write a PNG taken from the picture, and file it under a game.
     *
     * The bytes come from the renderer because that is where the canvas is;
     * the file and the row are the main process's, because it owns the disk
     * and the database. Rejects bytes that are not a PNG, and a game that is
     * not in the library.
     *
     * `asCover` is the 更新封面 button: the new picture replaces whatever the
     * game's card was showing. Without it, only the first screenshot of a game
     * becomes the cover.
     */
    saveScreenshot(
        gamePath: string,
        bytes: Uint8Array,
        asCover?: boolean,
    ): Promise<LibraryState | null>;

    /**
     * Make a screenshot the cover of the game it belongs to.
     *
     * A cover is not a separate picture stored twice: it is a flag on one of
     * the game's screenshots, so setting a cover and taking a screenshot are
     * the same kind of thing and deleting the cover is not a special case.
     */
    setScreenshotCover(id: number): Promise<LibraryState | null>;

    /** Delete a screenshot: the PNG from the library folder, and its row. */
    removeScreenshot(id: number): Promise<LibraryState | null>;

    /**
     * The window preferences: scanlines and the middle column width.
     *
     * Read once on start up. Unlike the library these are small and local, so
     * there is nothing to stream and nothing to keep in sync -- the page asks
     * for them, draws with them, and writes them back when they change.
     */
    preferences(): Promise<Preferences>;

    /**
     * Remember one preference.
     *
     * Fire and forget from the page's point of view: the screen has already
     * changed by the time this is called, and the disk is the main process's
     * business. A failure to write is logged there, not thrown here.
     */
    setPreference(name: PreferenceName, value: PreferenceValue): Promise<void>;

    /**
     * Replace the whole input configuration.
     *
     * One verb for the whole object rather than a field at a time, because
     * the parts are read together: a rebinding is only meaningful with the
     * keyboard mode it was made under, and two writes would leave a window
     * where the file holds half of one configuration and half of another.
     */
    saveInputSettings(settings: InputSettings): Promise<void>;

    /** The cheats saved for one cartridge, or an empty list. */
    readCheats(romPath: string): Promise<Cheat[]>;

    /** Replace the cheats saved for one cartridge. */
    writeCheats(romPath: string, cheats: Cheat[]): Promise<void>;

    /**
     * Say which cartridge is in the slot.
     *
     * Save states are filed per cartridge, and the main process owns those
     * files. It used to work this out from the ROM named on the command line,
     * which meant saving silently failed for any game started from the
     * library. This is how it is told instead.
     */
    setCartridge(path: string | null): Promise<void>;

    /**
     * When this run's start up began, in epoch milliseconds.
     *
     * The renderer is a separate process from the dev script and the main
     * process, so its `Date.now()` origin is not theirs. This is the shared
     * origin, handed down the chain, and it is what lets a boot trace print
     * the renderer's first paint on the same clock as the TypeScript compile
     * that happened several seconds before it. Zero when nobody set one -- the
     * packaged application, or the renderer opened on its own -- and the
     * renderer then falls back to its own origin, which is still correct, just
     * not comparable. See src/shared/boot.ts.
     */
    readonly bootT0: number;

    /**
     * True when the app was started with --selftest.
     *
     * In that mode the renderer must not start its frame loop. The test is a
     * parity check: after N frames the CPU must have run exactly the number of
     * cycles the native build ran, from exactly the same starting state. A
     * loop that had already run a few frames would leave the machine past that
     * state, and resetting is not enough to undo it -- Machine::reset() clears
     * the CPU, PPU and APU, but a mapper's bank registers are the cartridge's
     * and survive it.
     */
    readonly selftestOnly: boolean;

    /**
     * True when the machine must be built at start up rather than on demand.
     *
     * Normally the WebAssembly module and the emulator are built lazily, the
     * first time a game is loaded, so that the library screen appears without
     * waiting for them. That is wrong for a check that wants the machine at a
     * known moment -- `--selftest`, `--keytest` and `--audiotest` -- and for
     * `--layout`, which waits on the test hook that building the machine is
     * what publishes. Those runs pass `--fc-eager`.
     */
    readonly eager: boolean;

    /**
     * Ask whether a gamepad source should be started, and which kind.
     *
     * `gamepadEnabled` says a source is running. `gamepadNative` says it is
     * the native helper in `native/gamepad` rather than the browser's Gamepad
     * API. The renderer has to know which, because the two are fed in opposite
     * directions: the browser source is polled once per animation frame, and
     * the native one pushes readings over IPC as they change.
     */
    readonly gamepadEnabled: boolean;

    /**
     * True when the gamepad source is the native helper.
     *
     * The native helper exists because of what is documented above on
     * `gamepadEnabled`: it is a separate process using Apple's GameController
     * framework, so Chromium never touches HID and the application can still
     * quit. It is macOS-only, and on macOS it is now the default.
     */
    readonly gamepadNative: boolean;

    /** The native helper's latest reading. */
    getGamepadState(): Promise<GamepadReading>;

    /**
     * Listen for readings from the native helper.
     *
     * Push, not pull. The helper already polls at 60Hz and already filters out
     * readings that have not changed, so the renderer only ever hears about a
     * button going down or coming up. `offGamepadState` stops the listening;
     * a renderer that forgets to call it would keep a listener per mount.
     */
    onGamepadState(callback: (reading: GamepadReading) => void): void;
    offGamepadState(): void;
}

/**
 * The file extensions the emulator can run, and the one test for them.
 *
 * Shared rather than written twice: the main process filters the library by
 * these, and the renderer picks a libretro core by them. A file the library
 * lists but the renderer has no core for is a game that appears and then
 * fails, which is the drift keeping one list prevents.
 */
export const ROM_EXTENSIONS = ['nes', 'gba', 'gb', 'gbc'] as const;
