// ---------------------------------------------------------------------------
// The game library, as a database.
//
// Until now the library *was* the folder listing: whatever .nes files were in
// one directory, with the times they were last played kept in a JSON file
// beside the save states. That is enough to list games and nothing else --
// there is nowhere to put a favourite, nowhere to put a play count, and no way
// to tell a file that was renamed from a file that was replaced.
//
// So the model moves into SQLite. Three things make that worth the trouble:
//
//   1. The database describes a *game*, not a file name. A pinned game can be
//      remembered, and a rename can be followed rather than thrown away.
//   2. The directory is still the truth about what exists. Every listing
//      rescans it and reconciles, so dropping a .nes in with the Finder works
//      exactly as it always did and deleting one makes it disappear from the
//      list. The database is a model *of* the folder, not a replacement for it.
//   3. It lives in the library folder, so a library is one folder: the ROMs,
//      their metadata, and nothing else to keep in sync. Move the folder and
//      the library moves with it.
//
// SQLite here is Node's own `node:sqlite` -- the same C library everything
// else links, compiled into the runtime. It is synchronous, which suits this:
// the statements run on the main process between IPC calls, the table has tens
// of rows, and a worker thread would add a message protocol to buy nothing
// measurable. The real prize is that there is no native module to rebuild
// against Electron's ABI, which is the sort of thing that works until somebody
// clones the repository on a Tuesday.
//
// This file deliberately knows nothing about Electron. It is handed a folder
// and it models that folder, which is what makes it testable from plain Node
// (see test/library.test.mjs).
// ---------------------------------------------------------------------------

