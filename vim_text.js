// vim_text.js
//
// Pure text logic for Anki Vim Mode: motions, text objects and search on a
// plain string + cursor offset. No DOM access, so it runs (and is tested)
// under plain node as well as inside Anki's editor webview.
//
// The editor layer (editor_vim.js) turns a field into a string where every
// line break is "\n" and every non-text object (image, MathJax, ...) is a
// single ATOM character, then asks this module where the cursor should go.

(function (root) {
    "use strict";

    const ATOM = "￼";

    function isBlankChar(ch) {
        return ch === " " || ch === "\t" || ch === " " || ch === "\n";
    }

    // 0 = whitespace, 1 = word character, 2 = punctuation.
    // With big=true every non-blank is class 1 (vim's WORD).
    function cls(text, i, big) {
        const ch = text[i];

        if (ch === undefined || isBlankChar(ch)) {
            return 0;
        }

        if (big) {
            return 1;
        }

        return /[\p{L}\p{N}\p{M}_]/u.test(ch) ? 1 : 2;
    }

    function clamp(value, lo, hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    // ---- lines -----------------------------------------------------------

    function lineStart(text, pos) {
        // lastIndexOf treats a negative start as 0, so without this check a
        // line break at index 0 would be found and the first line would
        // seem to start at 1.
        if (pos <= 0) {
            return 0;
        }

        return text.lastIndexOf("\n", pos - 1) + 1;
    }

    // Index of the "\n" ending the line (or text.length on the last line).
    function lineEnd(text, pos) {
        const idx = text.indexOf("\n", pos);
        return idx === -1 ? text.length : idx;
    }

    // Last character of the line, which is as far right as a normal-mode
    // cursor may sit. On an empty line this is the line start.
    function lineLast(text, pos) {
        const s = lineStart(text, pos);
        const e = lineEnd(text, pos);
        return e > s ? e - 1 : s;
    }

    function clampNormal(text, pos) {
        pos = clamp(pos, 0, text.length);
        return Math.min(pos, lineLast(text, pos));
    }

    function lineIndex(text, pos) {
        let count = 0;
        let idx = text.indexOf("\n");

        while (idx !== -1 && idx < pos) {
            count++;
            idx = text.indexOf("\n", idx + 1);
        }

        return count;
    }

    function lineCount(text) {
        return lineIndex(text, text.length + 1) + 1;
    }

    function lineStartOf(text, index) {
        let start = 0;

        for (let i = 0; i < index; i++) {
            const idx = text.indexOf("\n", start);

            if (idx === -1) {
                return start;
            }

            start = idx + 1;
        }

        return start;
    }

    function firstNonBlank(text, pos) {
        const s = lineStart(text, pos);
        const e = lineEnd(text, pos);
        let i = s;

        while (i < e && isBlankChar(text[i])) {
            i++;
        }

        return i < e ? i : lineLast(text, pos);
    }

    function isEmptyLine(text, i) {
        return text[i] === "\n" && (i === 0 || text[i - 1] === "\n");
    }

    // Move `delta` lines keeping `col` (Infinity = stick to end of line).
    function moveLines(text, pos, delta, col) {
        const total = lineCount(text);
        const target = clamp(lineIndex(text, pos) + delta, 0, total - 1);
        const s = lineStartOf(text, target);
        const e = lineEnd(text, s);

        return Math.min(s + col, e > s ? e - 1 : s);
    }

    // ---- word motions ----------------------------------------------------

    function wordForward(text, pos, big) {
        const n = text.length;
        let i = pos;

        if (i >= n) {
            return n;
        }

        const c = cls(text, i, big);

        if (c !== 0) {
            while (i < n && cls(text, i, big) === c) {
                i++;
            }
        }

        while (i < n && cls(text, i, big) === 0) {
            // An empty line counts as a word.
            if (i > pos && isEmptyLine(text, i)) {
                break;
            }

            i++;
        }

        return i;
    }

    function wordEnd(text, pos, big) {
        const n = text.length;
        let i = pos + 1;

        while (i < n && cls(text, i, big) === 0) {
            i++;
        }

        if (i >= n) {
            return Math.max(0, n - 1);
        }

        const c = cls(text, i, big);

        while (i + 1 < n && cls(text, i + 1, big) === c) {
            i++;
        }

        return i;
    }

    function wordBack(text, pos, big) {
        let i = pos - 1;

        while (i > 0 && cls(text, i, big) === 0) {
            if (isEmptyLine(text, i)) {
                return i;
            }

            i--;
        }

        if (i <= 0) {
            return 0;
        }

        const c = cls(text, i, big);

        while (i > 0 && cls(text, i - 1, big) === c) {
            i--;
        }

        return i;
    }

    // ge / gE: end of the previous word.
    function wordEndBack(text, pos, big) {
        let i = pos;
        const c = cls(text, i, big);

        if (c !== 0) {
            while (i >= 0 && cls(text, i, big) === c) {
                i--;
            }
        }

        while (i >= 0 && cls(text, i, big) === 0) {
            if (i < pos && isEmptyLine(text, i)) {
                break;
            }

            i--;
        }

        return Math.max(0, i);
    }

    // ---- f / t -----------------------------------------------------------

    // type is one of f F t T. Returns the new position or -1.
    // `repeat` is true for ; and , so that t/T skip an adjacent match.
    function findChar(text, pos, ch, type, count, repeat) {
        const s = lineStart(text, pos);
        const e = lineEnd(text, pos);
        const forward = type === "f" || type === "t";
        const till = type === "t" || type === "T";
        let i = pos;

        if (repeat && till) {
            i += forward ? 1 : -1;
        }

        for (let n = 0; n < count; n++) {
            if (forward) {
                i = text.indexOf(ch, i + 1);

                if (i === -1 || i >= e) {
                    return -1;
                }
            } else {
                i = i - 1 < s ? -1 : text.lastIndexOf(ch, i - 1);

                if (i === -1 || i < s) {
                    return -1;
                }
            }
        }

        if (till) {
            i += forward ? -1 : 1;
        }

        return i;
    }

    // ---- % ---------------------------------------------------------------

    const PAIRS = { "(": ")", "[": "]", "{": "}", "<": ">" };
    const CLOSERS = { ")": "(", "]": "[", "}": "{", ">": "<" };

    function matchPair(text, pos) {
        const e = lineEnd(text, pos);
        let i = pos;

        while (i < e && !"()[]{}".includes(text[i])) {
            i++;
        }

        if (i >= e) {
            return -1;
        }

        const ch = text[i];
        let depth = 0;

        if (PAIRS[ch]) {
            const close = PAIRS[ch];

            for (let j = i; j < text.length; j++) {
                if (text[j] === ch) {
                    depth++;
                } else if (text[j] === close) {
                    depth--;

                    if (depth === 0) {
                        return j;
                    }
                }
            }
        } else {
            const open = CLOSERS[ch];

            for (let j = i; j >= 0; j--) {
                if (text[j] === ch) {
                    depth++;
                } else if (text[j] === open) {
                    depth--;

                    if (depth === 0) {
                        return j;
                    }
                }
            }
        }

        return -1;
    }

    // ---- { } -------------------------------------------------------------

    // Returns text.length when there is no further blank line.
    function paragraphForward(text, pos) {
        const n = text.length;
        const blank = (s) => lineEnd(text, s) === s;
        const next = (s) => {
            const e = lineEnd(text, s);
            return e >= n ? -1 : e + 1;
        };
        let s = lineStart(text, pos);

        while (s !== -1 && blank(s)) {
            s = next(s);
        }

        while (s !== -1 && !blank(s)) {
            s = next(s);
        }

        return s === -1 ? n : s;
    }

    function paragraphBack(text, pos) {
        const blank = (s) => lineEnd(text, s) === s;
        const prev = (s) => (s === 0 ? -1 : lineStart(text, s - 1));
        let s = lineStart(text, pos);

        while (s !== -1 && blank(s)) {
            s = prev(s);
        }

        while (s !== -1 && !blank(s)) {
            s = prev(s);
        }

        return s === -1 ? 0 : s;
    }

    // ---- ( ) sentences ---------------------------------------------------

    // Offsets where a sentence starts: after ". ", "! ", "? " (optionally
    // followed by closing quotes/brackets), and at the start of a paragraph.
    function sentenceStarts(text) {
        const starts = [];
        const n = text.length;
        const push = (j) => {
            if (j < n && starts[starts.length - 1] !== j) {
                starts.push(j);
            }
        };
        // Skip blanks, but stop on an empty line: it is a stop of its own.
        const skip = (j) => {
            while (j < n && isBlankChar(text[j]) && !isEmptyLine(text, j)) {
                j++;
            }

            return j;
        };

        let i = skip(0);

        push(i);

        while (i < n) {
            const ch = text[i];

            if (isEmptyLine(text, i)) {
                push(i);

                let j = i;

                while (j < n && isBlankChar(text[j])) {
                    j++;
                }

                push(j);
                i = j;
                continue;
            }

            if (ch === "." || ch === "!" || ch === "?") {
                let j = i + 1;

                while (j < n && ")]\"'".includes(text[j])) {
                    j++;
                }

                if (j < n && isBlankChar(text[j])) {
                    j = skip(j);
                    push(j);
                    i = j;
                    continue;
                }
            }

            i++;
        }

        return starts;
    }

    function sentenceForward(text, pos) {
        const next = sentenceStarts(text).find((s) => s > pos);
        return next === undefined ? text.length : next;
    }

    function sentenceBack(text, pos) {
        const prev = sentenceStarts(text)
            .reverse()
            .find((s) => s < pos);
        return prev === undefined ? 0 : prev;
    }

    function sentenceObject(text, pos, around) {
        const starts = sentenceStarts(text);
        let start = 0;
        let end = text.length;

        for (let k = 0; k < starts.length; k++) {
            if (starts[k] <= pos) {
                start = starts[k];
                end = k + 1 < starts.length ? starts[k + 1] : text.length;
            }
        }

        if (!around) {
            while (end > start && isBlankChar(text[end - 1])) {
                end--;
            }
        } else {
            // Never swallow the line break that ends the paragraph.
            while (end > start && text[end - 1] === "\n") {
                end--;
            }
        }

        return { start, end };
    }

    // First number at or after pos on the line: { start, end } or null.
    function numberAt(text, pos) {
        const s = lineStart(text, pos);
        const e = lineEnd(text, pos);
        const regex = /-?\d+/g;
        const line = text.slice(s, e);
        let m;

        while ((m = regex.exec(line)) !== null) {
            if (s + m.index + m[0].length > pos) {
                return { start: s + m.index, end: s + m.index + m[0].length };
            }
        }

        return null;
    }

    // ---- text objects ----------------------------------------------------
    // All return { start, end } with an exclusive end, or null.

    function wordObject(text, pos, around, big) {
        const s = lineStart(text, pos);
        const e = lineEnd(text, pos);

        if (s === e) {
            return { start: pos, end: pos };
        }

        pos = clamp(pos, s, e - 1);

        const c = cls(text, pos, big);
        let a = pos;
        let b = pos + 1;

        while (a > s && cls(text, a - 1, big) === c) {
            a--;
        }

        while (b < e && cls(text, b, big) === c) {
            b++;
        }

        if (around) {
            if (c !== 0) {
                let b2 = b;

                while (b2 < e && cls(text, b2, big) === 0) {
                    b2++;
                }

                if (b2 > b) {
                    b = b2;
                } else {
                    while (a > s && cls(text, a - 1, big) === 0) {
                        a--;
                    }
                }
            } else if (b < e) {
                const c2 = cls(text, b, big);

                while (b < e && cls(text, b, big) === c2) {
                    b++;
                }
            }
        }

        return { start: a, end: b };
    }

    function quoteObject(text, pos, quote, around) {
        const s = lineStart(text, pos);
        const e = lineEnd(text, pos);
        const marks = [];

        for (let i = s; i < e; i++) {
            if (text[i] === quote && (i === s || text[i - 1] !== "\\")) {
                marks.push(i);
            }
        }

        for (let k = 0; k + 1 < marks.length; k += 2) {
            const open = marks[k];
            const close = marks[k + 1];

            if (pos <= close) {
                if (!around) {
                    return { start: open + 1, end: close };
                }

                let a = open;
                let b = close + 1;
                let b2 = b;

                while (b2 < e && isBlankChar(text[b2])) {
                    b2++;
                }

                if (b2 > b) {
                    b = b2;
                } else {
                    while (a > s && isBlankChar(text[a - 1])) {
                        a--;
                    }
                }

                return { start: a, end: b };
            }
        }

        return null;
    }

    function enclosingPair(text, pos, open, close) {
        let depth = 0;
        let o = -1;

        for (let i = pos; i >= 0; i--) {
            const ch = text[i];

            if (ch === close && i !== pos) {
                depth++;
            } else if (ch === open) {
                if (depth === 0) {
                    o = i;
                    break;
                }

                depth--;
            }
        }

        if (o === -1) {
            return null;
        }

        depth = 0;

        for (let i = o + 1; i < text.length; i++) {
            const ch = text[i];

            if (ch === open) {
                depth++;
            } else if (ch === close) {
                if (depth === 0) {
                    return { open: o, close: i };
                }

                depth--;
            }
        }

        return null;
    }

    function pairObject(text, pos, open, close, around) {
        let pair = enclosingPair(text, pos, open, close);

        if (!pair) {
            // Like vim, fall forward to the next pair on the line.
            const e = lineEnd(text, pos);
            const next = text.indexOf(open, pos);

            if (next !== -1 && next < e) {
                pair = enclosingPair(text, next, open, close);
            }
        }

        if (!pair) {
            return null;
        }

        return around
            ? { start: pair.open, end: pair.close + 1 }
            : { start: pair.open + 1, end: pair.close };
    }

    // Anki cloze deletion: {{c1::answer::hint}}.
    // inner = the answer text, around = the whole {{...}}.
    function clozeObject(text, pos, around) {
        let open = -1;

        for (let i = Math.min(pos, text.length - 2); i >= 0; i--) {
            if (text.startsWith("}}", i) && i + 1 < pos) {
                break;
            }

            if (text.startsWith("{{c", i)) {
                open = i;
                break;
            }
        }

        if (open === -1) {
            open = text.indexOf("{{c", pos);

            if (open === -1 || open >= lineEnd(text, pos)) {
                return null;
            }
        }

        const close = text.indexOf("}}", open);
        const sep = text.indexOf("::", open);

        if (close === -1 || sep === -1 || sep > close) {
            return null;
        }

        if (around) {
            return { start: open, end: close + 2 };
        }

        const hint = text.indexOf("::", sep + 2);

        return {
            start: sep + 2,
            end: hint !== -1 && hint < close ? hint : close,
        };
    }

    // Paragraph object: returns line-based { start, end } (exclusive end,
    // both at line starts or text end) and is always linewise.
    function paragraphObject(text, pos, around) {
        const n = text.length;
        const blank = (s) => lineEnd(text, s) === s;
        const kind = blank(lineStart(text, pos));
        let a = lineStart(text, pos);

        while (a > 0 && blank(lineStart(text, a - 1)) === kind) {
            a = lineStart(text, a - 1);
        }

        let b = lineEnd(text, pos);

        while (b < n && blank(b + 1) === kind) {
            b = lineEnd(text, b + 1);
        }

        if (around) {
            while (b < n && blank(b + 1) !== kind) {
                b = lineEnd(text, b + 1);
            }
        }

        return { start: a, end: b };
    }

    // ---- search ----------------------------------------------------------

    // Vim-ish pattern to RegExp: plain regex syntax, smartcase, \c / \C,
    // \< and \> word boundaries. Falls back to a literal match if invalid.
    function makeRegex(pattern, flags) {
        let ignoreCase = !/[A-Z]/.test(pattern);

        if (pattern.includes("\\c")) {
            ignoreCase = true;
            pattern = pattern.replace(/\\c/g, "");
        }

        if (pattern.includes("\\C")) {
            ignoreCase = false;
            pattern = pattern.replace(/\\C/g, "");
        }

        pattern = pattern.replace(/\\[<>]/g, "\\b");

        const f = (flags || "g") + "mu" + (ignoreCase ? "i" : "");

        try {
            return new RegExp(pattern, f);
        } catch (error) {
            return new RegExp(
                pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                f,
            );
        }
    }

    function allMatches(text, regex) {
        const out = [];
        regex.lastIndex = 0;

        let m;

        while ((m = regex.exec(text)) !== null) {
            if (m[0].length === 0) {
                regex.lastIndex++;
                continue;
            }

            out.push({ start: m.index, end: m.index + m[0].length });
        }

        return out;
    }

    // Next match start after (forward) or before (backward) pos, wrapping.
    function search(text, pattern, pos, forward, count) {
        const matches = allMatches(text, makeRegex(pattern));

        if (matches.length === 0) {
            return -1;
        }

        let current = pos;

        for (let n = 0; n < (count || 1); n++) {
            let found;

            if (forward) {
                found = matches.find((m) => m.start > current) || matches[0];
            } else {
                found =
                    [...matches].reverse().find((m) => m.start < current) ||
                    matches[matches.length - 1];
            }

            current = found.start;
        }

        return current;
    }

    function toggleCase(str) {
        let out = "";

        for (const ch of str) {
            const lower = ch.toLowerCase();
            out += ch === lower ? ch.toUpperCase() : lower;
        }

        return out;
    }

    const api = {
        ATOM,
        cls,
        clamp,
        isBlankChar,
        lineStart,
        lineEnd,
        lineLast,
        clampNormal,
        lineIndex,
        lineCount,
        lineStartOf,
        firstNonBlank,
        moveLines,
        wordForward,
        wordEnd,
        wordBack,
        wordEndBack,
        findChar,
        matchPair,
        paragraphForward,
        paragraphBack,
        sentenceForward,
        sentenceBack,
        sentenceObject,
        numberAt,
        wordObject,
        quoteObject,
        pairObject,
        clozeObject,
        paragraphObject,
        makeRegex,
        allMatches,
        search,
        toggleCase,
    };

    root.AnkiVimText = api;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
