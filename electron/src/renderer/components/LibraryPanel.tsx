// ---------------------------------------------------------------------------
// The game library -- the middle column.
//
// A list of what is in the library folder. There is no cover art, because
// there is nowhere to get it from: a .nes file contains no title, no publisher
// and no date that can be read without running the game, and scraping a
// database for artwork would mean this application talked to the network,
// which it otherwise never does.
//
// What is left is the file name, which for ROMs is surprisingly informative --
// "Super Mario Bros. (Japan, USA)" is a better label than most title screens.
// So the list is built around the name: a search field over it, three orders
// for it, and one line of facts beside each entry.
//
// The row carries two controls besides "open". A pin, which is the one thing
// the database remembers that a folder listing could not (see main/library.ts),
// and a delete, which is the only control in the application that destroys
// something and therefore goes through a native confirmation in the main
// process. They sit outside the row's open button because a button inside a
// button is not a thing.
// ---------------------------------------------------------------------------

import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
    FolderCog, FolderOpen, Pin, Plus, Search, Trash2, Triangle, X,
} from 'lucide-react';

import type { GameEntry } from '../../shared/api';
import { formatSize, formatWhen } from '../format';

export type SortKey = 'recent' | 'name' | 'size';

const SORTS: readonly { key: SortKey; label: string }[] = [
    { key: 'recent', label: '最近' },
    { key: 'name', label: '名称' },
    { key: 'size', label: '大小' },
];

interface LibraryPanelProps {
    title: string;
    directory: string;
    games: GameEntry[];
    loading: boolean;
    /** A short note about the last thing that happened to the library, or
     *  null. Cleared by the shell after a moment. */
    notice: string | null;
    query: string;
    onQuery: (query: string) => void;
    sort: SortKey;
    onSort: (sort: SortKey) => void;
    /** The cartridge in the slot, so the list can mark the row. */
    activePath: string | null;
    onPick: (path: string) => void;
    onAdd: () => void;
    onChooseDirectory: () => void;
    onOpenFolder: () => void;
    onTogglePinned: (path: string, pinned: boolean) => void;
    onRemove: (path: string) => void;
    /** What to say when the folder has nothing in it. Different sections are
     *  empty for different reasons -- no games at all, or none pinned. */
    emptyTitle: string;
}

/**
 * Case-insensitive, and on the name only -- matching the whole path would make
 * every entry in a folder with a Chinese name match every query.
 */
function matches(game: GameEntry, needle: string): boolean {
    return game.name.toLocaleLowerCase().includes(needle);
}

/** Pinned first, always, and then whichever order was asked for. */
function ordered(games: GameEntry[], sort: SortKey): GameEntry[] {
    const copy = [...games];
    const bySecondary = (a: GameEntry, b: GameEntry): number => {
        switch (sort) {
        case 'recent':
            // Most recently played first, then alphabetical. The games
            // somebody actually plays end up at the top without anything
            // having to be pinned there.
            return a.lastPlayedAt !== b.lastPlayedAt
                ? b.lastPlayedAt - a.lastPlayedAt
                : a.name.localeCompare(b.name);
        case 'name':
            return a.name.localeCompare(b.name);
        case 'size':
            return b.size - a.size;
        }
    };

    copy.sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || bySecondary(a, b));
    return copy;
}

