// ---------------------------------------------------------------------------
// How wide the middle column is, and the handle that changes it.
//
// A splitter, written out rather than taken from a library, for the same
// reason the stylesheet is written out: the interesting part is not the
// mechanics, it is the five decisions that make a drag feel right.
//
// 1. **The listeners go on the window, not on the handle.** The obvious
//    version listens for `pointermove` on the seven-pixel divider, and it
//    works until the pointer outruns it -- the moment the hand moves faster
//    than the events do, the pointer is over the panel and the drag stops
//    dead. `setPointerCapture` is the usual answer and it is a better one on
//    paper, but it is also the sort of thing that quietly does nothing in a
//    synthetic event or an unusual pointer, and a handle that only works
//    while the cursor is inside it is worse than one that always works.
//    Window listeners move with the pointer wherever it goes, they are the
//    same call in every browser, and they can be tested.
//
// 2. **The width is a number in state, not a measurement.** Reading
//    `getBoundingClientRect()` on every move would work, but it makes the
//    drag depend on layout having settled -- and layout is the thing being
//    changed. `startWidth + (now - start)` is arithmetic on two numbers that
//    were both true when the drag began, so it cannot chase its own tail.
//
// 3. **The start is captured in the closure, not in a ref.** The drag's state
//    is needed by exactly one drag, and the listeners that need it are removed
//    when it ends. A ref would outlive them and need clearing.
//
// 4. **Clamped against the window, not just against itself.** A panel that can
//    be dragged wider than the window can never be dragged back. The ceiling
//    is whatever leaves the picture a sensible amount of room, and it is
//    re-applied on window resize so that shrinking the window and growing it
//    again does not resurrect a width that no longer fits.
//
// 5. **The keyboard has to work.** A divider that can only be moved by
//    dragging is a control some people cannot use at all, so it is a
//    `role="separator"` with a tab stop, arrow keys, and Home/End.
//
// The width is remembered between runs. It is a preference about the window,
// which is the kind of thing that belongs in `localStorage` rather than in the
// library's database -- it describes this screen, not the games.
// ---------------------------------------------------------------------------

import {
    useCallback, useEffect, useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react';

/** Where the divider starts, and where a double click puts it back. */
const DEFAULT_WIDTH = 320;

/** Narrower than this and the cards stop being cards; wider and the picture
 *  has nothing left to sit in. */
const MIN_WIDTH = 240;
const MAX_WIDTH = 720;

/** One arrow key press. Small enough to be a nudge, large enough to see. */
const STEP = 16;

const STORAGE_KEY = 'fc.panelWidth';

/**
 * The widest the panel may be in this window.
 *
 * Leaves the rail and the play column their own minimums: the rail is 76px,
 * the divider 7, and the picture wants roughly 260 before it is a thumbnail.
 */
function ceiling(): number {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 350));
}

function clamp(width: number): number {
    return Math.min(Math.max(Math.round(width), MIN_WIDTH), ceiling());
}

function remember(): number {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT_WIDTH;
}

export interface PanelWidth {
    /** CSS pixels. Hand it to the stylesheet as `--panel-width`. */
    width: number;
    /** True while a drag is in progress, for the highlight. */
    dragging: boolean;
    /** Spread onto the divider element. */
    handleProps: {
        role: 'separator';
        tabIndex: number;
        'aria-orientation': 'vertical';
        'aria-label': string;
        'aria-valuenow': number;
        'aria-valuemin': number;
        'aria-valuemax': number;
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
        onDoubleClick: () => void;
    };
}

export function usePanelWidth(): PanelWidth {
    const [width, setWidth] = useState<number>(remember);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        window.localStorage.setItem(STORAGE_KEY, String(width));
    }, [width]);

    // Shrinking the window must not leave the panel wider than the ceiling:
    // flexbox would shrink it on screen while the number stayed behind, so the
    // handle and the column would disagree about where the edge is.
    useEffect(() => {
        const settle = (): void => setWidth((current) => clamp(current));
        window.addEventListener('resize', settle);
        return () => window.removeEventListener('resize', settle);
    }, []);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) {
            return;
        }
        // Stop the pointer from selecting text, and from starting a drag of
        // the window itself, while the divider is being moved.
        event.preventDefault();

        const startX = event.clientX;
        const startWidth = width;

        const move = (moved: PointerEvent): void => {
            setWidth(clamp(startWidth + (moved.clientX - startX)));
        };

        const stop = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            // A drag that is interrupted by the window losing focus never gets
            // its pointerup, and a divider stuck to the cursor is a bug people
            // remember.
            window.removeEventListener('blur', stop);
            setDragging(false);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
        window.addEventListener('blur', stop);
        setDragging(true);
    }, [width]);

    const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const step = event.key === 'ArrowLeft' ? -STEP : event.key === 'ArrowRight' ? STEP : 0;
        if (step !== 0) {
            event.preventDefault();
            setWidth((current) => clamp(current + step));
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setWidth(MIN_WIDTH);
        } else if (event.key === 'End') {
            event.preventDefault();
            setWidth(ceiling());
        }
    }, []);

    const onDoubleClick = useCallback((): void => setWidth(DEFAULT_WIDTH), []);

    return {
        width,
        dragging,
        handleProps: {
            role: 'separator',
            tabIndex: 0,
            'aria-orientation': 'vertical',
            'aria-label': '调整中间栏宽度',
            'aria-valuenow': width,
            'aria-valuemin': MIN_WIDTH,
            // A static ceiling for the screen reader; the real one depends on
            // the window and is applied as the drag happens.
            'aria-valuemax': MAX_WIDTH,
            onPointerDown,
            onKeyDown,
            onDoubleClick,
        },
    };
}
