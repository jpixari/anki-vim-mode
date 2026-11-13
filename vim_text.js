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

        // The editor stores some spaces as non-breaking spaces (at the
        // start or end of a line, or doubled): f<Space> must find those too.
        const hit = (j) =>
            text[j] === ch || (ch === " " && text[j] === "\u00a0");

        for (let n = 0; n < count; n++) {
            if (forward) {
                i++;

                while (i < e && !hit(i)) {
                    i++;
                }

                if (i >= e) {
                    return -1;
                }
            } else {
                i--;

                while (i >= s && !hit(i)) {
                    i--;
                }

                if (i < s) {
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

    // A cursor that walks the text the way Vim's inc()/dec() walk a buffer.
    // The "\n" ending a line (and the end of the text) stands for the
    // position just past a line's last character, which Vim treats as
    // blank. Used by the text objects ported from Vim's textobject.c.
    function walker(text, start, big) {
        const n = text.length;
        const w = {
            at: start,
            nul: (i) => i >= n || text[i] === "\n",
            cls: () => (w.nul(w.at) ? 0 : cls(text, w.at, big)),
            col0: () => w.at === lineStart(text, w.at),
            // 0: moved, 2: now past the last character, 1: now on the
            // next line, -1: end of text.
            inc: () => {
                if (!w.nul(w.at)) {
                    w.at++;
                    return w.nul(w.at) ? 2 : 0;
                }

                if (w.at < n) {
                    w.at++;
                    return 1;
                }

                return -1;
            },
            dec: () => {
                if (!w.col0()) {
                    w.at--;
                    return 0;
                }

                if (w.at > 0) {
                    w.at--;
                    return 1;
                }

                return -1;
            },
            // Like inc/dec but never rest past the end of a line.
            incl: () => {
                let r = w.inc();

                if (r >= 1 && !w.col0()) {
                    r = w.inc();
                }

                return r;
            },
            decl: () => {
                let r = w.dec();

                if (r === 1 && !w.col0()) {
                    r = w.dec();
                }

                return r;
            },
            oneleft: () => {
                if (w.col0()) {
                    return false;
                }

                w.at--;
                return true;
            },
            lastLine: () => lineEnd(text, w.at) === n,
            emptyLine: () => w.col0() && w.nul(w.at),
        };

        return w;
    }

    // w / W under an operator: Vim's fwd_word() with "eol" set, where the
    // last word moved over stops at the end of its line. Returns the end
    // position (possibly the line break itself), or null when it fails.
    function wordForwardOp(text, pos, big, count) {
        const w = walker(text, clamp(pos, 0, text.length), big);

        for (let left = count; left > 0; left--) {
            const lastCount = left === 1;
            const sclass = w.cls();
            const last = w.lastLine();
            let i = w.inc();

            if (i === -1 || (i >= 1 && last)) {
                return left === count && i === -1 ? null : w.at;
            }

            if (i >= 1 && lastCount) {
                return w.at;
            }

            if (sclass !== 0) {
                let stop = false;

                while (w.cls() === sclass) {
                    i = w.inc();

                    if (i === -1 || (i >= 1 && lastCount)) {
                        stop = true;
                        break;
                    }
                }

                if (stop) {
                    return w.at;
                }
            }

            while (w.cls() === 0) {
                if (w.emptyLine()) {
                    break;
                }

                i = w.inc();

                if (i === -1 || (i >= 1 && last)) {
                    return w.at;
                }
            }
        }

        return w.at;
    }

    // iw / aw / iW / aW with a count: Vim's current_word().
    // Returns { start, end } (end exclusive), with excl: true when the
    // object stopped at the start of a line, or null when it fails.
    function wordObject(text, pos, around, big, count) {
        const w = walker(text, clamp(pos, 0, text.length), big);

        const backInLine = () => {
            const sclass = w.cls();

            while (!w.col0()) {
                w.dec();

                if (w.cls() !== sclass) {
                    w.inc();
                    break;
                }
            }
        };

        // true when the end of the text was hit
        const skipChars = (cclass) => {
            while (w.cls() === cclass) {
                if (w.inc() === -1) {
                    return true;
                }
            }

            return false;
        };

        const endWord = () => {
            const sclass = w.cls();

            if (w.inc() === -1) {
                return false;
            }

            if (w.cls() === sclass && sclass !== 0) {
                if (skipChars(sclass)) {
                    return false;
                }
            } else if (sclass === 0) {
                while (w.cls() === 0) {
                    if (w.emptyLine()) {
                        return true;
                    }

                    if (w.inc() === -1) {
                        return false;
                    }
                }

                if (skipChars(w.cls())) {
                    return false;
                }
            }

            w.dec();
            return true;
        };

        const fwdWord = () => {
            const sclass = w.cls();
            const last = w.lastLine();
            let i = w.inc();

            if (i === -1 || (i >= 1 && last)) {
                return false;
            }

            if (i >= 1) {
                return true;
            }

            if (sclass !== 0) {
                while (w.cls() === sclass) {
                    i = w.inc();

                    if (i === -1 || i >= 1) {
                        return true;
                    }
                }
            }

            while (w.cls() === 0) {
                if (w.emptyLine()) {
                    break;
                }

                i = w.inc();

                if (i === -1 || (i >= 1 && last)) {
                    return true;
                }
            }

            return true;
        };

        let inclusive = true;
        let includeWhite = false;

        backInLine();

        let start = w.at;

        if ((w.cls() === 0) === !!around) {
            if (!endWord()) {
                return null;
            }
        } else {
            fwdWord();

            if (w.col0()) {
                w.decl();
            } else {
                w.oneleft();
            }

            if (around) {
                includeWhite = true;
            }
        }

        for (let left = (count || 1) - 1; left > 0; left--) {
            inclusive = true;

            if (w.incl() === -1) {
                return null;
            }

            // Same choice as for the first object: white space and a word
            // together for "aw", one of them at a time for "iw".
            if ((w.cls() === 0) === !!around) {
                if (!endWord()) {
                    return null;
                }
            } else {
                if (!fwdWord()) {
                    return null;
                }

                if (!w.oneleft()) {
                    inclusive = false;
                }
            }
        }

        if (includeWhite && (w.cls() !== 0 || (w.col0() && !inclusive))) {
            // No white space after the word: take the white before it
            // instead (but never a line's indent).
            const end = w.at;

            w.at = start;

            if (w.oneleft()) {
                backInLine();

                if (w.cls() === 0 && !w.col0()) {
                    start = w.at;
                }
            }

            w.at = end;
        }

        // Ending past a line's last character (an empty line) includes
        // nothing there: the line break is never part of the object.
        const range = {
            start,
            end: inclusive && !w.nul(w.at) ? w.at + 1 : w.at,
        };

        if (!inclusive) {
            range.excl = true;
        }

        return range;
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

    // i( a( i[ i{ i< ... with a count: Vim's current_block(). The count
    // picks an outer block; when the cursor is not inside a block, the next
    // one after it is used.
    function pairObject(text, pos, open, close, around, count) {
        const w = walker(text, clamp(pos, 0, text.length), false);
        const white = (i) => text[i] === " " || text[i] === "\t" || text[i] === " ";
        // On a blank that is part of the line's indent.
        const inIndent = () => {
            if (w.nul(w.at) || !white(w.at)) {
                return false;
            }

            for (let i = lineStart(text, w.at); i < w.at; i++) {
                if (!white(i)) {
                    return false;
                }
            }

            return true;
        };
        const openBefore = (from) => {
            let depth = 0;

            for (let i = from - 1; i >= 0; i--) {
                if (text[i] === close) {
                    depth++;
                } else if (text[i] === open) {
                    if (depth === 0) {
                        return i;
                    }

                    depth--;
                }
            }

            return -1;
        };
        const closeAfter = (from) => {
            let depth = 0;

            for (let i = from + 1; i < text.length; i++) {
                if (text[i] === open) {
                    depth++;
                } else if (text[i] === close) {
                    if (depth === 0) {
                        return i;
                    }

                    depth--;
                }
            }

            return -1;
        };

        if (open === "{") {
            while (inIndent()) {
                if (w.inc() !== 0) {
                    break;
                }
            }
        }

        if (text[w.at] === open) {
            w.at++;
        }

        const inside = openBefore(w.at) !== -1;

        if (!inside && (count || 1) > 1) {
            return null;
        }

        let found = -1;
        let startPos = -1;

        for (let left = count || 1; left > 0; left--) {
            found = inside ? openBefore(w.at) : text.indexOf(open, w.at);

            if (found === -1) {
                break;
            }

            w.at = found;
            startPos = found;

            if (!inside) {
                w.at = found + 1;
            }
        }

        if (found === -1) {
            return null;
        }

        const endPos = closeAfter(startPos);

        if (endPos === -1) {
            return null;
        }

        if (around) {
            return { start: startPos, end: endPos + 1 };
        }

        w.at = startPos;
        w.incl();

        const start = w.at;

        w.at = endPos;

        let sol = w.col0();

        w.decl();

        while (inIndent()) {
            sol = true;

            if (w.decl() !== 0) {
                break;
            }
        }

        if (sol) {
            // The closing bracket starts its line: stop before that line.
            w.incl();
            return { start, end: Math.max(start, w.at), excl: true };
        }

        if (start <= w.at) {
            return { start, end: w.at + 1 };
        }

        return { start, end: start };
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
    // ip / ap with a count: Vim's current_par(). Lines holding only blanks
    // count as white. Returns { start, end } covering whole lines, or null.
    function paragraphObject(text, pos, around, count) {
        const starts = [0];

        for (let i = 0; i < text.length; i++) {
            if (text[i] === "\n") {
                starts.push(i + 1);
            }
        }

        const total = starts.length;
        const white = (l) => {
            const s = starts[l];

            return text.slice(s, lineEnd(text, s)).trim() === "";
        };
        let first = lineIndex(text, pos);
        const whiteInFront = white(first);

        while (first > 0 && white(first - 1) === whiteInFront) {
            first--;
        }

        let last = first;

        while (last < total && white(last)) {
            last++;
        }

        last--;

        let left = count || 1;

        if (!around && whiteInFront) {
            left--;
        }

        while (left-- > 0) {
            if (last === total - 1) {
                return null;
            }

            const doWhite = !around && white(last + 1);

            if (around || !doWhite) {
                last++;

                while (last < total - 1 && !white(last + 1)) {
                    last++;
                }
            }

            if (left === 0 && whiteInFront && around) {
                break;
            }

            if (around || doWhite) {
                while (last < total - 1 && white(last + 1)) {
                    last++;
                }
            }
        }

        // No white lines after the paragraph: take the ones before it.
        if (!whiteInFront && !white(last) && around) {
            while (first > 0 && white(first - 1)) {
                first--;
            }
        }

        return { start: starts[first], end: lineEnd(text, starts[last]) };
    }

    // { and } with a count: Vim's findpar(). Returns { pos, inc } or null
    // when the count runs past the first / last line.
    function paragraphMove(text, pos, count, forward) {
        const n = text.length;
        const blank = (s) => lineEnd(text, s) === s;
        let s = lineStart(text, pos);

        for (let left = count; left > 0; left--) {
            let skipped = false;

            for (let first = true; ; first = false) {
                if (!blank(s)) {
                    skipped = true;
                }

                if (!first && skipped && blank(s)) {
                    break;
                }

                const e = lineEnd(text, s);
                const next = forward ? (e >= n ? -1 : e + 1) : s === 0 ? -1 : lineStart(text, s - 1);

                if (next === -1) {
                    if (left > 1) {
                        return null;
                    }

                    break;
                }

                s = next;
            }
        }

        // Running into the last line going forward ends on its last
        // character (and includes it); otherwise on the line's start.
        const e = lineEnd(text, s);

        if (forward && e === n && e > s) {
            return { pos: e - 1, inc: true };
        }

        return { pos: s, inc: false };
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
        // A space also matches the non-breaking spaces the editor stores.
        pattern = pattern.replace(/ /g, "[ \\u00a0]");

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
        wordForwardOp,
        wordEnd,
        wordBack,
        wordEndBack,
        findChar,
        matchPair,
        paragraphForward,
        paragraphBack,
        paragraphMove,
        sentenceStarts,
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
