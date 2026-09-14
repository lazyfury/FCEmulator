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

    /** Every .nes in the ROM folder, and where that folder is. */
    ListGames: 'fc:list-games',

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
}

export interface Library {
    /** Where these came from, so the screen can say so. */
    directory: string;
    /** The SQLite file inside it, which models these rows. */
    database: string;
    games: GameEntry[];
}

/** A ROM the main process read off disk, on its way to the renderer. */
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

    /** The whole library, pinned first and then most recently played. */
    listGames(): Promise<Library>;

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
     * Open the library folder in the Finder.
     *
     * The library empty state can say where the games go, but a path is only
     * useful if the player can get to it. This is the one convenience the
     * renderer is given over the filesystem, and it names a folder rather
     * than a file: the main process decides what "the library folder" is.
     */
    openFolder(): Promise<boolean>;

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
    addGames(paths?: readonly string[]): Promise<Library | null>;

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
    togglePinned(path: string, pinned: boolean): Promise<Library>;

    /**
     * Delete a game, file and row.
     *
     * Confirmed with a native alert first, in the main process, because this
     * is the one button in the interface that destroys something. Returns
     * null if it was declined.
     */
    removeGame(path: string): Promise<Library | null>;

    /**
     * Point the library at another folder.
     *
     * The choice is remembered across runs. The database lives in whichever
     * folder is chosen, which is why switching libraries switches everything:
     * a library is a folder.
     */
    chooseLibraryDirectory(): Promise<Library | null>;

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
     * True when the app was started with --gamepad.
     *
     * Off by default, and the reason is not caution. On macOS, a page that so
     * much as listens for `gamepadconnected` starts Chromium's gamepad service
     * in the browser process, and that service holds a HID connection that
     * makes the process impossible to shut down: app.quit(), app.exit() and
     * process.exit() all hang in an uninterruptible wait.
     *
     * So the feature is complete, tested, and switched off until either
     * Electron fixes it or somebody finds the teardown that releases it. An
     * application that cannot be quit is worse than one without a gamepad.
     */
    readonly gamepadEnabled: boolean;
}
