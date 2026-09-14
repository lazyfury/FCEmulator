// ---------------------------------------------------------------------------
// The application shell -- three columns and a title bar.
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ ●●●   FC Emulator                                   ⧉ ⧉ ⧉   │  unified title bar
//   ├────────┬─────────────────────┬───────────────────────────────┤
//   │ 功能区  │ 中间栏              │ 游戏画面                       │
//   │ 游戏库  │ 列表 / 存档 / 设置  │ canvas + 控制条                │
//   │ 置顶    │                     │                               │
//   │ 最近    │                     │                               │
//   │ 存档    │                     │                               │
//   │ 设置    │                     │                               │
//   │ 关于    │                     │                               │
//   ├────────┴─────────────────────┴───────────────────────────────┤
//   │ status bar: fps · cyc · PC · audio · 按键                     │
//   └──────────────────────────────────────────────────────────────┘
//
// The left rail picks what the middle column is; the right column is the
// console and is always the same console. The canvas inside it is mounted
// once and never unmounted: the emulator binds to it when the WebAssembly
// module is built, and tearing it down to show a list would power the machine
// off and on again. See PlayPanel.
//
// State that the whole shell needs lives here -- which section, the search
// text, the sort order, the library itself -- because two columns have to
// agree about it. State that only one panel needs stays in that panel.
//
// The library is the main process's, not this file's. Every call below either
// reads it back whole or changes it and gets the new state back, so there is
// one copy of the truth and no way for the screen to disagree with the
// database.
// ---------------------------------------------------------------------------

import * as Tooltip from '@radix-ui/react-tooltip';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import AboutPanel from './components/AboutPanel';
import LibraryPanel, { type SortKey } from './components/LibraryPanel';
import PlayPanel from './components/PlayPanel';
import SavesPanel from './components/SavesPanel';
import SettingsPanel from './components/SettingsPanel';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import TitleBar from './components/TitleBar';
import { gameTitle } from './format';
import type { CommandName } from './input';
import { SECTION_BY_ID, type SectionId } from './sections';
import { useEmulator } from './useEmulator';
import { useFileDrop } from './useFileDrop';
import { usePixelScale } from './usePixelScale';
import type { Library as LibraryData } from '../shared/api';

/** The four save slots, in the order the keyboard numbers them. */
const SAVE_COMMANDS: readonly CommandName[] = ['quicksave', 'save1', 'save2', 'save3'];
const LOAD_COMMANDS: readonly CommandName[] = ['quickload', 'load1', 'load2', 'load3'];

