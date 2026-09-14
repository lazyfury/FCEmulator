// ---------------------------------------------------------------------------
// Settings -- the middle column, in the 设置 section.
//
// There are no preferences to edit, and pretending otherwise would be a lie:
// the NES has no settings, and every number below is a reading from the
// machine rather than a knob. What the panel is for is the two things a
// player can actually change -- how the picture is filtered and whether it is
// drawn at all -- plus a straight answer to "is it running right".
//
// So it is a report, laid out the way a macOS inspector lays one out: grouped
// rows, the label on the left and the value on the right in tabular figures,
// so the eye can compare a column of numbers down the page.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { FolderCog } from 'lucide-react';

import type { Library } from '../../shared/api';
import type { EngineStatus } from '../useEmulator';
import type { PixelScale } from '../usePixelScale';
import { formatCycles, formatHex16 } from '../format';

interface SettingsPanelProps {
    status: EngineStatus;
    picture: PixelScale;
    scanlines: boolean;
    onScanlines: (on: boolean) => void;
    gamepadEnabled: boolean;
    /** The library, for the folder and the row count. Null until the first
     *  read comes back. */
    library: Library | null;
    onChooseDirectory: () => void;
}

/** The audio numbers, in the order a person checks them. */
function audioRows(status: EngineStatus): [string, string][] {
    if (status.audioError !== null) {
        return [['状态', '不可用'], ['原因', status.audioError]];
    }
    if (status.audio === null) {
        return [['状态', '尚未建立']];
    }
    const { state, fill, targetFill, underruns, dropped } = status.audio;
    return [
        ['状态', state],
        ['缓冲', `${fill} / ${targetFill}`],
        ['欠载', String(underruns)],
        ['丢弃', String(dropped)],
    ];
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="group">
            <h3>{title}</h3>
            {children}
        </section>
    );
}

function Rows({ rows }: { rows: [string, string][] }) {
    return (
        <dl className="rows">
            {rows.map(([label, value]) => (
                <div className="row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

export default function SettingsPanel({
    status,
    picture,
    scanlines,
    onScanlines,
    gamepadEnabled,
    library,
    onChooseDirectory,
}: SettingsPanelProps) {
    const pinned = library?.games.filter((game) => game.pinned).length ?? 0;

    return (
        <section className="panel" aria-label="设置">
            <header className="panel-head">
                <div className="panel-title">
                    <h2>设置</h2>
                    <span className="panel-count">只读 · 除画面滤镜与游戏库外</span>
                </div>
            </header>

            <div className="panel-scroll">
                <Group title="游戏库">
                    <Rows
                        rows={[
                            ['目录', library?.directory ?? '—'],
                            ['数据库', library === null ? '—' : 'library.sqlite'],
                            ['游戏', library === null ? '—' : `${library.games.length} 个`],
                            ['置顶', library === null ? '—' : `${pinned} 个`],
                        ]}
                    />
                    <div className="panel-actions">
                        <button type="button" className="button" onClick={onChooseDirectory}>
                            <FolderCog size={13} />
                            选择游戏库文件夹
                        </button>
                    </div>
                    <p className="prose">
                        游戏库是一个文件夹：ROM、它们的元数据（<code>library.sqlite</code>）
                        都在里面。换一个文件夹就是换一个游戏库。
                    </p>
                </Group>

                <Group title="显示">
                    <dl className="rows">
                        <div className="row">
                            <dt>画面</dt>
                            <dd>256 × 240</dd>
                        </div>
                        <div className="row">
                            <dt>缩放</dt>
                            <dd>{picture.scale.toFixed(2)} ×</dd>
                        </div>
                    </dl>
                    <div className="switch-row">
                        <Switch.Root
                            id="fc-scanlines"
                            className="switch-root"
                            checked={scanlines}
                            onCheckedChange={onScanlines}
                        >
                            <Switch.Thumb className="switch-thumb" />
                        </Switch.Root>
                        <label className="switch-label" htmlFor="fc-scanlines">
                            扫描线
                        </label>
                    </div>
                </Group>

                <Group title="音频">
                    <Rows rows={audioRows(status)} />
                </Group>

                <Group title="运行">
                    <Rows
                        rows={[
                            ['帧率', `${status.fps.toFixed(1)} fps`],
                            ['帧数', status.frameCount.toLocaleString('en-US')],
                            ['周期', formatCycles(status.totalCycles)],
                            ['PC', formatHex16(status.cpuPc)],
                            ['卡带', status.romSummary === '' ? '—' : status.romSummary],
                        ]}
                    />
                </Group>

                <Group title="输入">
                    <Rows
                        rows={[
                            ['方向', '方向键 / WASD'],
                            ['A', 'X / K'],
                            ['B', 'Z / J'],
                            ['Start', 'Enter / Space'],
                            ['Select', 'Tab / 右 Shift'],
                            ['暂停', 'Esc / P'],
                            ['重置', 'R'],
                            ['倒带', '按住 Backspace'],
                            ['手柄', gamepadEnabled ? '已启用' : '未启用（--gamepad）'],
                        ]}
                    />
                </Group>
            </div>
        </section>
    );
}
