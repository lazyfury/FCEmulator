// ---------------------------------------------------------------------------
// Input settings -- which keys and which pads drive which player.
//
// The console has two controller ports, and what this panel decides is how
// the two things a person can hold reach them:
//
//   the keyboard, as one player or two
//   every connected pad, as player 1, player 2, or nothing
//
// The keyboard's two-player default is a convention, not a guess the
// application can make: one hand on WASD and the other on the arrows is the
// only arrangement that lets two people share one keyboard. In one-player mode
// the same bindings are read as one person, so both clusters work -- which is
// exactly what the keyboard did before there was a second port to think about.
//
// Rebinding captures the next key the player presses. The capture is a
// window listener in the *capture* phase, which is what keeps the key from
// reaching the game: attachKeyboard listens in the bubble phase, so
// stopImmediatePropagation here means "W" does not walk Mario while it is being
// assigned.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import type { InputSettings, KeyBinding } from '../../shared/api';
import type { PadSummary } from '../gamepad';
import { activeBindings, padPort } from '../bindings';
import { HELD_KEY_COMMANDS, KEY_COMMANDS, KEY_COMMANDS_SHIFTED } from '../input';

interface InputPanelProps {
    input: InputSettings;
    /** Change the settings and remember them. */
    onInput: (next: InputSettings) => void;
    /** Every pad that is connected right now. */
    pads: PadSummary[];
    gamepadEnabled: boolean;
    gamepadNative: boolean;
}

/** Keys the application keeps for itself, whatever the player binds. */
const RESERVED = new Set<string>([
    ...Object.keys(KEY_COMMANDS),
    ...Object.keys(KEY_COMMANDS_SHIFTED),
    ...Object.keys(HELD_KEY_COMMANDS),
]);

/** How a key code reads on screen. */
function keyLabel(code: string): string {
    const special: Record<string, string> = {
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
        Space: '空格',
        Enter: '回车',
        NumpadEnter: '小键盘回车',
        Tab: 'Tab',
        ShiftLeft: '左 Shift',
        ShiftRight: '右 Shift',
        Backspace: 'Backspace',
        Escape: 'Esc',
    };
    if (special[code] !== undefined) {
        return special[code];
    }
    if (code.startsWith('Key')) {
        return code.slice(3);
    }
    if (code.startsWith('Digit')) {
        return code.slice(5);
    }
    if (code.startsWith('Numpad')) {
        return `小键盘${code.slice(6)}`;
    }
    return code;
}

/** What a switch is called on the console. */
const SWITCH_LABELS: Record<string, string> = {
    A: 'A', B: 'B', SELECT: 'Select', START: 'Start',
    UP: '上', DOWN: '下', LEFT: '左', RIGHT: '右',
};

const PORT_LABELS = ['1P', '2P', '关闭'];

function playerName(port: number): string {
    return port === 0 ? '玩家 1' : port === 1 ? '玩家 2' : '不使用';
}

/**
 * One binding row, with its own capture state.
 *
 * The capture is per row rather than one for the whole panel, because the
 * thing being edited is the row and a panel-wide "who is capturing" flag is a
 * second piece of state that can disagree with it.
 */
