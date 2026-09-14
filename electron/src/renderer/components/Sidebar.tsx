// ---------------------------------------------------------------------------
// The function area -- the left rail.
//
// Modelled on the VS Code activity bar, with the one difference the design
// asked for: each item is an icon *with its name under it*, stacked
// vertically, rather than an icon that needs a tooltip to be understood.
// Chinese labels are short enough that they fit in a 76px rail, and a name
// that is always visible is one fewer thing to hover over.
//
// It is a real <nav> with real buttons because that is what it is: the only
// way to change what the middle column shows. The selection is carried by
// `aria-current` as well as by colour, so the accent fill is decoration and
// not the message.
// ---------------------------------------------------------------------------

import { Gamepad2, Volume2, VolumeX } from 'lucide-react';

import { SECTIONS, type SectionId } from '../sections';

interface SidebarProps {
    active: SectionId;
    onSelect: (id: SectionId) => void;
    /** False when audio could not be started; the game still runs silently. */
    audioOk: boolean;
    /** Only shown when the application was started with --gamepad. */
    gamepadEnabled: boolean;
}

export default function Sidebar({ active, onSelect, audioOk, gamepadEnabled }: SidebarProps) {
    return (
        <nav className="sidebar" aria-label="功能区">
            <div className="rail">
                {SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const selected = section.id === active;
                    return (
                        <button
                            key={section.id}
                            type="button"
                            className={selected ? 'rail-item rail-item-active' : 'rail-item'}
                            aria-current={selected ? 'page' : undefined}
                            onClick={() => onSelect(section.id)}
                            title={section.title}
                        >
                            <Icon className="rail-icon" size={20} strokeWidth={1.6} aria-hidden="true" />
                            <span className="rail-label">{section.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* What the machine is wired up to, at the bottom, where a status
                light belongs. Decoration, so it is hidden from the tree. */}
            <div className="rail-foot" aria-hidden="true">
                <span className={audioOk ? 'rail-dot rail-dot-on' : 'rail-dot'} title={audioOk ? '音频已连接' : '音频不可用'}>
                    {audioOk ? <Volume2 size={13} /> : <VolumeX size={13} />}
                </span>
                {gamepadEnabled && (
                    <span className="rail-dot rail-dot-on" title="手柄受支持">
                        <Gamepad2 size={13} />
                    </span>
                )}
            </div>
        </nav>
    );
}
