// ---------------------------------------------------------------------------
// The status bar.
//
// Every number here is a reading, not a setting. It exists because this is an
// emulator and not a game console: when a game runs slowly, or silently, or
// with the d-pad stuck down, the status bar is where that becomes visible --
// and "audio 0.000" beside "60.1 fps" is a sentence somebody can act on.
//
// The right hand group is monospaced and tabular so the numbers do not jitter
// left and right as they change, which at four updates a second is the
// difference between a readout and a flicker.
// ---------------------------------------------------------------------------

import type { EngineStatus } from '../useEmulator';
import { formatCycles, formatHex16 } from '../format';

function describeAudio(status: EngineStatus): string {
    if (status.audioError !== null) {
        return '音频关闭';
    }
    if (status.audio === null) {
        return '音频 —';
    }
    const { state, fill, targetFill, underruns, dropped } = status.audio;
    return `${state} ${fill}/${targetFill} u${underruns} d${dropped}`;
}

function audioTrouble(status: EngineStatus): boolean {
    if (status.audioError !== null) {
        return true;
    }
    return status.audio !== null && (status.audio.underruns > 0 || status.audio.dropped > 0);
}

interface StatusBarProps {
    status: EngineStatus;
}

export default function StatusBar({ status }: StatusBarProps) {
    return (
        <footer className="statusbar">
            {status.message !== null && <span className="status-message">{status.message}</span>}

            {status.error !== null && <span className="status-error">{status.error}</span>}

            {status.state === 'loading' && <span className="status-dim">正在载入核心…</span>}
            {status.state === 'halted' && <span className="status-error">CPU 已停机</span>}

            {status.state === 'running' && status.romPath === null && (
                <span className="status-dim">未插入卡带 · 从游戏库选择一个</span>
            )}

            <span className="status-spacer" />

            {status.state === 'running' && status.romPath !== null && (
                <>
                    <span className="status-num">
                        {status.held.length > 0 ? status.held.join(' ') : '—'}
                    </span>
                    {status.rewind !== null && (
                        <span className={status.rewinding ? 'status-rewind' : 'status-num'}>
                            {status.rewinding ? '◀◀ ' : ''}
                            {status.rewind.seconds.toFixed(1)}s
                        </span>
                    )}
                    <span className="status-num">{status.fps.toFixed(1)} fps</span>
                    <span className="status-num">帧 {status.frameCount}</span>
                    <span className="status-num">{formatCycles(status.totalCycles)} cyc</span>
                    <span className="status-num">PC {formatHex16(status.cpuPc)}</span>
                    <span className={status.audioPeak > 0.01 ? 'status-live' : 'status-num'}>
                        ♪ {status.audioPeak.toFixed(3)}
                    </span>
                    <span
                        className={audioTrouble(status) ? 'status-error' : 'status-num'}
                        title={status.audioError ?? undefined}
                    >
                        {describeAudio(status)}
                    </span>
                </>
            )}
        </footer>
    );
}