const SCANLINE_KEY = 'fc.scanlines';

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const { status, loadRom, unload, command } = useEmulator(canvasRef);

    // The canvas keeps its 256x240 backing store -- that is the emulator's
    // output and nothing changes it -- and this decides how large those 256
    // pixels are drawn. See usePixelScale for why it is a whole number.
    const picture = usePixelScale(stageRef, 256, 240);

    const [section, setSection] = useState<SectionId>('library');
    const [library, setLibrary] = useState<LibraryData | null>(null);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<SortKey>('recent');
    const [saves, setSaves] = useState<number[]>([]);
    const [scanlines, setScanlines] = useState(() => window.localStorage.getItem(SCANLINE_KEY) === '1');
    const [notice, setNotice] = useState<string | null>(null);

    // A note under the list, gone again in a moment. Used for the things a
    // player did that the list itself cannot show -- a drop that turned out
    // not to be a ROM.
    const noticeTimer = useRef(0);
    const flash = useCallback((text: string): void => {
        setNotice(text);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(null), 2600);
    }, []);

    useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

    const refreshLibrary = useCallback(async (): Promise<void> => {
        setLoading(true);
        try {
            setLibrary(await window.fc.listGames());
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshSaves = useCallback(async (): Promise<void> => {
        try {
            setSaves(await window.fc.listSaves());
        } catch {
            setSaves([]);
        }
    }, []);

    useEffect(() => {
        void refreshLibrary();
    }, [refreshLibrary]);

    // The slot list is per cartridge, so it is re-read whenever the cartridge
    // changes and whenever the panel that shows it is opened.
    useEffect(() => {
        if (section === 'saves') {
            void refreshSaves();
        }
    }, [section, status.romPath, refreshSaves]);

    useLayoutEffect(() => {
        window.localStorage.setItem(SCANLINE_KEY, scanlines ? '1' : '0');
    }, [scanlines]);

    const play = useCallback(
        async (path: string): Promise<void> => {
            if (!await loadRom(path)) {
                return;
            }
            // The main process has just been told this game was played, which
            // is a row it updates. A moment later the library is read again,
            // and a game sorted by "recent" moves to the top where the player
            // just looked for it.
            window.setTimeout(() => void refreshLibrary(), 300);
        },
        [loadRom, refreshLibrary],
    );

    /**
     * Every library change answers with the whole library, so the screen is
     * never left guessing. Null means the player closed a panel or declined an
     * alert, and the screen keeps what it had.
     *
     * Written out at each call site rather than factored into one function,
     * because a helper defined in the component body and captured by a
     * useCallback with empty dependencies is a stale closure waiting to
     * happen.
     */
    const addGames = useCallback(async (): Promise<void> => {
        const next = await window.fc.addGames();
        if (next !== null) {
            setLibrary(next);
        }
    }, []);

    const chooseDirectory = useCallback(async (): Promise<void> => {
        const next = await window.fc.chooseLibraryDirectory();
        if (next !== null) {
            setLibrary(next);
            setQuery('');
        }
    }, []);

    const togglePinned = useCallback(async (path: string, pinned: boolean): Promise<void> => {
        setLibrary(await window.fc.togglePinned(path, pinned));
    }, []);

    const removeGame = useCallback(async (path: string): Promise<void> => {
        const next = await window.fc.removeGame(path);
        if (next !== null) {
            setLibrary(next);
        }
    }, []);

    /**
     * Games dropped on the window.
     *
     * `null` back means the main process found nothing it would copy: a .zip,
     * a folder with no ROMs in it, or a file that had gone. Saying so is the
     * difference between "that did not work" and "that did nothing", which
     * look identical on screen.
     */
    const dropped = useFileDrop((paths) => {
        void (async (): Promise<void> => {
            const next = await window.fc.addGames(paths);
            if (next === null) {
                flash('拖进来的不是 .nes 文件');
                return;
            }
            setLibrary(next);
        })();
    });

    const openFolder = useCallback((): void => {
        void window.fc.openFolder();
    }, []);

    const eject = useCallback((): void => {
        unload();
        void refreshLibrary();
    }, [unload, refreshLibrary]);

    /** A slot button. The command goes through the keyboard's own handler, and
     *  the disk is re-read a moment later -- the write is asynchronous and
     *  there is no completion event to wait for. */
    const saveTo = useCallback((slot: number): void => {
        command(SAVE_COMMANDS[slot] ?? 'quicksave');
        window.setTimeout(() => void refreshSaves(), 500);
    }, [command, refreshSaves]);

    const loadFrom = useCallback((slot: number): void => {
        command(LOAD_COMMANDS[slot] ?? 'quickload');
    }, [command]);

    const games = library?.games ?? [];
    const loaded = status.romPath !== null;
    const title = loaded ? gameTitle(status.romPath as string) : null;

    /** The three list sections, which differ only in what they filter to. */
    const listPanel = (
        panelTitle: string,
        shown: typeof games,
        emptyTitle: string,
    ) => (
        <LibraryPanel
            title={panelTitle}
            directory={library?.directory ?? ''}
            games={shown}
            loading={loading}
            notice={notice}
            query={query}
            onQuery={setQuery}
            sort={sort}
            onSort={setSort}
            activePath={status.romPath}
            onPick={(path) => void play(path)}
            onAdd={() => void addGames()}
            onChooseDirectory={() => void chooseDirectory()}
            onOpenFolder={openFolder}
            onTogglePinned={(path, pinned) => void togglePinned(path, pinned)}
            onRemove={(path) => void removeGame(path)}
            emptyTitle={emptyTitle}
        />
    );

    const middle = (() => {
        switch (section) {
        case 'library':
            return listPanel('游戏库', games, '这个游戏库里还没有游戏。');
        case 'pinned':
            return listPanel(
                '置顶游戏',
                games.filter((game) => game.pinned),
                '还没有置顶的游戏。在游戏库里点图钉，把它放到最上面。',
            );
        case 'recent':
            return listPanel(
                '最近游玩',
                games.filter((game) => game.lastPlayedAt > 0),
                '还没有玩过任何游戏。',
            );
        case 'saves':
            return (
                <SavesPanel
                    game={title}
                    saves={saves}
                    onSave={saveTo}
                    onLoad={loadFrom}
                    onEject={eject}
                />
            );
        case 'settings':
            return (
                <SettingsPanel
                    status={status}
                    picture={picture}
                    scanlines={scanlines}
                    onScanlines={setScanlines}
                    gamepadEnabled={window.fc.gamepadEnabled}
                    library={library}
                    onChooseDirectory={() => void chooseDirectory()}
                />
            );
        case 'about':
            return <AboutPanel />;
        }
    })();

    const subtitle = title === null
        ? SECTION_BY_ID[section].title
        : `${title} · ${SECTION_BY_ID[section].title}`;

    return (
        // One tooltip provider for the window, so that the hover intent
        // delay is shared: moving along the toolbar should not restart it.
        // It renders no DOM -- see TitleBar for where the tooltips are.
        <Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
            <div className="app">
                <TitleBar
                    section={SECTION_BY_ID[section].title}
                    subtitle={subtitle}
                    busy={loading}
                    onRefresh={() => void refreshLibrary()}
                    onOpenFolder={openFolder}
                    onAbout={() => setSection('about')}
                />

                <div className="workspace">
                    <Sidebar
                        active={section}
                        onSelect={setSection}
                        audioOk={status.audioError === null}
                        gamepadEnabled={window.fc.gamepadEnabled}
                    />

                    {middle}

                    <PlayPanel
                        canvasRef={canvasRef}
                        stageRef={stageRef}
                        picture={picture}
                        status={status}
                        scanlines={scanlines}
                        onCommand={command}
                        onEject={eject}
                        onGoToLibrary={() => setSection('library')}
                    />
                </div>

                <StatusBar status={status} />

                {/* Over everything, and not in the way of anything: it has no
                    pointer events, so the drop lands on the window as it
                    would have without it. */}
                {dropped && (
                    <div className="dropzone" aria-hidden="true">
                        <div className="dropzone-card">
                            <Plus size={22} />
                            <p className="dropzone-title">松手添加到游戏库</p>
                            <p className="dropzone-hint">
                                .nes 文件，或一个装满游戏的文件夹
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </Tooltip.Provider>
    );
}
