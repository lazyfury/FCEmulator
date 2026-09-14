// ---------------------------------------------------------------------------
// The four things the left rail can be showing.
//
// One place, so the rail, the window title and the middle column cannot
// disagree about what the middle column is. The icon lives here too, and not
// in the component, because a section without an icon is a section nobody
// built yet rather than a layout decision.
// ---------------------------------------------------------------------------

import { Camera, History, Info, Library, Pin, Save, Settings2, type LucideIcon } from 'lucide-react';

export type SectionId =
    | 'library' | 'pinned' | 'recent' | 'screenshots' | 'saves' | 'settings' | 'about';

export interface Section {
    id: SectionId;
    /** What the rail says. */
    label: string;
    /** What the window title bar says, for the benefit of the screenshot in a
     *  bug report. */
    title: string;
    icon: LucideIcon;
}

export const SECTIONS: readonly Section[] = [
    { id: 'library', label: '游戏库', title: '游戏库', icon: Library },
    { id: 'pinned', label: '置顶', title: '置顶游戏', icon: Pin },
    { id: 'recent', label: '最近', title: '最近游玩', icon: History },
    { id: 'screenshots', label: '截图', title: '截图收藏', icon: Camera },
    { id: 'saves', label: '存档', title: '存档', icon: Save },
    { id: 'settings', label: '设置', title: '设置', icon: Settings2 },
    { id: 'about', label: '关于', title: '关于', icon: Info },
];

export const SECTION_BY_ID: Readonly<Record<SectionId, Section>> = Object.freeze(
    Object.fromEntries(SECTIONS.map((section) => [section.id, section])) as Record<SectionId, Section>,
);
