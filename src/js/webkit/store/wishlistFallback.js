/**
 * Wishlist fallback
 *
 * Steam re-hashes the class names of the store from time to time, which silently
 * un-themes pages that are styled by those classes (the wishlist is one of them).
 * This script does not use class names. On /wishlist pages it looks at the computed
 * colors, and every element that still has Steam's default blue palette gets a
 * data-st-wl attribute. wishlistFallback.css turns that attribute into SpaceTheme colors.
 *
 * Elements that are already themed (no blue) are never touched, so once the class
 * based CSS works again this script simply finds nothing to do.
 *
 * To fix the class names for good: open the wishlist, inspect a card in DevTools
 * and replace the old classes in wishlist.css.
 */

const ROUTE = '/wishlist';
const ATTR = 'data-st-wl';
const BUDGET_MS = 8;

const onWishlist = () => location.pathname.startsWith(ROUTE);

/* ------------------------------------------------------------------ color */

const toHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
};

const COLOR = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/g;

/** Average color of a computed background (plain color or gradient). */
const backgroundOf = (cs) => {
    const image = cs.backgroundImage;
    if (image && image !== 'none') {
        if (image.includes('url(')) return null; // real artwork, leave alone
        const stops = [...image.matchAll(COLOR)]
            .map(m => [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1)])
            .filter(c => c[3] > 0.5);
        if (stops.length) {
            const avg = i => stops.reduce((sum, c) => sum + c[i], 0) / stops.length;
            return toHsl(avg(0), avg(1), avg(2));
        }
    }
    const m = [...cs.backgroundColor.matchAll(COLOR)][0];
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1);
    if (alpha < 0.5) return null;
    return toHsl(+m[1], +m[2], +m[3]);
};

/**
 * Measured on Steam's default wishlist:
 *   card 27,49,71  rank column 33,51,74  navbar 24,37,53   -> surface
 *   search 52,64,77  Options/Sort/Share 61,68,80           -> control
 *   tag chips 56,80,107 / 48,73,102                        -> chip
 *   Early Access 16,46,69                                  -> badge
 *   Add to Cart 114,173,33   Add to Library 58,156,238     -> green / blue
 *   Remove 71,41,46                                        -> red
 */
const classify = ({ h, s, l }) => {
    const blueFamily = h >= 195 && h <= 235;

    if (h >= 75 && h <= 150 && s >= 0.35 && l >= 0.25 && l <= 0.7) return 'green';
    if ((h >= 335 || h <= 15) && s >= 0.15 && l >= 0.1 && l <= 0.4) return 'red';
    if (!blueFamily) return null;

    if (s >= 0.6 && l >= 0.4) return 'blue';
    if (s >= 0.5 && l < 0.3) return 'badge';
    if (s >= 0.08 && s < 0.28 && l >= 0.2 && l <= 0.4) return 'control';
    if (s >= 0.28 && l >= 0.26 && l <= 0.42) return 'chip';
    if (s >= 0.28 && l >= 0.08 && l < 0.26) return 'surface';
    return null;
};

/* ---------------------------------------------------------------- tagging */

const SKIP = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'IMG', 'SVG', 'PATH', 'VIDEO', 'CANVAS']);
const seen = new WeakSet();

const tag = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (SKIP.has(el.tagName.toUpperCase()) || el.hasAttribute(ATTR)) return;

    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;

    const bg = backgroundOf(cs);
    if (!bg) return;

    const kind = classify(bg);
    if (kind) el.setAttribute(ATTR, kind);
};

/* ------------------------------------------------------------------ queue */

const idle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 300 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => BUDGET_MS }), 16);

const queue = new Set();
let scheduled = false;

const work = (deadline) => {
    scheduled = false;
    const start = performance.now();
    for (const el of queue) {
        if (deadline.timeRemaining() < 1 && performance.now() - start > BUDGET_MS) break;
        queue.delete(el);
        tag(el);
    }
    if (queue.size) schedule();
};

const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    idle(work);
};

const enqueue = (node) => {
    if (node.nodeType !== 1) return;
    queue.add(node);
    for (const el of node.querySelectorAll('*')) queue.add(el);
    schedule();
};

/* ------------------------------------------------------------------- main */

const sync = () => {
    const root = document.documentElement;
    if (onWishlist()) root.setAttribute('data-st-wishlist', '');
    else root.removeAttribute('data-st-wishlist');
    return onWishlist();
};

const start = () => {
    if (!document.body) return;

    if (sync()) enqueue(document.body);

    new MutationObserver((mutations) => {
        if (!sync()) return;
        for (const m of mutations) {
            if (m.type === 'childList') m.addedNodes.forEach(enqueue);
            else if (m.type === 'attributes' && !m.target.hasAttribute(ATTR)) {
                seen.delete(m.target);
                queue.add(m.target);
                schedule();
            }
        }
    }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
    });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

// SPA navigation inside the store
window.addEventListener('popstate', () => { if (sync()) enqueue(document.body); });