export default function LibraryPanel({
    title,
    directory,
    games,
    loading,
    notice,
    query,
    onQuery,
    sort,
    onSort,
    activePath,
    onPick,
    onAdd,
    onChooseDirectory,
    onOpenFolder,
    onTogglePinned,
    onRemove,
    emptyTitle,
}: LibraryPanelProps) {
    const needle = query.trim().toLocaleLowerCase();
    const shown = ordered(needle === '' ? games : games.filter((game) => matches(game, needle)), sort);

    return (
        <section className="panel" aria-label={title}>
            <header className="panel-head">
                <div className="panel-title">
                    <h2>{title}</h2>
                    <span className="panel-count">
                        {loading ? '读取中…' : `${shown.length} / ${games.length}`}
                    </span>
                    <span className="panel-title-actions">
                        <button
                            type="button"
                            className="icon-button"
                            onClick={onAdd}
                            title="添加游戏（拷贝到游戏库）"
                            aria-label="添加游戏"
                        >
                            <Plus size={14} />
                        </button>
                        <button
                            type="button"
                            className="icon-button"
                            onClick={onChooseDirectory}
                            title="选择游戏库文件夹"
                            aria-label="选择游戏库文件夹"
                        >
                            <FolderCog size={14} />
                        </button>
                    </span>
                </div>

                <div className="panel-tools">
                    <div className="search">
                        <Search size={13} aria-hidden="true" />
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => onQuery(event.target.value)}
                            placeholder="搜索游戏"
                            spellCheck={false}
                            autoComplete="off"
                        />
                        {query !== '' && (
                            <button type="button" onClick={() => onQuery('')} aria-label="清除搜索">
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {/* A segmented control is three mutually exclusive choices,
                        which is what a single-select toggle group is. Radix
                        brings the roving tab index and the arrow keys; the
                        macOS look is the stylesheet's. */}
                    <ToggleGroup.Root
                        type="single"
                        value={sort}
                        onValueChange={(value) => {
                            // Null when the pressed item is pressed again, which
                            // a segmented control must not allow: one of the
                            // three is always the order.
                            if (value !== '') {
                                onSort(value as SortKey);
                            }
                        }}
                        className="segmented"
                        aria-label="排序方式"
                    >
                        {SORTS.map((option) => (
                            <ToggleGroup.Item
                                key={option.key}
                                value={option.key}
                                className="segment"
                                title={`按${option.label}排序`}
                            >
                                {option.label}
                            </ToggleGroup.Item>
                        ))}
                    </ToggleGroup.Root>
                </div>
            </header>

            <div className="panel-scroll">
                {notice !== null && <p className="notice">{notice}</p>}

                {!loading && games.length === 0 && (
                    <div className="empty">
                        <p>{emptyTitle}</p>
                        <p className="empty-path">{directory}</p>
                        <button type="button" className="button" onClick={onAdd}>
                            <Plus size={14} />
                            添加游戏
                        </button>
                        <button type="button" className="button" onClick={onOpenFolder}>
                            <FolderOpen size={14} />
                            在访达中打开
                        </button>
                        <p className="empty-hint">
                            添加会把手选的 <code>.nes</code> <strong>拷贝</strong>进游戏库，
                            原文件留在原处。也可以把文件或文件夹直接拖进窗口。
                        </p>
                    </div>
                )}

                {!loading && games.length > 0 && shown.length === 0 && (
                    <div className="empty">
                        <p>{query !== '' ? `没有匹配「${query}」的游戏。` : emptyTitle}</p>
                    </div>
                )}

                <ul className="games">
                    {shown.map((game) => {
                        const playing = game.path === activePath;
                        const classes = ['game-row'];
                        if (playing) {
                            classes.push('game-playing');
                        }
                        if (game.pinned) {
                            classes.push('game-pinned');
                        }
                        return (
                            <li key={game.path} className={classes.join(' ')}>
                                <button
                                    type="button"
                                    className="game"
                                    onClick={() => onPick(game.path)}
                                    title={game.path}
                                >
                                    <span className="game-mark" aria-hidden="true">
                                        <Triangle size={9} className="game-mark-icon" />
                                    </span>
                                    <span className="game-body">
                                        <span className="game-name">{game.name}</span>
                                        <span className="game-meta">
                                            <span>{formatSize(game.size)}</span>
                                            <span className="game-when">
                                                {formatWhen(game.lastPlayedAt)}
                                            </span>
                                            {game.playCount > 0 && (
                                                <span>{game.playCount} 次</span>
                                            )}
                                        </span>
                                    </span>
                                </button>

                                <span className="game-actions">
                                    <button
                                        type="button"
                                        className="icon-button"
                                        aria-pressed={game.pinned}
                                        onClick={() => onTogglePinned(game.path, !game.pinned)}
                                        title={game.pinned ? '取消置顶' : '置顶'}
                                        aria-label={game.pinned ? '取消置顶' : '置顶'}
                                    >
                                        <Pin size={12} />
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-button"
                                        onClick={() => onRemove(game.path)}
                                        title="从游戏库删除"
                                        aria-label="从游戏库删除"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </span>
                            </li>
                        );
                    })}
                </ul>

                {directory !== '' && (
                    <p className="panel-foot" title={directory}>
                        {directory}
                    </p>
                )}
            </div>
        </section>
    );
}
