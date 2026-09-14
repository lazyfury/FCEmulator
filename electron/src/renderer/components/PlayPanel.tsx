// ---------------------------------------------------------------------------
// The play area -- the right column, and the only column that never changes.
//
// The canvas is mounted for the lifetime of the page. That is not a detail:
// the emulator binds to it once, when the module is built, and a canvas that
// unmounted while somebody browsed the library would mean rebuilding the
// WebAssembly module -- and powering the console off -- every time they looked
// at the list. So the middle column swaps and this one does not.
//
// Around it, the things a console has that a canvas does not: a title, the
// machine's own lights, and a row of physical controls. The controls are the
// keyboard's commands with a mouse in front of them; see useEmulator.command.
// ---------------------------------------------------------------------------

import {
    Download, Eject, Library, Pause, Play, RotateCcw, Upload,
} from 'lucide-react';
import type { RefObject } from 'react';

import type { CommandName } from '../input';
import type { EngineStatus } from '../useEmulator';
import type { PixelScale } from '../usePixelScale';
import { gameTitle } from '../format';

interface PlayPanelProps {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    stageRef: RefObject<HTMLDivElement | null>;
    picture: PixelScale;
    status: EngineStatus;
    scanlines: boolean;
    onCommand: (command: CommandName) => void;
    onEject: () => void;
    onGoToLibrary: () => void;
}

export default function PlayPanel({
    canvasRef,
    stageRef,
    picture,
    status,
    scanlines,
    onCommand,
    onEject,
    onGoToLibrary,
}: PlayPanelProps) {
    const loaded = status.romPath !== null;
    const title = loaded ? gameTitle(status.romPath as string) : '未插入卡带';
    const box = { width: `${picture.width}px`, height: `${picture.height}px` };

    return (
        <section className="play" aria-label="游戏画面">
            <header className="play-head">
                <div className="play-titles">
                    <span className="play-name">{title}</span>
                    {loaded && status.romSummary !== '' && (
                        <span className="play-summary">{status.romSummary}</span>
                    )}
                </div>
                <div className="play-badges">
                    {status.rewinding && <span className="badge badge-rewind">◀◀ 倒带</span>}
                    {status.paused && <span className="badge badge-warn">暂停</span>}
                    {loaded && <span className="badge">{picture.scale.toFixed(2)}×</span>}
                    {loaded && <span className="badge">{status.fps.toFixed(1)} fps</span>}
                </div>
            </header>

            {/* The well carries the padding; `.stage` is the measured box and
                has none, because usePixelScale sizes the picture to whatever
                it is handed. */}
            <div className="stage-well">
                <div className="stage" ref={stageRef}>
                    <div className="screen-wrap" style={box}>
                        <canvas
                            ref={canvasRef}
                            width={256}
                            height={240}
                            className="screen"
                            style={box}
                        />

                        {scanlines && <div className="scanlines" aria-hidden="true" />}

                        {status.paused && <div className="paused">PAUSED</div>}

                        {!loaded && (
                            <div className="stage-empty">
                                <p className="stage-empty-title">插入卡带</p>
                                <p className="stage-empty-hint">
                                    从左边选一个游戏，或把 <code>.nes</code> 放进游戏文件夹。
                                </p>
                                <button type="button" className="button" onClick={onGoToLibrary}>
                                    <Library size={13} />
                                    去游戏库
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <footer className="transport">
                <button
                    type="button"
                    className="button"
                    onClick={() => onCommand('pause')}
                    disabled={!loaded}
                    title="Esc"
                >
                    {status.paused ? <Play size={13} /> : <Pause size={13} />}
                    {status.paused ? '继续' : '暂停'}
                </button>
                <button
                    type="button"
                    className="button"
                    onClick={() => onCommand('reset')}
                    disabled={!loaded}
                    title="R"
                >
                    <RotateCcw size={13} />
                    重置
                </button>
                <button
                    type="button"
                    className="button"
                    onClick={() => onCommand('quicksave')}
                    disabled={!loaded}
                    title="F5"
                >
                    <Download size={13} />
                    存档
                </button>
                <button
                    type="button"
                    className="button"
                    onClick={() => onCommand('quickload')}
                    disabled={!loaded}
                    title="F6"
                >
                    <Upload size={13} />
                    读档
                </button>
                <span className="transport-spacer" />
                <button
                    type="button"
                    className="button"
                    onClick={onEject}
                    disabled={!loaded}
                    title="弹出卡带"
                >
                    <Eject size={13} />
                    弹出
                </button>
            </footer>
        </section>
    );
}