function BindingRow({ binding, onRebind }: {
    binding: KeyBinding;
    onRebind: (code: string) => void;
}) {
    const [capturing, setCapturing] = useState(false);

    useEffect(() => {
        if (!capturing) {
            return;
        }
        const onKey = (event: KeyboardEvent): void => {
            event.preventDefault();
            // Stop the game from seeing it. attachKeyboard is a bubble phase
            // listener, so this capture phase one runs first and can end it.
            event.stopImmediatePropagation();

            if (event.code === 'Escape') {
                setCapturing(false);
                return;
            }
            if (RESERVED.has(event.code)) {
                // Escape, P, R, Backspace and the function keys belong to the
                // application. Keep capturing rather than binding them away.
                return;
            }
            onRebind(event.code);
            setCapturing(false);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [capturing, onRebind]);

    return (
        <div className="row binding-row">
            <dt>
                <span className={`port-tag port-${binding.port}`}>{PORT_LABELS[binding.port]}</span>
                {SWITCH_LABELS[binding.button]}
            </dt>
            <dd>
                <button
                    type="button"
                    className={capturing ? 'keycap keycap-capturing' : 'keycap'}
                    onClick={() => setCapturing(true)}
                    title="点击后按下新的按键"
                >
                    {capturing ? '按下按键…' : keyLabel(binding.code)}
                </button>
            </dd>
        </div>
    );
}

/** A small segmented control: the buttons that pick one of a few values. */
function Segment<T extends string | number>({ value, options, onChange }: {
    value: T;
    options: { value: T; label: string }[];
    onChange: (next: T) => void;
}) {
    return (
        <div className="segmented" role="group">
            {options.map((option) => (
                <button
                    key={String(option.value)}
                    type="button"
                    className={option.value === value ? 'segment segment-on' : 'segment'}
                    aria-pressed={option.value === value}
                    onClick={() => onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

export default function InputPanel({
    input,
    onInput,
    pads,
    gamepadEnabled,
    gamepadNative,
}: InputPanelProps) {
    const bindings = activeBindings(input);

    /** Replace the binding list, keeping every other field. */
    const setBindings = useCallback((next: KeyBinding[]): void => {
        onInput({ ...input, bindings: next });
    }, [input, onInput]);

    /**
     * Point one binding at a new key, swapping with whoever had it.
     *
     * Swapping rather than duplicating keeps every key doing exactly one
     * thing: the resolver takes the first binding for a key and drops the
     * rest, so two bindings on one key would silently make one of them dead.
     */
    const rebind = useCallback((index: number, code: string): void => {
        const next = bindings.map((binding) => ({ ...binding }));
        const previous = next[index];
        if (previous === undefined) {
            return;
        }
        const oldCode = previous.code;
        const clash = next.findIndex((binding, position) => (
            position !== index && binding.code === code
        ));
        next[index] = { ...previous, code };
        if (clash !== -1) {
            next[clash] = { ...next[clash], code: oldCode };
        }
        setBindings(next);
    }, [bindings, setBindings]);

    /**
     * Assign a pad to a port, or to nothing.
     *
     * The array is extended with -1 rather than with defaults, because the
     * slots before this pad's index have no pad in them: an explicit "unused"
     * is the honest value for a hole.
     */
    const assignPad = useCallback((index: number, port: number): void => {
        const padPorts = [...input.padPorts];
        while (padPorts.length <= index) {
            padPorts.push(-1);
        }
        padPorts[index] = port;
        onInput({ ...input, padPorts });
    }, [input, onInput]);

    const bindingRows = bindings.map((binding, index) => (
        <BindingRow
            key={`${binding.port}-${binding.button}-${index}`}
            binding={binding}
            onRebind={(code) => rebind(index, code)}
        />
    ));

    return (
        <>
            <section className="group">
                <h3>键盘</h3>
                <div className="setting-row">
                    <span className="setting-label">模式</span>
                    <Segment
                        value={input.keyboard}
                        options={[
                            { value: '1p' as const, label: '单人' },
                            { value: '2p' as const, label: '双人' },
                        ]}
                        onChange={(keyboard) => onInput({ ...input, keyboard })}
                    />
                </div>
                {input.keyboard === '1p' ? (
                    <div className="setting-row">
                        <span className="setting-label">作为</span>
                        <Segment
                            value={input.keyboardPlayer}
                            options={[
                                { value: 0, label: '玩家 1' },
                                { value: 1, label: '玩家 2' },
                            ]}
                            onChange={(keyboardPlayer) => onInput({ ...input, keyboardPlayer })}
                        />
                    </div>
                ) : null}
                <p className="prose">
                    {input.keyboard === '1p'
                        ? '一个人用：方向键和 WASD 都是同一位玩家，两套按键都可用。'
                        : '两个人用：WASD 一侧是玩家 1，方向键一侧是玩家 2。下面可以改成任意按键。'}
                </p>
            </section>

            <section className="group">
                <h3>按键绑定</h3>
                <dl className="rows binding-list">{bindingRows}</dl>
                <div className="panel-actions">
                    <button
                        type="button"
                        className="button"
                        onClick={() => onInput({ ...input, bindings: null })}
                    >
                        <RotateCcw size={13} />
                        恢复默认
                    </button>
                </div>
                <p className="prose">
                    点击键帽，再按下新按键。Esc、P、R、Backspace 和 F1–F12
                    属于应用本身，不能改绑。
                </p>
            </section>

            <section className="group">
                <h3>手柄</h3>
                <dl className="rows">
                    <div className="row">
                        <dt>来源</dt>
                        <dd>{!gamepadEnabled
                            ? '未启用'
                            : (gamepadNative ? '原生 GameController 助手' : '浏览器 Gamepad API')}</dd>
                    </div>
                </dl>

                {pads.length === 0 ? (
                    <p className="prose">
                        {gamepadEnabled
                            ? (gamepadNative
                                ? '还没有检测到手柄。先按一下手柄上的键，确认它已配对；如果还是没有，去系统设置 → 隐私与安全性 → 输入监控，勾上本应用后重新启动。'
                                : '手柄要用过一次才会出现在浏览器里：先按一下它上面的键。如果按了还是没有，可能需要在系统设置 → 隐私与安全性 → 输入监控里允许本应用。')
                            : '没有手柄来源在运行。'}
                    </p>
                ) : (
                    <>
                        <ul className="pad-list">
                            {pads.map((pad) => (
                                <li className="pad-row" key={pad.index}>
                                    <div className="pad-name">
                                        <span className="pad-slot">#{pad.index}</span>
                                        <span className="pad-id" title={pad.id}>{pad.id}</span>
                                        {pad.mapping !== 'standard' && pad.mapping !== 'native' && (
                                            <span className="pad-warn">布局未知</span>
                                        )}
                                    </div>
                                    <Segment
                                        value={padPort(input, pad.index)}
                                        options={[
                                            { value: 0, label: '1P' },
                                            { value: 1, label: '2P' },
                                            { value: -1, label: '关闭' },
                                        ]}
                                        onChange={(port) => assignPad(pad.index, port)}
                                    />
                                </li>
                            ))}
                        </ul>
                        <div className="panel-actions">
                            <button
                                type="button"
                                className="button"
                                onClick={() => onInput({ ...input, padPorts: [] })}
                            >
                                <RotateCcw size={13} />
                                自动分配
                            </button>
                        </div>
                        <p className="prose">
                            默认第一个手柄是玩家 1，第二个是玩家 2。当前：{
                                pads.map((pad) => `#${pad.index} ${playerName(padPort(input, pad.index))}`).join('、')
                            }。
                        </p>
                    </>
                )}
            </section>
        </>
    );
}
