// ---------------------------------------------------------------------------
// The preload script.
//
// This is the only thing that runs with access to both Node (through Electron)
// and the page. It runs in an isolated world, so what it defines on `window`
// is a deliberate, frozen copy -- not a live object the page can walk back
// into the main process through.
//
// The whole Node attack surface of this application is the object below:
// named verbs, each of which the main process checks again before it touches
// anything. The page cannot open a path, read a directory or spawn a process;
// it can only ask for a game, a save slot, or the library folder -- and the
// two verbs that change the library go through a native panel or a native
// confirmation that the page cannot draw or dismiss itself.
// ---------------------------------------------------------------------------

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

import {
    IpcChannel, type BootRom, type FcBridge, type GamepadReading, type LibraryState,
} from '../shared/api';

/**
 * The renderer's one gamepad listener, held here rather than in the page.
 *
 * `onGamepadState` replaces whatever was listening before, so a component that
 * mounts twice cannot end up with two listeners and two button presses per
 * press. The page never sees an ipcRenderer, only the callback it handed over.
 */
let gamepadListener: ((event: IpcRendererEvent, reading: GamepadReading) => void) | null = null;

const bridge: FcBridge = {
    getBootRom: () => ipcRenderer.invoke(IpcChannel.GetBootRom) as Promise<BootRom | null>,

    saveState: (slot, bytes) =>
        ipcRenderer.invoke(IpcChannel.SaveState, { slot, bytes }) as Promise<boolean>,

    library: () => ipcRenderer.invoke(IpcChannel.Library) as Promise<LibraryState>,

    readRom: (path) =>
        ipcRenderer.invoke(IpcChannel.ReadRom, path) as Promise<Uint8Array | null>,

    notePlayed: (path) =>
        ipcRenderer.invoke(IpcChannel.NotePlayed, path) as Promise<void>,

    loadState: (slot) =>
        ipcRenderer.invoke(IpcChannel.LoadState, slot) as Promise<Uint8Array | null>,

    listSaves: () => ipcRenderer.invoke(IpcChannel.ListSaves) as Promise<number[]>,

    openFolder: (subdirectory) =>
        ipcRenderer.invoke(IpcChannel.OpenFolder, subdirectory) as Promise<boolean>,

    addGames: (paths) =>
        ipcRenderer.invoke(IpcChannel.AddGames, paths) as Promise<LibraryState | null>,

    filePath: (file) => webUtils.getPathForFile(file),

    togglePinned: (path, pinned) =>
        ipcRenderer.invoke(IpcChannel.TogglePinned, { path, pinned }) as Promise<LibraryState>,

    removeGame: (path) =>
        ipcRenderer.invoke(IpcChannel.RemoveGame, path) as Promise<LibraryState | null>,

    chooseLibraryDirectory: () =>
        ipcRenderer.invoke(IpcChannel.ChooseLibraryDirectory) as Promise<LibraryState | null>,

    setCartridge: (path) =>
        ipcRenderer.invoke(IpcChannel.SetCartridge, path) as Promise<void>,

    saveScreenshot: (gamePath, bytes, asCover) =>
        ipcRenderer.invoke(
            IpcChannel.SaveScreenshot, { gamePath, bytes, asCover },
        ) as Promise<LibraryState | null>,

    setScreenshotCover: (id) =>
        ipcRenderer.invoke(IpcChannel.SetScreenshotCover, id) as Promise<LibraryState | null>,

    removeScreenshot: (id) =>
        ipcRenderer.invoke(IpcChannel.RemoveScreenshot, id) as Promise<LibraryState | null>,

    // The main process appends this through webPreferences.additionalArguments
    // when it was started with --selftest. Reading it here rather than over
    // IPC keeps the renderer from having to wait for an answer before it can
    // decide whether to start running frames.
    selftestOnly: process.argv.includes('--fc-selftest'),
    eager: process.argv.includes('--fc-eager'),
    gamepadEnabled: process.argv.includes('--fc-gamepad'),
    gamepadNative: process.argv.includes('--fc-gamepad-native'),

    getGamepadState: () =>
        ipcRenderer.invoke(IpcChannel.GetGamepadState) as Promise<GamepadReading>,

    onGamepadState: (callback) => {
        if (gamepadListener !== null) {
            ipcRenderer.removeListener(IpcChannel.GamepadState, gamepadListener);
        }
        gamepadListener = (_event, reading) => callback(reading);
        ipcRenderer.on(IpcChannel.GamepadState, gamepadListener);
    },

    offGamepadState: () => {
        if (gamepadListener !== null) {
            ipcRenderer.removeListener(IpcChannel.GamepadState, gamepadListener);
            gamepadListener = null;
        }
    },
};

contextBridge.exposeInMainWorld('fc', bridge);