import {
    copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { GameEntry } from '../shared/api';

/** The database file. Named so, and placed inside the library folder, because
 *  a library is one folder that can be moved, copied or deleted whole. */
export const DATABASE_FILE = 'library.sqlite';

/** What this build understands. A database with a higher number was written by
 *  a newer build, and guessing at its columns would corrupt it. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
    id             INTEGER PRIMARY KEY,
    -- The file name relative to the library folder. Relative, not absolute,
    -- so that moving the library does not invalidate every row.
    file           TEXT    NOT NULL UNIQUE,
    title          TEXT    NOT NULL,
    size           INTEGER NOT NULL,
    mtime_ms       INTEGER NOT NULL,
    added_at       INTEGER NOT NULL,
    last_played_at INTEGER NOT NULL DEFAULT 0,
    play_count     INTEGER NOT NULL DEFAULT 0,
    pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
);

CREATE INDEX IF NOT EXISTS games_order
    ON games (pinned DESC, last_played_at DESC, title COLLATE NOCASE);
`;

/** A row, as SQLite hands it over: snake_case, integers for booleans. */
interface Row {
    file: string;
    title: string;
    size: number;
    mtime_ms: number;
    added_at: number;
    last_played_at: number;
    play_count: number;
    pinned: number;
}

/** What a file on disk looks like, which is all the reconcile needs. */
interface DiskFile {
    size: number;
    mtime: number;
}

/** True when `candidate` is the root itself or something inside it. Resolved
 *  first, so that `..` is collapsed before the comparison rather than after --
 *  without that, a path like `/library/../secrets` would pass. */
export function isInside(root: string, candidate: string): boolean {
    const base = resolve(root);
    const target = resolve(candidate);
    return target === base || target.startsWith(base + sep);
}

/** The game's title: the file name without its extension. A .nes contains no
 *  title, no publisher and no date that can be read without running it, and
 *  this is the closest thing to a name that can be had for free. */
function titleOf(file: string): string {
    return basename(file, extname(file));
}

function isRom(name: string): boolean {
    return name.toLowerCase().endsWith('.nes');
}

/**
 * The ROMs a set of dropped or chosen paths amount to.
 *
 * A drag from the Finder can be a file or a folder, and a folder is what
 * somebody means when they drop a directory of games on the window, so it is
 * expanded a level. Recursion is deliberately not offered: a folder of ROMs is
 * a folder of ROMs, but a folder containing a folder of ROMs is usually
 * somebody's Documents directory arriving by accident, and copying that in
 * would be a surprise.
 *
 * Nothing is reported about what was skipped. The renderer asked for games;
 * whether a path was a .zip, a directory with no ROMs in it, or a file that
 * had already been deleted is not interesting enough to interrupt with.
 */
export function collectGames(paths: readonly string[]): string[] {
    const found: string[] = [];

    for (const path of paths) {
        if (typeof path !== 'string' || path === '') {
            continue;
        }
        try {
            const info = statSync(path);
            if (info.isDirectory()) {
                for (const name of readdirSync(path).sort()) {
                    if (!isRom(name)) {
                        continue;
                    }
                    try {
                        const child = join(path, name);
                        if (statSync(child).isFile()) {
                            found.push(child);
                        }
                    } catch {
                        // Vanished between listing and stat. Ignore.
                    }
                }
            } else if (info.isFile() && isRom(path)) {
                found.push(path);
            }
        } catch {
            // A path that is not there is not a game.
        }
    }

    return found;
}

/**
 * The library folder, modelled.
 *
 * One open handle per library, for the lifetime of the process. `open()` is
 * synchronous and cheap; `scan()` is the call that does the work, and it is
 * the only one a caller has to think about, because it is the one that reads
 * the folder.
 */
export class GameLibrary {
    /** The folder the ROMs and the database live in. Absolute. */
    readonly root: string;
    /** The .sqlite file inside it. */
    readonly databasePath: string;

    readonly #db: DatabaseSync;

    private constructor(root: string, databasePath: string, db: DatabaseSync) {
        this.root = root;
        this.databasePath = databasePath;
        this.#db = db;
    }

    /**
     * Open -- or create -- the library in `root`.
     *
     * Creating it is the common case: a player points the application at an
     * empty folder, or at a folder full of ROMs it has never seen, and both
     * of those should simply work rather than reporting a missing file.
     */
    static open(root: string): GameLibrary {
        const absolute = resolve(root);
        mkdirSync(absolute, { recursive: true });

        const databasePath = join(absolute, DATABASE_FILE);
        const db = new DatabaseSync(databasePath);

        const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
            .user_version;

        if (version === 0) {
            db.exec(SCHEMA);
            db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        } else if (version > SCHEMA_VERSION) {
            db.close();
            throw new Error(
                `${databasePath} was written by a newer version of FC Emulator `
                + `(schema ${version}, this build understands ${SCHEMA_VERSION})`,
            );
        }

        return new GameLibrary(absolute, databasePath, db);
    }

    close(): void {
        this.#db.close();
    }

    /**
     * Make the model agree with the folder, and return the model.
     *
     * This is the whole of the synchronisation, and it is deliberately one
     * function: read the directory, add what is new, update what changed,
     * forget what is gone. There is no file watcher and no cached list, so
     * there is no way for the model and the folder to drift apart -- a
     * listing is always a scan.
     *
     * A rename is detected rather than treated as a delete and an insert. A
     * rename leaves the size and the modification time untouched, so a file
     * that vanished and a same-sized, same-timed file that appeared are the
     * same file under a new name, and its pinned flag and play count come
     * with it. That is the first thing the database can do that a directory
     * listing cannot.
     */
    scan(): GameEntry[] {
        const onDisk = this.#readDirectory();

        const known = new Map<string, Row>();
        for (const row of this.#db.prepare('SELECT * FROM games').all() as unknown as Row[]) {
            known.set(row.file, row);
        }

        const insert = this.#db.prepare(
            'INSERT INTO games (file, title, size, mtime_ms, added_at) VALUES (?, ?, ?, ?, ?)',
        );
        const refresh = this.#db.prepare('UPDATE games SET size = ?, mtime_ms = ? WHERE file = ?');
        const reidentify = this.#db.prepare(
            'UPDATE games SET file = ?, title = ?, size = ?, mtime_ms = ? WHERE file = ?',
        );
        const forget = this.#db.prepare('DELETE FROM games WHERE file = ?');

        const appeared = [...onDisk.keys()].filter((file) => !known.has(file));
        const vanished = [...known.values()].filter((row) => !onDisk.has(row.file));

        this.#transaction(() => {
            const now = Date.now();

            for (const file of appeared) {
                const stat = onDisk.get(file) as DiskFile;
                const twin = vanished.findIndex(
                    (row) => row.size === stat.size && row.mtime_ms === stat.mtime,
                );
                if (twin >= 0) {
                    const [row] = vanished.splice(twin, 1);
                    reidentify.run(file, titleOf(file), stat.size, stat.mtime, row.file);
                } else {
                    insert.run(file, titleOf(file), stat.size, stat.mtime, now);
                }
            }

            for (const file of onDisk.keys()) {
                const stat = onDisk.get(file) as DiskFile;
                const row = known.get(file);
                if (row !== undefined && (row.size !== stat.size || row.mtime_ms !== stat.mtime)) {
                    refresh.run(stat.size, stat.mtime, file);
                }
            }

            for (const row of vanished) {
                forget.run(row.file);
            }
        });

        return this.#select();
    }

    /**
     * Record that a game was run.
     *
     * Silently does nothing for a path outside the library, which is not an
     * error: `--rom` can name any file on the machine, and a game that is not
     * in the library is simply not in the library.
     */
    notePlayed(path: string): void {
        const file = this.#fileOf(path);
        if (file === null) {
            return;
        }
        this.#db.prepare(
            'UPDATE games SET last_played_at = ?, play_count = play_count + 1 WHERE file = ?',
        ).run(Date.now(), file);
    }

    /** Pin a game to the top of the library, or unpin it. */
    setPinned(path: string, pinned: boolean): boolean {
        const file = this.#fileOf(path);
        if (file === null) {
            return false;
        }
        const result = this.#db.prepare('UPDATE games SET pinned = ? WHERE file = ?')
            .run(pinned ? 1 : 0, file);
        return Number(result.changes) > 0;
    }

    /**
     * Copy ROMs into the library.
     *
     * Copying, not referencing: a library that pointed at files elsewhere
     * would break the moment one of them moved, and "the library is this
     * folder" is the property the whole design is built on. A source that is
     * already inside the folder is skipped -- copying a file onto itself is
     * not what "add" means -- and a name that is taken is made unique rather
     * than overwritten, because overwriting is how a player loses a game.
     *
     * Returns the file names that were written, for the caller to report.
     */
    add(sources: readonly string[]): string[] {
        const copied: string[] = [];
        for (const source of sources) {
            if (isInside(this.root, source)) {
                continue;
            }
            const target = this.#freeName(basename(source));
            copyFileSync(source, join(this.root, target));
            copied.push(target);
        }
        return copied;
    }

    /**
     * Delete a game: the file from the folder, and the row from the model.
     *
     * There is no "remove from the library but keep the file", because the
     * folder is the library. Anything else would need a second place to hide
     * a game, and the next scan would find it again anyway.
     */
    remove(path: string): boolean {
        const file = this.#fileOf(path);
        if (file === null) {
            return false;
        }
        try {
            unlinkSync(join(this.root, file));
        } catch {
            return false;
        }
        this.#db.prepare('DELETE FROM games WHERE file = ?').run(file);
        return true;
    }

    // -- internals ----------------------------------------------------------

    /** Every .nes file in the folder, and nothing else. */
    #readDirectory(): Map<string, DiskFile> {
        const found = new Map<string, DiskFile>();

        let entries;
        try {
            entries = readdirSync(this.root, { withFileTypes: true });
        } catch {
            // A folder that cannot be read has no games in it, which is a
            // better answer than an exception on the way to the screen.
            return found;
        }

        for (const entry of entries) {
            if (!isRom(entry.name)) {
                continue;
            }
            if (!entry.isFile() && !entry.isSymbolicLink()) {
                continue;
            }
            try {
                // stat, not the directory entry: it follows a symlink and it
                // gives the size and time the reconcile needs. A file that
                // vanished between listing and stat is simply not a game any
                // more.
                const info = statSync(join(this.root, entry.name));
                if (!info.isFile()) {
                    continue;
                }
                found.set(entry.name, {
                    size: info.size,
                    // Milliseconds, floored. Sub-millisecond precision is not
                    // in the database's integer columns and is not needed to
                    // tell two edits apart.
                    mtime: Math.floor(info.mtimeMs),
                });
            } catch {
                // Gone. Ignore.
            }
        }

        return found;
    }

    /** `name.nes` if it is free, otherwise `name (2).nes`, `name (3).nes`… */
    #freeName(name: string): string {
        if (!existsSync(join(this.root, name))) {
            return name;
        }
        const stem = basename(name, extname(name));
        const extension = extname(name);
        for (let n = 2; ; n += 1) {
            const candidate = `${stem} (${n})${extension}`;
            if (!existsSync(join(this.root, candidate))) {
                return candidate;
            }
        }
    }

    /** The file name for a path, or null if the path is not in this library. */
    #fileOf(path: string): string | null {
        if (!isInside(this.root, path)) {
            return null;
        }
        const target = resolve(path);
        if (target === this.root) {
            return null;
        }
        return target.slice(this.root.length + 1);
    }

    #select(): GameEntry[] {
        const rows = this.#db.prepare(`
            SELECT file, title, size, added_at, last_played_at, play_count, pinned
            FROM games
            ORDER BY pinned DESC, last_played_at DESC, title COLLATE NOCASE ASC
        `).all() as unknown as Row[];

        return rows.map((row) => ({
            path: join(this.root, row.file),
            name: row.title,
            size: row.size,
            pinned: row.pinned === 1,
            playCount: row.play_count,
            addedAt: row.added_at,
            lastPlayedAt: row.last_played_at,
        }));
    }

    /** All of it or none of it. A reconcile that failed halfway would leave
     *  the model describing a folder that never existed. */
    #transaction(work: () => void): void {
        this.#db.exec('BEGIN');
        try {
            work();
            this.#db.exec('COMMIT');
        } catch (error) {
            this.#db.exec('ROLLBACK');
            throw error;
        }
    }
}
