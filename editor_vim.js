// editor_vim.js
//
// Vim mode for Anki's note editor.
//
// Design: every edit happens inside the field itself through the browser's
// editing commands, so Anki sees ordinary input events and the native undo
// history (Ctrl+Z, the undo button) keeps working. Nothing is round-tripped
// through Python.
//
// A field is viewed through a *model*: its content flattened to a string
// where each line break is "\n" and each non-text object (image, MathJax...)
// is one placeholder character. Motions and text objects are computed on that
// string by vim_text.js; this file maps string offsets back to DOM positions.

(function () {
    "use strict";

    const VERSION = "3.0.0";

    if (window.ankiVim && window.ankiVim.version === VERSION) {
        window.ankiVim.applyConfig(window.ankiVimConfig || {});
        return;
    }

    const T = window.AnkiVimText;

    if (!T) {
        console.log("[Anki Vim] vim_text.js was not loaded");
        return;
    }

    const ATOM = T.ATOM;

    const BLOCK_TAGS = new Set(
        (
            "DIV P UL OL LI H1 H2 H3 H4 H5 H6 BLOCKQUOTE PRE TABLE THEAD " +
            "TBODY TFOOT TR TD TH SECTION ARTICLE HEADER FOOTER DL DT DD " +
            "FIGURE FIGCAPTION ADDRESS CENTER HR"
        ).split(" "),
    );
    const ATOM_TAGS = new Set(
        (
            "IMG ANKI-FRAME ANKI-MATHJAX SVG VIDEO AUDIO IFRAME OBJECT " +
            "CANVAS INPUT BUTTON SELECT TEXTAREA HR"
        ).split(" "),
    );
    const SKIP_TAGS = new Set(["STYLE", "SCRIPT", "TEMPLATE"]);
    const FORMAT_TAGS = new Set(
        (
            "B STRONG I EM U S STRIKE DEL INS SUB SUP CODE KBD MARK SMALL " +
            "BIG SPAN FONT A"
        ).split(" "),
    );

    const config = {
        shift_jk_fields: true,
        insert_escape: "",
        insert_escape_timeout_ms: 400,
        start_in_insert: false,
        system_clipboard: false,
        jk_display_lines: false,
        show_status: true,
        status_position: "bottom-left",
        vim_ctrl_keys: false,
        cursor_color: "text",
        cursor_blink: false,
        cursor_min_width: 0,
    };

    // ======================================================================
    // DOM model
    // ======================================================================

    function isBlock(el) {
        return BLOCK_TAGS.has(el.tagName);
    }

    function isAtom(el) {
        return (
            ATOM_TAGS.has(el.tagName) ||
            el.getAttribute("contenteditable") === "false"
        );
    }

    // Whitespace between block tags in pretty-printed HTML is not rendered.
    function isSkippableText(node) {
        const d = node.data;
        return d.length === 0 || (/^[ \t\r\n]+$/.test(d) && /[\r\n]/.test(d));
    }

    function childIndex(node) {
        let i = 0;

        for (let n = node.previousSibling; n; n = n.previousSibling) {
            i++;
        }

        return i;
    }

    // A <br> with nothing after it in its block does not start a new line;
    // it only keeps an otherwise empty line open ("a<br>" is one line).
    function isFillerBr(br, root) {
        let node = br;

        for (;;) {
            while (!node.nextSibling) {
                node = node.parentNode;

                if (!node || node === root || isBlock(node)) {
                    return true;
                }
            }

            node = node.nextSibling;

            for (;;) {
                if (node.nodeType === 3) {
                    if (!isSkippableText(node)) {
                        return false;
                    }

                    break;
                }

                if (node.nodeType !== 1 || SKIP_TAGS.has(node.tagName)) {
                    break;
                }

                if (node.tagName === "BR") {
                    return false;
                }

                if (isBlock(node)) {
                    return true;
                }

                if (isAtom(node)) {
                    return false;
                }

                if (!node.firstChild) {
                    break;
                }

                node = node.firstChild;
            }
        }
    }

    // probes: [{n, o}] DOM positions to translate into text offsets.
    function buildModel(root, probes) {
        const chars = [];
        const out = [];
        const fill = new Map();
        const textBase = new Map();
        const atomIndex = new Map();
        const flushed = new Set();
        const probeHits = (probes || []).map(() => null);

        let touched = false;
        let pending = false;
        let seq = 0;

        function flush() {
            if (pending) {
                chars.push({ k: "v" });
                out.push("\n");
                flushed.add(seq);
                pending = false;
            }
        }

        function boundary() {
            if (touched) {
                pending = true;
                seq++;
                touched = false;
            }
        }

        function checkProbes(node, offset) {
            if (!probes) {
                return;
            }

            for (let i = 0; i < probes.length; i++) {
                const p = probes[i];

                if (
                    p &&
                    probeHits[i] === null &&
                    p.n === node &&
                    p.o === offset
                ) {
                    probeHits[i] = {
                        len: chars.length,
                        seq: pending ? seq : 0,
                    };
                }
            }
        }

        function visitChildren(node) {
            let i = 0;

            for (let c = node.firstChild; c; c = c.nextSibling, i++) {
                checkProbes(node, i);
                visit(c);
            }

            checkProbes(node, i);
        }

        function visit(node) {
            if (node.nodeType === 3) {
                if (isSkippableText(node)) {
                    textBase.set(node, {
                        len: chars.length,
                        seq: pending ? seq : 0,
                        skip: true,
                    });
                    return;
                }

                flush();
                textBase.set(node, { len: chars.length });

                const data = node.data;

                for (let k = 0; k < data.length; k++) {
                    const ch = data[k];

                    chars.push({ k: "t", n: node, o: k });
                    out.push(ch === "\n" || ch === "\r" ? " " : ch);
                }

                touched = true;
                return;
            }

            if (node.nodeType !== 1 || SKIP_TAGS.has(node.tagName)) {
                return;
            }

            if (node.tagName === "BR") {
                flush();

                if (isFillerBr(node, root)) {
                    fill.set(chars.length, node);
                    touched = true;
                } else {
                    chars.push({ k: "b", n: node });
                    out.push("\n");
                    touched = false;
                }

                return;
            }

            const block = isBlock(node);

            if (isAtom(node)) {
                if (block) {
                    boundary();
                }

                flush();
                atomIndex.set(node, chars.length);
                chars.push({ k: "a", n: node });
                out.push(ATOM);
                touched = true;

                if (block) {
                    boundary();
                }

                return;
            }

            if (block) {
                boundary();
            }

            visitChildren(node);

            if (block) {
                boundary();
            }
        }

        visitChildren(root);

        const model = {
            root,
            chars,
            fill,
            text: out.join(""),
        };

        function resolve(i) {
            const p = probes[i];

            if (!p || !p.n) {
                return null;
            }

            if (p.n.nodeType === 3) {
                const base = textBase.get(p.n);

                if (base && !base.skip) {
                    return base.len + Math.min(p.o, p.n.data.length);
                }

                if (base) {
                    return base.len + (base.seq && flushed.has(base.seq) ? 1 : 0);
                }
            }

            const hit = probeHits[i];

            if (hit) {
                return hit.len + (hit.seq && flushed.has(hit.seq) ? 1 : 0);
            }

            // Caret inside an atom (e.g. within a MathJax frame).
            for (let n = p.n; n && n !== root; n = n.parentNode) {
                if (atomIndex.has(n)) {
                    return atomIndex.get(n);
                }
            }

            return null;
        }

        model.probeOffsets = (probes || []).map((_, i) => resolve(i));
        return model;
    }

    function posBefore(c) {
        if (c.k === "t") {
            return { n: c.n, o: c.o };
        }

        return { n: c.n.parentNode, o: childIndex(c.n) };
    }

    function posAfter(c) {
        if (c.k === "t") {
            return { n: c.n, o: c.o + 1 };
        }

        return { n: c.n.parentNode, o: childIndex(c.n) + 1 };
    }

    // DOM caret position for text offset i. A caret normally attaches to the
    // character before it (so typing continues that character's formatting);
    // forward=true attaches to the character after it instead, which is what
    // the start of a range wants.
    function domPos(m, i, forward) {
        const len = m.text.length;

        i = T.clamp(i, 0, len);

        if (forward && i < len && m.chars[i].k !== "v") {
            return posBefore(m.chars[i]);
        }

        if (i > 0 && m.text[i - 1] !== "\n") {
            return posAfter(m.chars[i - 1]);
        }

        if (i < len && m.chars[i].k !== "v") {
            return posBefore(m.chars[i]);
        }

        const br = m.fill.get(i);

        if (br && br.parentNode) {
            return { n: br.parentNode, o: childIndex(br) };
        }

        if (i > 0 && m.chars[i - 1].k === "b") {
            return posAfter(m.chars[i - 1]);
        }

        return { n: m.root, o: i === 0 ? 0 : m.root.childNodes.length };
    }

    // ======================================================================
    // State
    // ======================================================================

    const V = {
        mode: "normal",
        field: null,
        lastField: null,
        model: null,
        pos: 0,
        desiredCol: 0,
        stamp: null,
        vAnchor: 0,
        lastVisual: null,
        keys: [],
        regs: {},
        clipboardText: "",
        lastClipWrite: null,
        lastFind: null,
        lastSearch: null,
        lastChange: null,
        pendingDot: null,
        replaying: false,
        change: null,
        undo: [],
        redo: [],
        insert: null,
        escapeArmed: 0,
        cmdline: null,
        message: "",
        messageTimer: 0,
        posMemo: new WeakMap(),
        statusEl: null,
        cursorEl: null,
        selectEl: null,
        marks: {},
        jumps: [],
        jumpIdx: 0,
        recording: null,
        macros: {},
        lastMacro: null,
        playing: 0,
        groupDepth: 0,
        replaceStack: [],
        replaceTyped: "",
        blockAnchorCol: 0,
        lastInserted: "",
        lastInsertPos: null,
        lastChangePos: null,
        lastCmd: "",
        lastSub: null,
        insertReg: false,
        history: { ":": [], "/": [] },
        drawQueued: false,
        windowFocused: true,
        cursorKey: "",
    };

    // ======================================================================
    // Fields, focus and selection
    // ======================================================================

    function isFieldEditable(el) {
        if (!el || el.nodeType !== 1 || !el.isContentEditable) {
            return false;
        }

        if (el.tagName === "ANKI-EDITABLE") {
            return true;
        }

        const rootNode = el.getRootNode();
        const host = rootNode && rootNode.host;

        return (
            (host &&
                host.classList &&
                host.classList.contains("rich-text-editable")) ||
            (el.classList && el.classList.contains("rich-text-editable"))
        );
    }

    function allFields() {
        const out = [];

        for (const host of document.querySelectorAll(".rich-text-editable")) {
            const root = host.shadowRoot;
            const editable = root
                ? root.querySelector("anki-editable,[contenteditable]")
                : host.isContentEditable
                  ? host
                  : null;

            if (editable && editable.getClientRects().length > 0) {
                out.push(editable);
            }
        }

        if (out.length === 0) {
            for (const el of document.querySelectorAll("anki-editable")) {
                if (el.getClientRects().length > 0) {
                    out.push(el);
                }
            }
        }

        return out;
    }

    function deepActive() {
        let a = document.activeElement;

        while (a && a.shadowRoot && a.shadowRoot.activeElement) {
            a = a.shadowRoot.activeElement;
        }

        return a;
    }

    function activeField() {
        let a = deepActive();

        while (a && a.nodeType === 1) {
            if (isFieldEditable(a)) {
                // The editing host is the outermost editable element.
                let hostEl = a;

                while (
                    hostEl.parentElement &&
                    hostEl.parentElement.isContentEditable
                ) {
                    hostEl = hostEl.parentElement;
                }

                return hostEl;
            }

            a = a.parentElement;
        }

        return null;
    }

    function getSel(field) {
        const rootNode = field.getRootNode();

        if (rootNode && typeof rootNode.getSelection === "function") {
            return rootNode.getSelection();
        }

        return window.getSelection();
    }

    function selProbes(field) {
        const sel = getSel(field);

        if (!sel || sel.rangeCount === 0 || !sel.anchorNode) {
            return null;
        }

        if (
            !field.contains(sel.anchorNode) ||
            !field.contains(sel.focusNode)
        ) {
            return null;
        }

        return [
            { n: sel.anchorNode, o: sel.anchorOffset },
            { n: sel.focusNode, o: sel.focusOffset },
        ];
    }

    // Rebuild the model of the current field. model.anchor / model.caret are
    // the text offsets of the DOM selection (null when it is elsewhere).
    function remodel() {
        const field = V.field;

        if (!field) {
            V.model = null;
            return null;
        }

        const probes = selProbes(field);
        const m = buildModel(field, probes);

        m.anchor = probes ? m.probeOffsets[0] : null;
        m.caret = probes ? m.probeOffsets[1] : null;
        m.collapsed = probes
            ? probes[0].n === probes[1].n && probes[0].o === probes[1].o
            : true;
        V.model = m;
        return m;
    }

    function setSel(m, a, b) {
        const sel = getSel(m.root);

        if (!sel) {
            return;
        }

        const pa = domPos(m, a, a < b);
        const pb = a === b ? pa : domPos(m, b, b < a);

        try {
            sel.setBaseAndExtent(pa.n, pa.o, pb.n, pb.o);
        } catch (error) {
            console.log("[Anki Vim] setSel failed", error);
        }

        V.stamp = { field: m.root, n: pb.n, o: pb.o };
    }

    function stampMatches(field) {
        const s = V.stamp;

        if (!s || s.field !== field) {
            return false;
        }

        const sel = getSel(field);

        return (
            !!sel &&
            sel.rangeCount > 0 &&
            sel.focusNode === s.n &&
            sel.focusOffset === s.o
        );
    }

    function isVisual() {
        return V.mode === "visual" || V.mode === "vline" || V.mode === "vblock";
    }

    // Insert and replace mode: typing goes to the field.
    function inInsert() {
        return V.mode === "insert" || V.mode === "replace";
    }

    // Bring V.model / V.pos up to date with the DOM before running a command.
    function sync() {
        const field = V.field;

        if (!field) {
            return null;
        }

        const keep = stampMatches(field);
        const m = remodel();

        if (!isVisual() && !keep) {
            if (m.caret !== null) {
                V.pos = m.caret;
            } else {
                V.pos = V.posMemo.get(field) || 0;
            }

            V.pos = T.clampNormal(m.text, V.pos);
            V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
        }

        V.pos = T.clamp(V.pos, 0, m.text.length);
        V.vAnchor = T.clamp(V.vAnchor, 0, m.text.length);
        return m;
    }

    function visualBounds(m) {
        const lo = Math.min(V.vAnchor, V.pos);
        const hi = Math.max(V.vAnchor, V.pos);

        if (V.mode === "vline" || V.mode === "vblock") {
            return {
                start: T.lineStart(m.text, lo),
                end: T.lineEnd(m.text, hi),
                lw: true,
            };
        }

        let end = Math.min(hi + 1, m.text.length);

        // v$ reaches past the last character and takes the line break too.
        if (
            V.desiredCol === Infinity &&
            V.pos >= V.vAnchor &&
            end === T.lineEnd(m.text, V.pos) &&
            end > T.lineStart(m.text, V.pos)
        ) {
            end = Math.min(end + 1, m.text.length);
        }

        return { start: lo, end, lw: false };
    }

    // Put the DOM selection where the vim cursor / visual area is.
    function placeCursor() {
        const m = V.model;

        if (!m) {
            return;
        }

        if (V.mode === "visual") {
            const len = m.text.length;

            if (V.pos >= V.vAnchor) {
                setSel(m, V.vAnchor, Math.min(V.pos + 1, len));
            } else {
                setSel(m, Math.min(V.vAnchor + 1, len), V.pos);
            }
        } else if (V.mode === "vline") {
            const b = visualBounds(m);
            setSel(m, b.start, b.end);
        } else {
            setSel(m, V.pos, V.pos);
        }

        V.posMemo.set(m.root, V.pos);
        queueDraw();
    }

    function focusField(field, pos) {
        if (!field) {
            return;
        }

        try {
            field.focus({ preventScroll: true });
        } catch (error) {
            field.focus();
        }

        V.field = field;
        V.lastField = field;
        V.stamp = null;

        const m = remodel();
        const target =
            pos !== undefined && pos !== null
                ? pos
                : V.posMemo.get(field) || 0;

        if (inInsert()) {
            setSel(m, T.clamp(target, 0, m.text.length), target);
        } else {
            V.mode = "normal";
            V.pos = T.clampNormal(m.text, target);
            V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
            placeCursor();
        }

        updateStatus();
    }

    function moveField(delta) {
        const fields = allFields();

        if (fields.length === 0) {
            return;
        }

        const idx = fields.indexOf(V.field);
        const next =
            idx === -1
                ? 0
                : (idx + delta + fields.length * 8) % fields.length;

        if (V.field) {
            V.posMemo.set(V.field, V.pos);
        }

        focusField(fields[next]);
    }

    // ======================================================================
    // Editing primitives (all through execCommand => native undo history)
    // ======================================================================

    function exec(command, value) {
        try {
            return document.execCommand(command, false, value);
        } catch (error) {
            console.log("[Anki Vim] execCommand failed", command, error);
            return false;
        }
    }

    function deleteRange(a, b) {
        if (a < b) {
            setSel(V.model, a, b);
            exec("delete");
        }

        return remodel();
    }

    // Insert plain text (may contain "\n") at the current DOM caret.
    function typeText(str) {
        const parts = str.split("\n");

        for (let i = 0; i < parts.length; i++) {
            if (i > 0) {
                exec("insertLineBreak");
            }

            const part = parts[i].split(ATOM).join("");

            if (part) {
                exec("insertText", part);
            }
        }
    }

    function replaceRange(a, b, str) {
        setSel(V.model, a, b);

        if (str === "") {
            if (a < b) {
                exec("delete");
            }
        } else if (!str.includes("\n") && !str.includes(ATOM)) {
            exec("insertText", str);
        } else {
            if (a < b) {
                exec("delete");
            }

            typeText(str);
        }

        return remodel();
    }

    function escapeHtml(str) {
        return str
            .split(ATOM)
            .join("")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    // Anki decorates MathJax inside a field: <anki-mathjax> gets wrapped in an
    // <anki-frame> with helper elements and a rendered image. That live form
    // must never be re-inserted or compared; reduce it to the plain element
    // Anki itself creates when it loads a field, which it then re-decorates.
    function normalizeFragment(holder) {
        for (const mj of Array.from(holder.querySelectorAll("anki-mathjax"))) {
            const frame = mj.closest("anki-frame");
            const fresh = document.createElement("anki-mathjax");

            if (
                mj.getAttribute("block") === "true" ||
                (frame && frame.getAttribute("block") === "true")
            ) {
                fresh.setAttribute("block", "true");
            }

            fresh.textContent =
                mj.dataset.mathjax !== undefined
                    ? mj.dataset.mathjax
                    : mj.textContent;
            (frame && holder.contains(frame) ? frame : mj).replaceWith(fresh);
        }

        for (const frame of Array.from(holder.querySelectorAll("anki-frame"))) {
            frame.replaceWith(...Array.from(frame.childNodes));
        }

        for (const el of Array.from(
            holder.querySelectorAll("frame-start,frame-end"),
        )) {
            el.remove();
        }
    }

    const FRAMED = /<anki-(frame|mathjax)/;

    // Field content in a form that is stable across Anki's decoration.
    function fieldHtml(field) {
        const html = field.innerHTML;

        if (!FRAMED.test(html)) {
            return html;
        }

        const holder = document.createElement("div");

        for (const child of Array.from(field.childNodes)) {
            holder.appendChild(child.cloneNode(true));
        }

        normalizeFragment(holder);
        return holder.innerHTML;
    }

    // HTML of the text range [a, b) including the inline formatting that
    // surrounds it, or null when it is just plain text.
    function rangeHtml(m, a, b) {
        if (a >= b) {
            return null;
        }

        const pa = domPos(m, a, true);
        const pb = domPos(m, b);
        const range = document.createRange();

        try {
            range.setStart(pa.n, pa.o);
            range.setEnd(pb.n, pb.o);
        } catch (error) {
            return null;
        }

        const holder = document.createElement("div");
        holder.appendChild(range.cloneContents());
        normalizeFragment(holder);

        let hasMarkup = holder.querySelector("*") !== null;
        let node = range.commonAncestorContainer;

        while (node && node !== m.root) {
            if (node.nodeType === 1 && FORMAT_TAGS.has(node.tagName)) {
                const wrap = node.cloneNode(false);

                while (holder.firstChild) {
                    wrap.appendChild(holder.firstChild);
                }

                holder.appendChild(wrap);
                hasMarkup = true;
            }

            node = node.parentNode;
        }

        return hasMarkup ? holder.innerHTML : null;
    }

    // ======================================================================
    // Registers
    // ======================================================================

    function sendPython(payload) {
        try {
            if (typeof pycmd === "function") {
                pycmd("anki_vim:" + JSON.stringify(payload));
            }
        } catch (error) {
            console.log("[Anki Vim] pycmd failed", error);
        }
    }

    function captureRange(m, range) {
        const text = m.text.slice(range.start, range.end);

        if (range.lw) {
            const htmlLines = [];
            let any = false;
            let s = range.start;

            for (const line of text.split("\n")) {
                const h = rangeHtml(m, s, s + line.length);

                htmlLines.push(h);
                any = any || h !== null;
                s += line.length + 1;
            }

            return {
                text: text + "\n",
                linewise: true,
                htmlLines: any ? htmlLines : null,
            };
        }

        return {
            text,
            linewise: false,
            html: text.includes("\n") ? null : rangeHtml(m, range.start, range.end),
        };
    }

    function setRegister(name, data, kind) {
        if (name === "_") {
            return;
        }

        if (name && /^[A-Z]$/.test(name)) {
            const key = name.toLowerCase();
            const old = V.regs[key];

            if (old) {
                data = {
                    text: old.text + data.text,
                    linewise: old.linewise || data.linewise,
                };
            }

            name = key;
        }

        if (name && name !== '"' && name !== "+" && name !== "*") {
            V.regs[name] = data;
        }

        V.regs['"'] = data;

        if (!name && kind === "yank") {
            V.regs["0"] = data;
        }

        if (!name && kind === "delete") {
            if (data.linewise || data.text.includes("\n")) {
                // Line deletes shift through "1 .. "9, like vim.
                for (let i = 9; i > 1; i--) {
                    if (V.regs[String(i - 1)]) {
                        V.regs[String(i)] = V.regs[String(i - 1)];
                    }
                }

                V.regs["1"] = data;
            } else {
                V.regs["-"] = data;
            }
        }

        if (name === "+" || name === "*" || (!name && config.system_clipboard)) {
            V.lastClipWrite = data;
            V.clipboardText = data.text;
            sendPython({ cmd: "clip", text: data.text });
        }
    }

    function getRegister(name) {
        if (name === "+" || name === "*" || (!name && config.system_clipboard)) {
            const clip = V.clipboardText || "";

            if (V.lastClipWrite && V.lastClipWrite.text === clip) {
                return V.lastClipWrite;
            }

            if (clip) {
                return { text: clip, linewise: false };
            }

            return name ? null : V.regs['"'] || null;
        }

        if (!name) {
            return V.regs['"'] || null;
        }

        // Read-only registers.
        if (name === ".") {
            return { text: V.lastInserted, linewise: false };
        }

        if (name === "/") {
            return { text: V.lastSearch ? V.lastSearch.pattern : "", linewise: false };
        }

        if (name === ":") {
            return { text: V.lastCmd, linewise: false };
        }

        return V.regs[name.toLowerCase()] || null;
    }

    // ======================================================================
    // Undo / redo
    // ======================================================================
    //
    // A vim command can be several native edit steps (and an insert session
    // is many). We remember the field HTML before and after each vim change
    // and step the *native* undo history until the field matches again, so
    // `u` undoes one whole vim change while Ctrl+Z keeps working as usual.

    function beginChange() {
        if (V.change || !V.field) {
            return;
        }

        V.change = {
            field: V.field,
            before: fieldHtml(V.field),
            posBefore: V.pos,
        };
    }

    function endChange() {
        const c = V.change;

        if (!c) {
            return false;
        }

        // Inside a macro / :normal the whole run is one undo step: report
        // whether this command changed anything but keep the change open.
        if (V.groupDepth > 0) {
            const now = fieldHtml(c.field);
            const changed = now !== (c.seen === undefined ? c.before : c.seen);

            c.seen = now;
            return changed;
        }

        V.change = null;

        const after = fieldHtml(c.field);

        if (after === c.before) {
            return false;
        }

        c.after = after;
        c.posAfter = V.pos;
        V.lastChangePos = { field: c.field, pos: V.pos };
        V.undo.push(c);
        V.redo.length = 0;

        if (V.undo.length > 500) {
            V.undo.shift();
        }

        return true;
    }

    function stepHistory(command, field, target) {
        let prev = fieldHtml(field);

        for (let i = 0; i < 400; i++) {
            exec(command);

            const html = fieldHtml(field);

            if (html === target) {
                return true;
            }

            if (html === prev) {
                return false;
            }

            prev = html;
        }

        return false;
    }

    // Last resort: put the remembered content back wholesale. Still an
    // ordinary edit, so Anki saves it and Ctrl+Z can step over it.
    function restoreSnapshot(field, html) {
        const sel = getSel(field);

        sel.selectAllChildren(field);

        if (html === "") {
            exec("delete");
        } else {
            exec("insertHTML", html);
        }
    }

    function undoRedo(isUndo, count) {
        const from = isUndo ? V.undo : V.redo;
        const to = isUndo ? V.redo : V.undo;
        const command = isUndo ? "undo" : "redo";
        let moved = false;

        for (let n = 0; n < count; n++) {
            const rec = from.pop();

            if (!rec) {
                if (n === 0) {
                    // Nothing recorded by us: fall back to one native step
                    // (e.g. text typed before vim mode touched the field).
                    exec(command);
                    showMessage(
                        isUndo
                            ? "Already at oldest vim change"
                            : "Already at newest vim change",
                    );
                }

                break;
            }

            const current = isUndo ? rec.after : rec.before;
            const target = isUndo ? rec.before : rec.after;

            if (!rec.field.isConnected || fieldHtml(rec.field) !== current) {
                // The field was changed behind our back (new note loaded,
                // toolbar edit, ...). Our records no longer apply.
                V.undo.length = 0;
                V.redo.length = 0;
                exec(command);
                break;
            }

            if (rec.field !== V.field) {
                focusField(rec.field);
            }

            // The browser's history is exact when it works, but it cannot
            // follow Anki's MathJax decoration; verify, else restore.
            const framed = FRAMED.test(rec.before + rec.after);

            if (framed || !stepHistory(command, rec.field, target)) {
                restoreSnapshot(rec.field, target);

                const actual = fieldHtml(rec.field);

                if (actual !== target) {
                    // The browser normalised the markup slightly: keep the
                    // neighbouring records consistent with what is there.
                    const neighbour = from[from.length - 1];

                    if (isUndo) {
                        rec.before = actual;

                        if (neighbour && neighbour.after === target) {
                            neighbour.after = actual;
                        }
                    } else {
                        rec.after = actual;

                        if (neighbour && neighbour.before === target) {
                            neighbour.before = actual;
                        }
                    }
                }
            }

            to.push(rec);
            V.pos = rec.posBefore;
            moved = true;
        }

        V.stamp = null;

        const m = remodel();

        if (m) {
            if (!moved && m.caret !== null) {
                V.pos = m.caret;
            }

            V.pos = T.clampNormal(m.text, V.pos);
            V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
            placeCursor();
        }
    }

    // ======================================================================
    // Key names and command grammar
    // ======================================================================

    const NAMED_KEYS = {
        Escape: "<Esc>",
        Enter: "<CR>",
        Backspace: "<BS>",
        Delete: "<Del>",
        ArrowLeft: "<Left>",
        ArrowRight: "<Right>",
        ArrowUp: "<Up>",
        ArrowDown: "<Down>",
        Home: "<Home>",
        End: "<End>",
    };
    const IGNORED_KEYS = new Set([
        "Shift",
        "Control",
        "Alt",
        "Meta",
        "CapsLock",
        "Dead",
        "Process",
        "Unidentified",
        "AltGraph",
        "NumLock",
        "ScrollLock",
        "OS",
        "Hyper",
        "Super",
        "Compose",
    ]);
    // Ctrl keys vim mode takes in normal/visual mode. Everything else with
    // Ctrl goes to Anki (Ctrl+B, Ctrl+Enter, Ctrl+V paste, ...) unless the
    // user opted into the full set with the vim_ctrl_keys option.
    const BASE_CTRL = new Set(["<C-r>", "<C-[>", "<C-q>"]);
    const EXTRA_CTRL = new Set(
        "<C-v> <C-a> <C-x> <C-d> <C-u> <C-f> <C-b> <C-o> <C-i>".split(" "),
    );

    function ctrlHandled(key) {
        return BASE_CTRL.has(key) || (config.vim_ctrl_keys && EXTRA_CTRL.has(key));
    }
    const PASS = "<pass>";

    function keyName(event) {
        const k = event.key;

        if (!k || IGNORED_KEYS.has(k)) {
            return null;
        }

        if (event.metaKey) {
            return PASS;
        }

        // Ctrl+Alt together is AltGr on Windows keyboard layouts.
        if (event.ctrlKey && !event.altKey) {
            return k.length === 1 ? "<C-" + k.toLowerCase() + ">" : PASS;
        }

        if (event.altKey && !event.ctrlKey) {
            return PASS;
        }

        if (k.length === 1) {
            return k;
        }

        return NAMED_KEYS[k] || PASS;
    }

    const OPERATORS = new Set(
        "d c y gu gU g~ > < gc gC".split(" "),
    );
    const MOTIONS = new Set(
        (
            "h l j k w W b B e E ge gE 0 ^ $ g_ gg G f F t T ; , { } % | " +
            "n N * # + - _ gj gk <CR> <BS> <Left> <Right> <Up> <Down> " +
            "<Home> <End> ( ) ` ' H M L <C-d> <C-u> <C-f> <C-b>"
        )
            .split(" ")
            .concat([" "]),
    );
    const CHAR_ARG = new Set(["f", "F", "t", "T", "`", "'"]);
    const JUMP_MOTIONS = new Set(
        "gg G n N * # % { } ( ) ` ' H M L".split(" "),
    );
    const OBJECT_TYPES = new Set(
        "w W \" ' ` ( ) b [ ] { } B < > p c s".split(" "),
    );
    const NORMAL_ACTIONS = new Set(
        (
            "i a I A o O x X s S D C Y p P u . v V r ~ J K gJ gv : / ? " +
            "<C-r> <Del> <Esc> <C-[> ZZ ZQ R q @ m gi & g& zz zt zb " +
            "<C-q> <C-v> <C-a> <C-x> <C-o> <C-i> gp gP"
        ).split(" "),
    );
    const VISUAL_ACTIONS = new Set(
        (
            "d x X D y Y c s C S R u U ~ gu gU g~ J gJ p P r o v V : " +
            "<Del> <Esc> <C-[> > < gc gC I A <C-q> <C-v>"
        ).split(" "),
    );
    const PREFIX_KEYS = new Set(["g", "Z", "z"]);
    // Normal-mode commands followed by one more character.
    const ARG_ACTIONS = new Set(["r", "m", "@", "q"]);

    const INCOMPLETE = { status: "incomplete" };
    const INVALID = { status: "invalid" };

    function parse(keys, visual) {
        const cmd = {
            reg: null,
            count: null,
            op: null,
            self: false,
            motion: null,
            obj: null,
            action: null,
            arg: null,
        };
        let i = 0;
        let c1 = "";
        let c2 = "";

        while (keys[i] === '"') {
            if (i + 1 >= keys.length) {
                return INCOMPLETE;
            }

            if (!/^[a-zA-Z0-9+*_".:\/-]$/.test(keys[i + 1])) {
                return INVALID;
            }

            cmd.reg = keys[i + 1] === '"' ? null : keys[i + 1];
            i += 2;
        }

        while (
            i < keys.length &&
            /^[0-9]$/.test(keys[i]) &&
            !(c1 === "" && keys[i] === "0")
        ) {
            c1 += keys[i++];
        }

        if (i >= keys.length) {
            return INCOMPLETE;
        }

        let k = keys[i++];

        if (PREFIX_KEYS.has(k)) {
            if (i >= keys.length) {
                return INCOMPLETE;
            }

            k += keys[i++];
        }

        function readArg() {
            if (i >= keys.length) {
                return INCOMPLETE;
            }

            const a = keys[i++];

            if (a.length !== 1) {
                return INVALID;
            }

            cmd.arg = a;
            return null;
        }

        function finish() {
            if (i < keys.length) {
                return INVALID;
            }

            if (c1 || c2) {
                cmd.count =
                    (c1 ? parseInt(c1, 10) : 1) * (c2 ? parseInt(c2, 10) : 1);
            }

            return { status: "done", cmd };
        }

        function readObject(around) {
            if (i >= keys.length) {
                return INCOMPLETE;
            }

            const type = keys[i++];

            if (!OBJECT_TYPES.has(type)) {
                return INVALID;
            }

            cmd.obj = { around, type };
            return null;
        }

        if (visual) {
            if (k === "i" || k === "a") {
                return readObject(k === "a") || finish();
            }

            if (VISUAL_ACTIONS.has(k)) {
                cmd.action = k;

                if (k === "r") {
                    return readArg() || finish();
                }

                return finish();
            }
        } else if (OPERATORS.has(k)) {
            cmd.op = k;

            while (
                i < keys.length &&
                /^[0-9]$/.test(keys[i]) &&
                !(c2 === "" && keys[i] === "0")
            ) {
                c2 += keys[i++];
            }

            if (i >= keys.length) {
                return INCOMPLETE;
            }

            let m = keys[i++];

            if (m === "<Esc>" || m === "<C-[>") {
                return INVALID;
            }

            // dv{motion}: flip the motion between inclusive and exclusive.
            if (m === "v") {
                if (i >= keys.length) {
                    return INCOMPLETE;
                }

                cmd.flip = true;
                m = keys[i++];
            }

            // d/pattern<CR>: the pattern is typed in the command line.
            if (m === "/" || m === "?") {
                cmd.motion = m;
                return finish();
            }

            if (PREFIX_KEYS.has(m)) {
                if (i >= keys.length) {
                    return INCOMPLETE;
                }

                m += keys[i++];
            }

            // dd, cc, yy, guu, gUU, g~~ (and gugu, gUgU, g~g~).
            if (m === k || (k.length === 2 && m === k[1])) {
                cmd.self = true;
                return finish();
            }

            if (m === "i" || m === "a") {
                return readObject(m === "a") || finish();
            }

            if (!MOTIONS.has(m)) {
                return INVALID;
            }

            cmd.motion = m;

            if (CHAR_ARG.has(m)) {
                return readArg() || finish();
            }

            return finish();
        } else if (NORMAL_ACTIONS.has(k)) {
            cmd.action = k;

            // A second q stops a recording and takes no register name.
            if (ARG_ACTIONS.has(k) && !(k === "q" && V.recording)) {
                return readArg() || finish();
            }

            return finish();
        }

        if (MOTIONS.has(k)) {
            cmd.motion = k;

            if (CHAR_ARG.has(k)) {
                return readArg() || finish();
            }

            return finish();
        }

        return INVALID;
    }

    // ======================================================================
    // Motions
    // ======================================================================

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function displayLineMove(m, pos, delta) {
        const sel = getSel(m.root);

        setSel(m, pos, pos);

        for (let i = 0; i < Math.abs(delta); i++) {
            sel.modify("move", delta > 0 ? "forward" : "backward", "line");
        }

        const m2 = remodel();

        return m2.caret === null ? pos : m2.caret;
    }

    // Returns { pos, inc, lw, col, keepCol } or null when the motion fails.
    function computeMotion(name, arg, ctx) {
        const { text, pos, count: n, hasCount, forOp } = ctx;
        const len = text.length;
        const ls = T.lineStart(text, pos);
        const le = T.lineEnd(text, pos);

        switch (name) {
            case "h":
            case "<Left>":
            case "<BS>":
                return pos === ls ? null : { pos: Math.max(ls, pos - n) };

            case "l":
            case "<Right>":
            case " ":
                return {
                    pos: Math.min(forOp ? le : T.lineLast(text, pos), pos + n),
                };

            case "j":
            case "<Down>":
            case "k":
            case "<Up>": {
                const down = name === "j" || name === "<Down>";

                if (config.jk_display_lines && !forOp) {
                    return {
                        pos: displayLineMove(V.model, pos, down ? n : -n),
                    };
                }

                const p = T.moveLines(text, pos, down ? n : -n, V.desiredCol);

                if (T.lineStart(text, p) === ls) {
                    return null;
                }

                return { pos: p, lw: true, keepCol: true };
            }

            case "gj":
            case "gk":
                if (forOp) {
                    return null;
                }

                return {
                    pos: displayLineMove(V.model, pos, name === "gj" ? n : -n),
                };

            case "w":
            case "W": {
                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.wordForward(text, p, name === "W");
                }

                if (forOp && p < len) {
                    // An operator never eats the line break after the last
                    // word of a line ("dw" on the last word stops at EOL).
                    const pls = T.lineStart(text, p);

                    if (
                        pls > ls &&
                        pls - 1 > pos &&
                        text.slice(pls, p).trim() === ""
                    ) {
                        p = pls - 1;
                    }
                }

                return { pos: p };
            }

            case "e":
            case "E": {
                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.wordEnd(text, p, name === "E");
                }

                return { pos: p, inc: true };
            }

            case "b":
            case "B": {
                if (pos === 0) {
                    return null;
                }

                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.wordBack(text, p, name === "B");
                }

                return { pos: p };
            }

            case "ge":
            case "gE": {
                if (pos === 0) {
                    return null;
                }

                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.wordEndBack(text, p, name === "gE");
                }

                return { pos: p, inc: true };
            }

            case "0":
            case "<Home>":
                return { pos: ls };

            case "^":
                return { pos: T.firstNonBlank(text, pos) };

            case "_": {
                const p = T.moveLines(text, pos, n - 1, 0);
                return { pos: T.firstNonBlank(text, p), lw: true };
            }

            case "$":
            case "<End>": {
                const p = n > 1 ? T.moveLines(text, pos, n - 1, 0) : pos;

                return {
                    pos: forOp ? T.lineEnd(text, p) : T.lineLast(text, p),
                    col: Infinity,
                };
            }

            case "g_": {
                let i = le;

                while (i > ls && T.isBlankChar(text[i - 1])) {
                    i--;
                }

                return { pos: Math.max(ls, i - 1), inc: i > ls };
            }

            case "gg": {
                const s = T.lineStartOf(text, (hasCount ? n : 1) - 1);
                return { pos: T.firstNonBlank(text, s), lw: true };
            }

            case "G": {
                const s = hasCount
                    ? T.lineStartOf(text, n - 1)
                    : T.lineStart(text, len);
                return { pos: T.firstNonBlank(text, s), lw: true };
            }

            case "f":
            case "F":
            case "t":
            case "T": {
                const p = T.findChar(text, pos, arg, name, n, false);

                V.lastFind = { type: name, ch: arg };

                if (p < 0) {
                    return null;
                }

                return { pos: p, inc: name === "f" || name === "t" };
            }

            case ";":
            case ",": {
                const lf = V.lastFind;

                if (!lf) {
                    return null;
                }

                let type = lf.type;

                if (name === ",") {
                    type =
                        type === type.toLowerCase()
                            ? type.toUpperCase()
                            : type.toLowerCase();
                }

                const p = T.findChar(text, pos, lf.ch, type, n, true);

                if (p < 0) {
                    return null;
                }

                return { pos: p, inc: type === "f" || type === "t" };
            }

            case "}": {
                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.paragraphForward(text, p);
                }

                return { pos: p };
            }

            case "{": {
                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.paragraphBack(text, p);
                }

                return { pos: p };
            }

            case "%": {
                const p = T.matchPair(text, pos);
                return p < 0 ? null : { pos: p, inc: true };
            }

            case ")":
            case "(": {
                let p = pos;

                for (let i = 0; i < n; i++) {
                    p =
                        name === ")"
                            ? T.sentenceForward(text, p)
                            : T.sentenceBack(text, p);
                }

                return { pos: p };
            }

            case "`":
            case "'": {
                const mark = getMark(arg);

                if (!mark || !mark.field || !mark.field.isConnected) {
                    showMessage("E20: Mark not set");
                    return null;
                }

                if (mark.field !== V.field) {
                    // Marks can point into another field of the note.
                    if (forOp) {
                        return null;
                    }

                    return {
                        pos: mark.pos,
                        field: mark.field,
                        line: name === "'",
                    };
                }

                const p = T.clamp(mark.pos, 0, len);

                return name === "'"
                    ? { pos: T.firstNonBlank(text, p), lw: true }
                    : { pos: p };
            }

            case "H":
                return { pos: T.firstNonBlank(text, 0), lw: true };

            case "L":
                return {
                    pos: T.firstNonBlank(text, T.lineStart(text, len)),
                    lw: true,
                };

            case "M": {
                const mid = Math.floor((T.lineCount(text) - 1) / 2);

                return {
                    pos: T.firstNonBlank(text, T.lineStartOf(text, mid)),
                    lw: true,
                };
            }

            case "<C-d>":
            case "<C-u>":
            case "<C-f>":
            case "<C-b>": {
                const step = name === "<C-d>" || name === "<C-u>" ? 8 : 16;
                const down = name === "<C-d>" || name === "<C-f>";
                const p = T.moveLines(
                    text,
                    pos,
                    (down ? 1 : -1) * step * n,
                    V.desiredCol,
                );

                if (p === pos) {
                    return null;
                }

                return { pos: p, lw: true, keepCol: true };
            }

            case "|":
                return {
                    pos: Math.min(ls + n - 1, forOp ? le : T.lineLast(text, pos)),
                };

            case "<CR>":
            case "+":
            case "-": {
                const p = T.moveLines(text, pos, name === "-" ? -n : n, 0);

                if (T.lineStart(text, p) === ls) {
                    return null;
                }

                return { pos: T.firstNonBlank(text, p), lw: true };
            }

            case "n":
            case "N": {
                const s = V.lastSearch;

                if (!s) {
                    showMessage("E35: No previous search");
                    return null;
                }

                const forward = name === "n" ? s.forward : !s.forward;
                const p = T.search(text, s.pattern, pos, forward, n);

                if (p < 0) {
                    showMessage("E486: Pattern not found: " + s.pattern);
                    return null;
                }

                return { pos: p };
            }

            case "*":
            case "#": {
                const w = T.wordObject(text, pos, false);
                const word = text.slice(w.start, w.end);

                if (!word.trim()) {
                    return null;
                }

                const bounded = /^[\p{L}\p{N}_]+$/u.test(word);
                const pattern = bounded
                    ? "\\b" + escapeRegex(word) + "\\b"
                    : escapeRegex(word);

                V.lastSearch = { pattern, forward: name === "*" };

                const p = T.search(text, pattern, w.start, name === "*", n);

                return p < 0 ? null : { pos: p };
            }
        }

        return null;
    }

    function getMark(name) {
        if (name === "`" || name === "'") {
            return V.marks["`"] || null;
        }

        if (name === "<" || name === ">") {
            const lv = V.lastVisual;

            if (!lv) {
                return null;
            }

            return {
                field: lv.field || V.field,
                pos:
                    name === "<"
                        ? Math.min(lv.anchor, lv.pos)
                        : Math.max(lv.anchor, lv.pos),
            };
        }

        if (name === ".") {
            return V.lastChangePos;
        }

        if (name === "^") {
            return V.lastInsertPos;
        }

        return V.marks[name] || null;
    }

    // Remember where we were before a long jump (`` returns there).
    function setJump() {
        if (!V.field) {
            return;
        }

        const here = { field: V.field, pos: V.pos };
        const last = V.jumps[V.jumpIdx - 1];

        V.marks["`"] = here;
        V.jumps.length = Math.min(V.jumps.length, V.jumpIdx);

        if (!last || last.field !== here.field || last.pos !== here.pos) {
            V.jumps.push(here);
        }

        if (V.jumps.length > 50) {
            V.jumps.shift();
        }

        V.jumpIdx = V.jumps.length;
    }

    function jumpBy(delta) {
        if (delta < 0 && V.jumpIdx >= V.jumps.length) {
            // Leaving the newest position: remember it so Ctrl-i can return.
            V.jumps.push({ field: V.field, pos: V.pos });
        }

        const idx = T.clamp(V.jumpIdx + delta, 0, V.jumps.length - 1);
        const target = V.jumps[idx];

        if (!target || !target.field || !target.field.isConnected) {
            return;
        }

        V.jumpIdx = idx;

        if (target.field !== V.field) {
            focusField(target.field, target.pos);
        } else {
            V.pos = T.clampNormal(V.model.text, target.pos);
            V.desiredCol = V.pos - T.lineStart(V.model.text, V.pos);
        }
    }

    function motionContext(m, cmd, forOp) {
        return {
            text: m.text,
            pos: V.pos,
            count: cmd.count || 1,
            hasCount: cmd.count !== null,
            forOp,
        };
    }

    function linesRange(text, pos, count) {
        const last = T.moveLines(text, pos, count - 1, 0);

        return {
            start: T.lineStart(text, pos),
            end: T.lineEnd(text, last),
            lw: true,
        };
    }

    function objectRange(text, pos, obj) {
        const a = obj.around;
        let r = null;

        switch (obj.type) {
            case "w":
                r = T.wordObject(text, pos, a, false);
                break;
            case "W":
                r = T.wordObject(text, pos, a, true);
                break;
            case '"':
            case "'":
            case "`":
                r = T.quoteObject(text, pos, obj.type, a);
                break;
            case "(":
            case ")":
            case "b":
                r = T.pairObject(text, pos, "(", ")", a);
                break;
            case "[":
            case "]":
                r = T.pairObject(text, pos, "[", "]", a);
                break;
            case "{":
            case "}":
            case "B":
                r = T.pairObject(text, pos, "{", "}", a);
                break;
            case "<":
            case ">":
                r = T.pairObject(text, pos, "<", ">", a);
                break;
            case "c":
                r = T.clozeObject(text, pos, a);
                break;
            case "s":
                r = T.sentenceObject(text, pos, a);
                break;
            case "p":
                r = T.paragraphObject(text, pos, a);
                return r ? { start: r.start, end: r.end, lw: true } : null;
        }

        return r ? { start: r.start, end: r.end, lw: false } : null;
    }

    function operatorRange(m, cmd) {
        const text = m.text;
        const pos = V.pos;

        if (cmd.self) {
            return linesRange(text, pos, cmd.count || 1);
        }

        if (cmd.obj) {
            return objectRange(text, pos, cmd.obj);
        }

        let name = cmd.motion;

        // cw on a word behaves like ce: it leaves the following space alone.
        if (
            cmd.op === "c" &&
            (name === "w" || name === "W") &&
            pos < text.length &&
            !T.isBlankChar(text[pos])
        ) {
            name = name === "w" ? "e" : "E";

            // ...but a count of 1 on a one-character word must not jump to
            // the end of the *next* word.
            const one = T.wordObject(text, pos, false, name === "E");

            if ((cmd.count || 1) === 1 && one.end - 1 === pos) {
                return { start: pos, end: pos + 1, lw: false };
            }
        }

        const r = computeMotion(name, cmd.arg, motionContext(m, cmd, true));

        if (!r) {
            return null;
        }

        return motionToRange(text, pos, r, cmd.flip);
    }

    function motionToRange(text, pos, r, flip) {
        const a = Math.min(pos, r.pos);
        let b = Math.max(pos, r.pos);

        if (r.lw) {
            return {
                start: T.lineStart(text, a),
                end: T.lineEnd(text, b),
                lw: true,
            };
        }

        const inclusive = flip ? !r.inc : !!r.inc;

        // Vim's rule for an exclusive motion that ends at the start of a
        // line: stop at the end of the previous line instead, and if it also
        // started at/before the first non-blank, work on whole lines.
        if (!inclusive && !flip && b > a && text[b - 1] === "\n") {
            if (text.slice(T.lineStart(text, a), a).trim() === "") {
                return { start: T.lineStart(text, a), end: b - 1, lw: true };
            }

            b = b - 1;
        }

        return {
            start: a,
            end: Math.min(inclusive ? b + 1 : b, text.length),
            lw: false,
        };
    }

    // ======================================================================
    // Operators
    // ======================================================================

    function deleteLines(range) {
        const text = V.model.text;
        const len = text.length;
        let m;

        if (range.end < len) {
            m = deleteRange(range.start, range.end + 1);
            V.pos = T.firstNonBlank(m.text, Math.min(range.start, m.text.length));
        } else if (range.start > 0) {
            m = deleteRange(range.start - 1, range.end);
            V.pos = T.firstNonBlank(m.text, m.text.length);
        } else {
            m = deleteRange(range.start, range.end);
            V.pos = 0;
        }

        return m;
    }

    function transformRange(range, fn) {
        const text = V.model.text;
        const runs = [];
        let s = -1;

        for (let i = range.start; i <= range.end; i++) {
            const plain =
                i < range.end && text[i] !== "\n" && text[i] !== ATOM;

            // Replace one text node at a time so formatting is untouched.
            if (
                plain &&
                s !== -1 &&
                V.model.chars[i].n !== V.model.chars[i - 1].n
            ) {
                runs.push([s, i]);
                s = i;
            }

            if (plain && s === -1) {
                s = i;
            } else if (!plain && s !== -1) {
                runs.push([s, i]);
                s = -1;
            }
        }

        for (let r = runs.length - 1; r >= 0; r--) {
            const [a, b] = runs[r];
            const before = V.model.text.slice(a, b);
            const after = fn(before);

            if (after !== before) {
                replaceRange(a, b, after);
            }
        }
    }

    function applyOperator(op, range, reg) {
        const m = V.model;

        switch (op) {
            case "y": {
                setRegister(reg, captureRange(m, range), "yank");

                if (!range.lw || isVisual()) {
                    V.pos = range.start;
                } else if (T.lineStart(m.text, V.pos) !== range.start) {
                    // yk / yip: up to the first yanked line, same column.
                    V.pos = Math.min(
                        range.start + (V.pos - T.lineStart(m.text, V.pos)),
                        T.lineLast(m.text, range.start),
                    );
                }

                const lines = range.lw
                    ? T.lineIndex(m.text, range.end) -
                      T.lineIndex(m.text, range.start) +
                      1
                    : 0;

                if (lines > 2) {
                    showMessage(lines + " lines yanked");
                }

                break;
            }

            case "d":
                if (range.start === range.end && !range.lw) {
                    break;
                }

                setRegister(reg, captureRange(m, range), "delete");

                if (range.lw) {
                    deleteLines(range);
                } else {
                    deleteRange(range.start, range.end);
                    V.pos = range.start;
                }

                break;

            case "c":
                if (range.start < range.end) {
                    setRegister(reg, captureRange(m, range), "delete");
                    deleteRange(range.start, range.end);
                }

                enterInsert(range.start);
                return;

            case "gu":
                transformRange(range, (s) => s.toLowerCase());
                V.pos = range.start;
                break;

            case "gU":
                transformRange(range, (s) => s.toUpperCase());
                V.pos = range.start;
                break;

            case "g~":
                transformRange(range, T.toggleCase);
                V.pos = range.start;
                break;

            case ">":
            case "<": {
                // Uses the editor's own indent/outdent (same as Anki's
                // toolbar buttons): nests list items, indents paragraphs.
                const line = T.lineIndex(m.text, range.start);
                const last = Math.max(
                    range.start,
                    range.lw ? range.end : range.end - 1,
                );

                setSel(m, T.lineStart(m.text, range.start), T.lineEnd(m.text, last));
                exec(op === ">" ? "indent" : "outdent");

                const m2 = remodel();

                V.pos = T.firstNonBlank(m2.text, T.lineStartOf(m2.text, line));
                break;
            }

            case "gc":
            case "gC": {
                // Wrap in a cloze deletion: gc = new number, gC = same number.
                let a = range.start;
                let b = range.end;

                while (b > a && T.isBlankChar(m.text[b - 1])) {
                    b--;
                }

                while (a < b && T.isBlankChar(m.text[a])) {
                    a++;
                }

                if (a >= b) {
                    break;
                }

                const number = nextClozeNumber(op === "gc");

                setSel(m, b, b);
                typeText("}}");
                remodel();
                setSel(V.model, a, a);
                typeText("{{c" + number + "::");
                remodel();
                V.pos = a;
                break;
            }
        }

        V.mode = "normal";
        V.pos = T.clampNormal(V.model.text, V.pos);
    }

    function nextClozeNumber(fresh) {
        let max = 0;

        for (const field of allFields()) {
            for (const match of (field.textContent || "").matchAll(
                /\{\{c(\d+)::/g,
            )) {
                max = Math.max(max, parseInt(match[1], 10));
            }
        }

        return fresh ? max + 1 : Math.max(max, 1);
    }

    function insertLines(lines, htmlLines) {
        if (htmlLines && htmlLines.some((h) => h !== null)) {
            exec(
                "insertHTML",
                lines
                    .map((line, i) =>
                        htmlLines[i] !== null && htmlLines[i] !== undefined
                            ? htmlLines[i]
                            : escapeHtml(line),
                    )
                    .join("<br>"),
            );
        } else {
            typeText(lines.join("\n"));
        }
    }

    function paste(before, count, regName) {
        const r = getRegister(regName);

        if (!r || !r.text) {
            showMessage("E353: Nothing in register " + (regName || '"'));
            return;
        }

        pasteData(r, before, count);
    }

    function pasteData(r, before, count) {
        const m = V.model;
        const text = m.text;
        const pos = V.pos;

        if (r.block) {
            // Blockwise: each yanked row goes onto its own line at the
            // cursor column, adding lines / padding where the text is short.
            const rows = r.text.split("\n");
            const empty = T.lineEnd(text, pos) === T.lineStart(text, pos);
            const col =
                (before || empty ? pos : pos + 1) - T.lineStart(text, pos);
            const first = T.lineIndex(text, pos);
            const missing = first + rows.length - T.lineCount(text);

            if (missing > 0) {
                setSel(m, text.length, text.length);
                typeText("\n".repeat(missing));
                remodel();
            }

            for (let i = rows.length - 1; i >= 0; i--) {
                const t = V.model.text;
                const s = T.lineStartOf(t, first + i);
                const e = T.lineEnd(t, s);
                const pad = s + col > e ? " ".repeat(s + col - e) : "";
                const at = Math.min(s + col, e);

                setSel(V.model, at, at);
                typeText(pad + rows[i].repeat(count));
                remodel();
            }

            V.pos = T.lineStartOf(V.model.text, first) + col;
            return;
        }

        if (r.linewise) {
            const one = r.text.replace(/\n$/, "").split("\n");
            const oneHtml =
                r.htmlLines && r.htmlLines.length === one.length
                    ? r.htmlLines
                    : null;
            let lines = [];
            let htmlLines = oneHtml ? [] : null;

            for (let i = 0; i < count; i++) {
                lines = lines.concat(one);

                if (htmlLines) {
                    htmlLines = htmlLines.concat(oneHtml);
                }
            }

            if (before) {
                const ls = T.lineStart(text, pos);

                setSel(m, ls, ls);
                insertLines(lines, htmlLines);
                exec("insertLineBreak");

                const after = remodel();

                V.pasteEnd = after.caret;
                V.pos = T.firstNonBlank(after.text, ls);
            } else {
                const le = T.lineEnd(text, pos);

                setSel(m, le, le);
                exec("insertLineBreak");
                insertLines(lines, htmlLines);

                const after = remodel();
                const end = after.caret === null ? le + 1 : after.caret;

                V.pasteEnd = Math.min(T.lineEnd(after.text, end) + 1, after.text.length);
                V.pos = T.firstNonBlank(after.text, le + 1);
            }

            return;
        }

        const lineEmpty = T.lineEnd(text, pos) === T.lineStart(text, pos);
        const at = before || lineEmpty ? pos : pos + 1;

        setSel(m, at, at);

        for (let i = 0; i < count; i++) {
            if (r.html) {
                exec("insertHTML", r.html);
            } else {
                typeText(r.text);
            }
        }

        const m2 = remodel();
        const caret = m2.caret === null ? at + r.text.length * count : m2.caret;

        V.pasteEnd = caret;
        // One line of text: cursor on its last character. Several lines:
        // cursor stays at the start, like vim.
        V.pos = r.text.includes("\n") ? at : Math.max(at, caret - 1);
    }

    function joinLines(count) {
        const times = Math.max(1, count - 1);

        for (let i = 0; i < times; i++) {
            const text = V.model.text;
            const le = T.lineEnd(text, V.pos);

            if (le >= text.length) {
                break;
            }

            let next = le + 1;

            while (
                next < text.length &&
                (text[next] === " " || text[next] === "\t")
            ) {
                next++;
            }

            const nextEmpty = next >= text.length || text[next] === "\n";
            const needSpace =
                !nextEmpty &&
                le > T.lineStart(text, V.pos) &&
                !T.isBlankChar(text[le - 1]);

            replaceRange(le, next, needSpace ? " " : "");
            V.pos = needSpace ? le : Math.max(T.lineStart(text, V.pos), le - 1);
        }
    }

    // ======================================================================
    // Insert mode
    // ======================================================================

    // opts: { replace, count, block } - block = { lines, col, pad } repeats
    // the typed text on the other lines of a visual block when leaving.
    function enterInsert(caret, opts) {
        const m = V.model || remodel();

        if (!m) {
            return;
        }

        opts = opts || {};
        beginChange();
        caret = T.clamp(caret, 0, m.text.length);
        setSel(m, caret, caret);
        V.mode = opts.replace ? "replace" : "insert";
        V.insert = {
            text: m.text,
            pos: caret,
            count: opts.count || 1,
            block: opts.block || null,
        };
        V.replaceStack = [];
        V.replaceTyped = "";
        V.insertReg = false;
        V.escapeArmed = 0;
        updateStatus();
        queueDraw();
    }

    function replicateBlockInsert(block, typed) {
        const lines = block.lines.slice().sort((x, y) => y - x);

        for (const line of lines) {
            const t = V.model.text;

            if (line >= T.lineCount(t)) {
                continue;
            }

            const s = T.lineStartOf(t, line);
            const e = T.lineEnd(t, s);
            let at;
            let ins = typed;

            if (block.col === Infinity) {
                at = e;
            } else if (s + block.col <= e) {
                at = s + block.col;
            } else if (block.pad) {
                ins = " ".repeat(s + block.col - e) + typed;
                at = e;
            } else {
                continue;
            }

            setSel(V.model, at, at);
            typeText(ins);
            remodel();
        }
    }

    function exitInsert() {
        if (!inInsert()) {
            return;
        }

        const wasReplace = V.mode === "replace";
        const field = activeField() || V.field;

        V.field = field;

        let m = remodel();
        const session = V.insert;
        let inserted = "";

        V.insert = null;
        V.mode = "normal";

        if (m) {
            let caret = m.caret === null ? V.pos : m.caret;

            if (wasReplace) {
                inserted = V.replaceTyped;
            } else if (
                session &&
                caret >= session.pos &&
                m.text.length - session.text.length === caret - session.pos
            ) {
                inserted = m.text.slice(session.pos, caret);
            }

            const simple = inserted && !inserted.includes("\n");

            // 3ihello<Esc> types it three times.
            if (!wasReplace && session && session.count > 1 && simple) {
                typeText(inserted.repeat(session.count - 1));
                m = remodel();
                caret = m.caret === null ? caret : m.caret;
            }

            V.lastInsertPos = { field, pos: caret };
            V.pos = caret > T.lineStart(m.text, caret) ? caret - 1 : caret;

            if (session && session.block && simple) {
                replicateBlockInsert(session.block, inserted);
                m = V.model;
            }

            if (session && session.block && session.block.home !== undefined) {
                V.pos = session.block.home;
            }

            V.pos = T.clampNormal(m.text, V.pos);
            V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
        }

        V.lastInserted = inserted;
        endChange();

        if (V.pendingDot && !V.replaying) {
            V.lastChange = { keys: V.pendingDot, text: inserted };
        }

        if (V.recording && !V.playing && !V.replaying) {
            // Typed text is recorded as a whole; replace-mode keys were
            // already recorded one by one.
            if (!wasReplace && inserted) {
                V.recording.items.push({ i: inserted });
            }

            V.recording.items.push({ k: "<Esc>" });
        }

        V.pendingDot = null;
        placeCursor();
        updateStatus();
    }

    // Replace mode (R): typed characters overwrite; Backspace restores.
    function replaceChar(ch) {
        const m = remodel();

        if (!m || m.caret === null) {
            return;
        }

        const c = m.caret;
        const t = m.text;
        const atEnd = c >= t.length || t[c] === "\n" || t[c] === ATOM;

        V.replaceStack.push(atEnd ? null : t[c]);
        V.replaceTyped += ch;

        if (atEnd) {
            setSel(m, c, c);
            exec("insertText", ch);
        } else {
            replaceRange(c, c + 1, ch);
        }
    }

    function replaceBackspace() {
        const m = remodel();

        if (!m || m.caret === null || m.caret === 0) {
            return;
        }

        const c = m.caret;

        if (V.replaceStack.length === 0) {
            if (m.text[c - 1] !== "\n") {
                setSel(m, c - 1, c - 1);
            }

            return;
        }

        const original = V.replaceStack.pop();

        V.replaceTyped = V.replaceTyped.slice(0, -1);

        if (original === null) {
            deleteRange(c - 1, c);
        } else {
            replaceRange(c - 1, c, original);
            setSel(V.model, c - 1, c - 1);
        }
    }

    // Returns true when the key was consumed.
    function replaceKey(key) {
        if (key === "<Esc>" || key === "<C-[>") {
            exitInsert();
            return true;
        }

        if (key.length === 1) {
            replaceChar(key);
            return true;
        }

        if (key === "<BS>") {
            replaceBackspace();
            return true;
        }

        return false;
    }

    // ======================================================================
    // Macros
    // ======================================================================

    function recordKey(key) {
        if (V.recording && !V.playing) {
            V.recording.items.push({ k: key });
        }
    }

    // Feed a key as if it was typed (macro playback, :normal).
    function dispatchKey(key) {
        if (V.cmdline) {
            cmdlineKey(key);
        } else if (V.mode === "insert") {
            if (key === "<Esc>" || key === "<C-[>") {
                exitInsert();
            } else if (key === "<CR>") {
                typeText("\n");
            } else if (key.length === 1) {
                typeText(key);
            }
        } else if (V.mode === "replace") {
            replaceKey(key);
        } else {
            feedKey(key);
        }
    }

    function tokenizeKeys(str) {
        return (str.match(/<C-.>|<Esc>|<CR>|<BS>|<lt>|[\s\S]/g) || []).map((k) =>
            k === "<lt>" ? "<" : k,
        );
    }

    // Runs fn as one undo step, however many commands it executes.
    function asOneChange(fn) {
        beginChange();
        V.groupDepth++;

        try {
            fn();
        } finally {
            V.groupDepth--;

            if (V.groupDepth === 0 && !inInsert()) {
                endChange();
            }
        }
    }

    function playMacro(reg, count) {
        let items = V.macros[reg];

        if (!items) {
            // Like vim, a register filled by yanking can be executed too.
            const r = V.regs[reg];

            if (r && r.text) {
                items = tokenizeKeys(r.text.replace(/\n$/, "")).map((k) => ({
                    k: k === "\n" ? "<CR>" : k,
                }));
            }
        }

        if (!items) {
            showMessage("E748: No previously used register");
            return;
        }

        if (V.playing > 8) {
            return;
        }

        V.lastMacro = reg;
        V.playing++;

        try {
            asOneChange(() => {
                for (let n = 0; n < count; n++) {
                    for (const item of items.slice()) {
                        if (item.k !== undefined) {
                            dispatchKey(item.k);
                        } else if (inInsert()) {
                            typeText(item.i);
                        }
                    }
                }
            });
        } finally {
            V.playing--;
        }
    }

    // ======================================================================
    // Command execution
    // ======================================================================

    // Shorthand commands expressed as operator + motion.
    const SYNONYMS = {
        x: ["d", "l"],
        "<Del>": ["d", "l"],
        X: ["d", "h"],
        s: ["c", "l"],
        S: ["c", "c"],
        D: ["d", "$"],
        C: ["c", "$"],
        Y: ["y", "y"],
    };

    function setModeNormal() {
        V.mode = "normal";
    }

    function moveCursor(r) {
        if (r.field) {
            focusField(r.field, r.pos);

            if (r.line) {
                V.pos = T.firstNonBlank(V.model.text, V.pos);
            }

            return;
        }

        const m = V.model;

        V.pos = isVisual()
            ? T.clamp(r.pos, 0, Math.max(0, m.text.length - 1))
            : T.clampNormal(m.text, r.pos);

        if (isVisual()) {
            V.pos = T.clampNormal(m.text, V.pos);
        }

        if (r.col !== undefined) {
            V.desiredCol = r.col;
        } else if (!r.keepCol) {
            V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
        }
    }

    function executeNormal(cmd, keys) {
        let m = V.model;
        const count = cmd.count || 1;

        if (cmd.action && SYNONYMS[cmd.action]) {
            const [op, motion] = SYNONYMS[cmd.action];

            cmd = Object.assign({}, cmd, {
                action: null,
                op,
                motion: op === motion ? null : motion,
                self: op === motion,
            });
        }

        if (cmd.op && (cmd.motion === "/" || cmd.motion === "?")) {
            openCmdline(cmd.motion, "");
            V.cmdline.op = { cmd, keys };
            return;
        }

        if (cmd.op) {
            const range = operatorRange(m, cmd);

            if (!range) {
                return;
            }

            const mutating = cmd.op !== "y";

            if (mutating) {
                beginChange();
                V.pendingDot = keys;
            }

            applyOperator(cmd.op, range, cmd.reg);
            V.desiredCol = V.pos - T.lineStart(V.model.text, V.pos);
            return;
        }

        if (cmd.motion) {
            const r = computeMotion(
                cmd.motion,
                cmd.arg,
                motionContext(m, cmd, false),
            );

            if (r) {
                if (JUMP_MOTIONS.has(cmd.motion)) {
                    setJump();
                }

                moveCursor(r);
            }

            return;
        }

        const text = m.text;
        const pos = V.pos;

        switch (cmd.action) {
            case "<Esc>":
            case "<C-[>":
                return;

            case "i":
                V.pendingDot = keys;
                enterInsert(pos, { count });
                return;

            case "a":
                V.pendingDot = keys;
                enterInsert(
                    T.lineEnd(text, pos) > T.lineStart(text, pos)
                        ? pos + 1
                        : pos,
                    { count },
                );
                return;

            case "I":
                V.pendingDot = keys;
                enterInsert(T.firstNonBlank(text, pos), { count });
                return;

            case "A":
                V.pendingDot = keys;
                enterInsert(T.lineEnd(text, pos), { count });
                return;

            case "gi": {
                const last = V.lastInsertPos;

                V.pendingDot = keys;
                enterInsert(last && last.field === V.field ? last.pos : pos);
                return;
            }

            case "R":
                V.pendingDot = keys;
                enterInsert(pos, { replace: true });
                return;

            case "m":
                if (/^[a-zA-Z]$/.test(cmd.arg)) {
                    V.marks[cmd.arg] = { field: V.field, pos };
                }

                return;

            case "q":
                if (V.recording) {
                    const rec = V.recording;
                    const name = rec.reg.toLowerCase();

                    V.recording = null;
                    rec.items.pop(); // the q that stopped the recording
                    V.macros[name] =
                        rec.reg !== name && V.macros[name]
                            ? V.macros[name].concat(rec.items)
                            : rec.items;
                } else if (/^[a-zA-Z0-9]$/.test(cmd.arg)) {
                    V.recording = { reg: cmd.arg, items: [] };
                }

                return;

            case "@": {
                const name = cmd.arg === "@" ? V.lastMacro : cmd.arg.toLowerCase();

                if (name) {
                    playMacro(name, count);
                }

                return;
            }

            case "<C-q>":
            case "<C-v>":
                V.vAnchor = pos;
                V.blockAnchorCol = pos - T.lineStart(text, pos);
                V.desiredCol = V.blockAnchorCol;
                V.mode = "vblock";
                return;

            case "<C-a>":
            case "<C-x>": {
                const num = T.numberAt(text, pos);

                if (!num) {
                    return;
                }

                const value =
                    parseInt(text.slice(num.start, num.end), 10) +
                    (cmd.action === "<C-a>" ? count : -count);

                beginChange();
                V.pendingDot = keys;
                replaceRange(num.start, num.end, String(value));
                V.pos = num.start + String(value).length - 1;
                return;
            }

            case "<C-o>":
                jumpBy(-count);
                return;

            case "<C-i>":
                jumpBy(count);
                return;

            case "&":
            case "g&": {
                if (!V.lastSub) {
                    showMessage("E35: No previous regular expression");
                    return;
                }

                const all = cmd.action === "g&";
                const line = T.lineIndex(text, pos);

                substitute(
                    m,
                    all ? 0 : line,
                    all ? T.lineCount(text) - 1 : line,
                    V.lastSub,
                    "",
                );
                return;
            }

            case "zz":
            case "zt":
            case "zb":
                scrollCursorTo(cmd.action[1]);
                return;

            case "o": {
                const le = T.lineEnd(text, pos);

                V.pendingDot = keys;
                beginChange();
                setSel(m, le, le);
                exec("insertLineBreak");
                m = remodel();
                enterInsert(m.caret === null ? le + 1 : m.caret);
                return;
            }

            case "O": {
                const ls = T.lineStart(text, pos);

                V.pendingDot = keys;
                beginChange();
                setSel(m, ls, ls);
                exec("insertLineBreak");
                remodel();
                enterInsert(ls);
                return;
            }

            case "p":
            case "P":
                beginChange();
                V.pendingDot = keys;
                paste(cmd.action === "P", count, cmd.reg);
                return;

            case "gp":
            case "gP":
                // Like p / P, but leave the cursor just after the new text.
                beginChange();
                V.pendingDot = keys;
                V.pasteEnd = null;
                paste(cmd.action === "gP", count, cmd.reg);

                if (V.pasteEnd !== null) {
                    V.pos = V.pasteEnd;
                }

                return;

            case "u":
                undoRedo(true, count);
                return;

            case "<C-r>":
                undoRedo(false, count);
                return;

            case ".":
                repeatLastChange(cmd.count);
                return;

            case "v":
            case "V":
                V.vAnchor = pos;
                V.mode = cmd.action === "v" ? "visual" : "vline";
                return;

            case "gv":
                if (V.lastVisual) {
                    V.vAnchor = T.clamp(V.lastVisual.anchor, 0, text.length);
                    V.pos = T.clamp(V.lastVisual.pos, 0, text.length);
                    V.mode = V.lastVisual.mode;

                    if (V.mode === "vblock") {
                        V.blockAnchorCol = V.lastVisual.anchorCol || 0;
                        V.desiredCol = V.lastVisual.col || 0;
                    }
                }

                return;

            case "r": {
                const end = pos + count;

                if (
                    end > T.lineEnd(text, pos) ||
                    text.slice(pos, end).includes(ATOM)
                ) {
                    return;
                }

                beginChange();
                V.pendingDot = keys;
                replaceRange(pos, end, cmd.arg.repeat(count));
                V.pos = end - 1;
                return;
            }

            case "~": {
                const end = Math.min(pos + count, T.lineEnd(text, pos));

                if (end <= pos) {
                    return;
                }

                beginChange();
                V.pendingDot = keys;
                transformRange({ start: pos, end }, T.toggleCase);
                V.pos = Math.min(end, T.lineLast(V.model.text, pos));
                return;
            }

            case "J":
            case "K":
                if (config.shift_jk_fields) {
                    moveField(cmd.action === "J" ? 1 : -1);
                    return;
                }

                if (cmd.action === "K") {
                    return;
                }

            // fallthrough: J joins lines when not used for field navigation
            case "gJ":
                beginChange();
                V.pendingDot = keys;
                joinLines(count);
                return;

            case ":":
                openCmdline(":", "");
                return;

            case "/":
            case "?":
                openCmdline(cmd.action, "");
                return;

            case "ZZ":
                sendPython({ cmd: "wq" });
                return;

            case "ZQ":
                sendPython({ cmd: "q" });
                return;
        }
    }

    function executeVisual(cmd) {
        const m = V.model;
        const text = m.text;

        if (cmd.motion) {
            const r = computeMotion(
                cmd.motion,
                cmd.arg,
                motionContext(m, cmd, false),
            );

            if (r) {
                moveCursor(r);
            }

            return;
        }

        if (cmd.obj) {
            const r = objectRange(text, V.pos, cmd.obj);

            if (!r || r.end <= r.start) {
                return;
            }

            if (r.lw) {
                V.mode = "vline";
            }

            const single = V.vAnchor === V.pos;

            V.vAnchor = single ? r.start : Math.min(V.vAnchor, r.start);
            V.pos = single ? r.end - 1 : Math.max(V.pos, r.end - 1);
            return;
        }

        if (V.mode === "vblock") {
            executeBlock(cmd);
            return;
        }

        const range = visualBounds(m);
        const remember = () => {
            V.lastVisual = {
                anchor: V.vAnchor,
                pos: V.pos,
                mode: V.mode,
                field: V.field,
            };
        };
        const linewise = () => ({
            start: T.lineStart(text, range.start),
            end: T.lineEnd(text, Math.max(range.start, range.end - (range.lw ? 0 : 1))),
            lw: true,
        });
        const run = (op, r) => {
            remember();

            if (op !== "y") {
                // Undo puts the cursor back at the start of the change.
                V.pos = r.start;
                beginChange();
            }

            applyOperator(op, r, cmd.reg);

            if (!inInsert()) {
                setModeNormal();
            }
        };

        switch (cmd.action) {
            case "<Esc>":
            case "<C-[>":
                remember();
                setModeNormal();
                V.pos = T.clampNormal(text, V.pos);
                return;

            case "v":
            case "V": {
                const target = cmd.action === "v" ? "visual" : "vline";

                if (V.mode === target) {
                    remember();
                    setModeNormal();
                    V.pos = T.clampNormal(text, V.pos);
                } else {
                    V.mode = target;
                }

                return;
            }

            case "o": {
                const a = V.vAnchor;

                V.vAnchor = V.pos;
                V.pos = a;
                return;
            }

            case "<C-q>":
            case "<C-v>":
                V.mode = "vblock";
                V.blockAnchorCol = V.vAnchor - T.lineStart(text, V.vAnchor);
                V.desiredCol = V.pos - T.lineStart(text, V.pos);
                return;

            case ">":
            case "<":
            case "gc":
            case "gC":
                run(cmd.action, range);
                return;

            case "I":
                remember();
                setModeNormal();
                enterInsert(range.start);
                return;

            case "A":
                remember();
                setModeNormal();
                enterInsert(range.end);
                return;

            case "d":
            case "x":
            case "<Del>":
                run("d", range);
                return;

            case "X":
            case "D":
                run("d", linewise());
                return;

            case "y":
                run("y", range);
                return;

            case "Y":
                run("y", linewise());
                return;

            case "c":
            case "s":
                run("c", range);
                return;

            case "C":
            case "S":
            case "R":
                run("c", linewise());
                return;

            case "u":
            case "gu":
                run("gu", range);
                return;

            case "U":
            case "gU":
                run("gU", range);
                return;

            case "~":
            case "g~":
                run("g~", range);
                return;

            case "J":
            case "gJ": {
                const lines =
                    T.lineIndex(text, range.end) -
                    T.lineIndex(text, range.start) +
                    1;

                remember();
                beginChange();
                setModeNormal();
                V.pos = range.start;
                joinLines(Math.max(2, lines));
                return;
            }

            case "r": {
                remember();
                beginChange();
                setModeNormal();
                transformRange(range, (s) => cmd.arg.repeat(s.length));
                V.pos = range.start;
                return;
            }

            case "p":
            case "P": {
                const r = getRegister(cmd.reg);

                if (!r || !r.text) {
                    showMessage("E353: Nothing in register");
                    return;
                }

                remember();
                beginChange();
                setModeNormal();

                const removed = captureRange(m, range);

                if (range.lw) {
                    // Replace the lines but keep one (empty) line to paste on.
                    deleteRange(range.start, range.end);
                    V.pos = range.start;

                    if (r.linewise) {
                        const lines = r.text.replace(/\n$/, "").split("\n");

                        setSel(V.model, range.start, range.start);
                        insertLines(
                            lines,
                            r.htmlLines && r.htmlLines.length === lines.length
                                ? r.htmlLines
                                : null,
                        );
                        V.pos = T.firstNonBlank(remodel().text, range.start);
                    } else {
                        paste(true, cmd.count || 1, cmd.reg);
                    }
                } else {
                    deleteRange(range.start, range.end);
                    V.pos = range.start;

                    if (r.linewise) {
                        // Linewise text into a charwise hole: own line(s).
                        setSel(V.model, range.start, range.start);
                        exec("insertLineBreak");
                        remodel();
                        V.pos = range.start;
                        paste(false, cmd.count || 1, cmd.reg);
                    } else {
                        paste(true, cmd.count || 1, cmd.reg);
                    }
                }

                setRegister(null, removed, "delete");
                return;
            }

            case ":":
                remember();
                openCmdline(":", "'<,'>");
                return;
        }
    }

    // Rows of the visual block: for every line the [a, b) slice covered.
    function blockInfo(m) {
        const text = m.text;
        const la = T.lineIndex(text, V.vAnchor);
        const lc = T.lineIndex(text, V.pos);
        const cursorCol =
            V.desiredCol === Infinity
                ? Infinity
                : Math.max(V.desiredCol, V.pos - T.lineStart(text, V.pos));
        const c1 = Math.min(V.blockAnchorCol, cursorCol);
        const c2 = Math.max(V.blockAnchorCol, cursorCol);
        const rows = [];

        for (let line = Math.min(la, lc); line <= Math.max(la, lc); line++) {
            const s = T.lineStartOf(text, line);
            const e = T.lineEnd(text, s);

            rows.push({
                line,
                s,
                e,
                a: Math.min(s + c1, e),
                b: c2 === Infinity ? e : Math.min(s + c2 + 1, e),
            });
        }

        return { rows, c1, c2, eol: c2 === Infinity };
    }

    function executeBlock(cmd) {
        const m = V.model;
        const text = m.text;
        const info = blockInfo(m);
        let rows = info.rows;
        const top = rows[0];
        const others = rows.slice(1).map((r) => r.line);
        const remember = () => {
            V.lastVisual = {
                anchor: V.vAnchor,
                pos: V.pos,
                mode: "vblock",
                field: V.field,
                anchorCol: V.blockAnchorCol,
                col: V.desiredCol,
            };
        };
        // Bottom-up, so offsets of the rows above stay valid.
        const each = (fn) => {
            for (let i = rows.length - 1; i >= 0; i--) {
                fn(rows[i]);
            }
        };
        const capture = () => ({
            text: rows.map((r) => text.slice(r.a, r.b)).join("\n"),
            linewise: false,
            block: true,
        });
        const leave = () => {
            remember();
            setModeNormal();
            V.pos = top.a;
        };
        const transform = (fn) => {
            leave();
            beginChange();
            each((r) => transformRange({ start: r.a, end: r.b }, fn));
            V.pos = top.a;
        };

        switch (cmd.action) {
            case "<Esc>":
            case "<C-[>":
            case "<C-q>":
            case "<C-v>":
                // Leaving without an action keeps the cursor where it is.
                remember();
                setModeNormal();
                V.pos = T.clampNormal(text, V.pos);
                return;

            case "v":
                V.mode = "visual";
                return;

            case "V":
                V.mode = "vline";
                return;

            case "o": {
                const a = V.vAnchor;
                const col = V.blockAnchorCol;

                V.vAnchor = V.pos;
                V.blockAnchorCol =
                    V.desiredCol === Infinity
                        ? V.pos - T.lineStart(text, V.pos)
                        : V.desiredCol;
                V.pos = a;
                V.desiredCol = col;
                return;
            }

            case "y":
                setRegister(cmd.reg, capture(), "yank");
                leave();
                V.pos = top.a;
                return;

            case "X":
            case "D":
            case "C":
                rows = rows.map((r) => Object.assign({}, r, { b: r.e }));

            // fallthrough: same as d / c, to the end of each line
            case "d":
            case "x":
            case "<Del>":
            case "c":
            case "s": {
                const change =
                    cmd.action === "c" || cmd.action === "s" || cmd.action === "C";

                setRegister(cmd.reg, capture(), "delete");
                leave();
                beginChange();
                each((r) => {
                    if (r.a < r.b) {
                        deleteRange(r.a, r.b);
                    }
                });
                V.pos = top.a;

                if (change) {
                    enterInsert(top.a, {
                        block: { lines: others, col: top.a - top.s },
                    });
                }

                return;
            }

            case "I":
                leave();
                enterInsert(top.a, {
                    block: { lines: others, col: top.a - top.s, home: top.a },
                });
                return;

            case "A":
                leave();
                enterInsert(top.b, {
                    block: {
                        lines: others,
                        col: info.eol ? Infinity : info.c2 + 1,
                        pad: true,
                        home: top.a,
                    },
                });
                return;

            case "r":
                transform((str) => cmd.arg.repeat(str.length));
                return;

            case "~":
            case "g~":
                transform(T.toggleCase);
                return;

            case "u":
            case "gu":
                transform((str) => str.toLowerCase());
                return;

            case "U":
            case "gU":
                transform((str) => str.toUpperCase());
                return;

            case "J":
            case "gJ":
                leave();
                beginChange();
                V.pos = top.s;
                joinLines(Math.max(2, rows.length));
                return;

            case ">":
            case "<":
                leave();
                beginChange();
                applyOperator(
                    cmd.action,
                    { start: top.s, end: rows[rows.length - 1].e, lw: true },
                    null,
                );
                return;

            case ":":
                remember();
                openCmdline(":", "'<,'>");
                return;
        }
    }

    function scrollCursorTo(where) {
        const field = V.field;
        const m = V.model;

        if (!field || !m) {
            return;
        }

        const rect = cursorRect(m, T.clamp(V.pos, 0, m.text.length));
        const scroller = scrollParent(field);
        const view = scroller
            ? scroller.getBoundingClientRect()
            : { top: 0, bottom: window.innerHeight };
        const target =
            where === "t"
                ? view.top + 8
                : where === "b"
                  ? view.bottom - rect.height - 8
                  : (view.top + view.bottom - rect.height) / 2;
        const delta = rect.top - target;

        if (scroller) {
            scroller.scrollTop += delta;
        } else {
            window.scrollBy(0, delta);
        }
    }

    function execute(cmd, keys) {
        const m = sync();

        if (!m) {
            return;
        }

        const undoBefore = V.undo.length;

        V.pendingDot = null;

        if (isVisual()) {
            executeVisual(cmd);
        } else {
            executeNormal(cmd, keys);
        }

        if (!inInsert()) {
            if (V.model) {
                V.pos = isVisual()
                    ? T.clamp(V.pos, 0, V.model.text.length)
                    : T.clampNormal(V.model.text, V.pos);
            }

            const changed = endChange() || V.undo.length > undoBefore;

            if (changed && V.pendingDot && !V.replaying) {
                V.lastChange = { keys: V.pendingDot, text: "" };
            }

            V.pendingDot = null;

            if (V.field && !V.cmdline) {
                remodel();
                placeCursor();
            }
        }

        updateStatus();
    }

    function repeatLastChange(count) {
        let last = V.lastChange;

        if (!last || V.replaying) {
            return;
        }

        if (count) {
            // "3." repeats with a new count replacing the original one.
            const keys = last.keys.slice();
            let i = 0;

            while (keys[i] === '"') {
                i += 2;
            }

            let j = i;

            while (
                j < keys.length &&
                /^[0-9]$/.test(keys[j]) &&
                !(j === i && keys[j] === "0")
            ) {
                j++;
            }

            keys.splice(i, j - i, ...String(count).split(""));
            last = V.lastChange = { keys, text: last.text };
        }

        V.replaying = true;

        try {
            beginChange();

            for (const key of last.keys) {
                dispatchKey(key);
            }

            if (V.mode === "replace") {
                for (const ch of last.text) {
                    replaceChar(ch);
                }

                exitInsert();
            } else if (V.mode === "insert") {
                if (last.text) {
                    typeText(last.text);
                }

                exitInsert();
            }
        } finally {
            V.replaying = false;
        }
    }

    function feedKey(key) {
        if (key === "<Esc>" || key === "<C-[>") {
            if (V.keys.length > 0) {
                V.keys = [];
                updateStatus();
                drawCursor(false);
                return;
            }
        }

        const shapeBefore = pendingKind();

        V.keys.push(key);

        const result = parse(V.keys, isVisual());

        if (result.status === "incomplete") {
            updateStatus();

            if (pendingKind() !== shapeBefore) {
                drawCursor(false);
            }

            return;
        }

        const keys = V.keys;

        V.keys = [];

        if (result.status === "done") {
            execute(result.cmd, keys);
        } else {
            updateStatus();
        }

        // The cursor showed a pending shape (half block / underline): a
        // command that changed nothing would otherwise leave it on screen.
        if (shapeBefore) {
            drawCursor(false);
        }
    }

    // What the keys typed so far are waiting for: "operator" (d, c, y, ...
    // need a motion), "replace" (r needs a character) or "".
    function pendingKind() {
        const keys = V.keys;
        let i = 0;

        while (keys[i] === '"') {
            i += 2;
        }

        while (i < keys.length && /^[0-9]$/.test(keys[i])) {
            i++;
        }

        if (i >= keys.length) {
            return "";
        }

        let k = keys[i];

        if (PREFIX_KEYS.has(k) && i + 1 < keys.length) {
            k += keys[i + 1];
        }

        if (k === "r") {
            return "replace";
        }

        return OPERATORS.has(k) ? "operator" : "";
    }

    // ======================================================================
    // Command line (":" commands and "/" search)
    // ======================================================================

    function openCmdline(type, text) {
        V.cmdline = { type, text, hist: -1, typed: text };
        updateStatus();
        queueDraw();
    }

    function closeCmdline() {
        V.cmdline = null;

        if (V.field && !inInsert()) {
            remodel();
            placeCursor();
        }

        updateStatus();
    }

    function cmdlineKey(key) {
        const c = V.cmdline;

        if (key === "<Esc>" || key === "<C-[>" || key === "<C-c>") {
            if (isVisual()) {
                setModeNormal();
            }

            closeCmdline();
        } else if (key === "<Up>" || key === "<Down>") {
            // Walk the history of earlier commands / searches.
            const list = V.history[c.type === "?" ? "/" : c.type];
            const next = c.hist + (key === "<Up>" ? 1 : -1);

            if (next >= -1 && next < list.length) {
                if (c.hist === -1) {
                    c.typed = c.text;
                }

                c.hist = next;
                c.text = next === -1 ? c.typed : list[list.length - 1 - next];
                updateStatus();
            }
        } else if (key === "<C-w>") {
            c.text = c.text.replace(/\S+\s*$/, "");
            updateStatus();
        } else if (key === "<CR>") {
            const list = V.history[c.type === "?" ? "/" : c.type];

            if (c.text && list[list.length - 1] !== c.text) {
                list.push(c.text);

                if (list.length > 50) {
                    list.shift();
                }
            }

            V.cmdline = null;
            runCmdline(c.type, c.text, c.op);

            if (!V.cmdline) {
                closeCmdline();
            }
        } else if (key === "<BS>") {
            if (c.text === "") {
                if (isVisual()) {
                    setModeNormal();
                }

                closeCmdline();
            } else {
                c.text = c.text.slice(0, -1);
                updateStatus();
            }
        } else if (key === "<C-u>") {
            c.text = "";
            updateStatus();
        } else if (key === "<C-v>") {
            c.text += (V.clipboardText || "").split("\n")[0];
            updateStatus();
        } else if (key.length === 1) {
            c.text += key;
            updateStatus();
        }
    }

    // Parses a leading line range. Returns { l1, l2, rest } (0-based lines).
    function parseLineRange(input, m) {
        const text = m.text;
        const total = T.lineCount(text);
        const current = T.lineIndex(text, V.pos);

        if (input.startsWith("%")) {
            return { l1: 0, l2: total - 1, rest: input.slice(1), given: true };
        }

        if (input.startsWith("'<,'>")) {
            const b = visualBounds(m);
            const lv = V.lastVisual;
            const lo = lv ? Math.min(lv.anchor, lv.pos) : b.start;
            const hi = lv ? Math.max(lv.anchor, lv.pos) : b.end;

            return {
                l1: T.lineIndex(text, lo),
                l2: T.lineIndex(text, hi),
                rest: input.slice(5),
                given: true,
            };
        }

        const address = (s) => {
            const match = /^(\d+|\.|\$)/.exec(s);

            if (!match) {
                return null;
            }

            const tok = match[1];
            const line =
                tok === "." ? current : tok === "$" ? total - 1 : parseInt(tok, 10) - 1;

            return { line: T.clamp(line, 0, total - 1), len: tok.length };
        };

        const a = address(input);

        if (!a) {
            return { l1: current, l2: current, rest: input, given: false };
        }

        let rest = input.slice(a.len);

        if (rest.startsWith(",")) {
            const b = address(rest.slice(1));

            if (b) {
                return {
                    l1: Math.min(a.line, b.line),
                    l2: Math.max(a.line, b.line),
                    rest: rest.slice(1 + b.len),
                    given: true,
                };
            }
        }

        return { l1: a.line, l2: a.line, rest, given: true };
    }

    function substitute(m, l1, l2, spec, extraFlags) {
        V.lastSub = spec;

        const delim = spec[0];
        const parts = [];
        let cur = "";

        for (let i = 1; i < spec.length; i++) {
            if (spec[i] === "\\" && spec[i + 1] === delim) {
                cur += delim;
                i++;
            } else if (spec[i] === delim && parts.length < 2) {
                parts.push(cur);
                cur = "";
            } else {
                cur += spec[i];
            }
        }

        parts.push(cur);

        const pattern = parts[0] || (V.lastSearch ? V.lastSearch.pattern : "");
        const flags = (parts.length > 2 ? parts[2] : "") + (extraFlags || "");

        if (!pattern) {
            showMessage("E35: No previous regular expression");
            return;
        }

        V.lastSearch = { pattern, forward: true };

        // vim replacement syntax -> JS: \1 => $1, & => $&, \r / \n => newline.
        const replacement = (parts[1] || "")
            .replace(/\$/g, "$$$$")
            .replace(/\\([0-9])/g, "$$$1")
            .replace(/\\r|\\n/g, "\n")
            .replace(/\\&/g, "\u0000")
            .replace(/&/g, "$$&")
            .replace(/\u0000/g, "&");

        const text = m.text;
        const start = T.lineStartOf(text, l1);
        const end = T.lineEnd(text, T.lineStartOf(text, l2));
        const region = text.slice(start, end);
        let regex = T.makeRegex(pattern, "g");

        if (flags.includes("i")) {
            regex = new RegExp(regex.source, regex.flags.replace("i", "") + "i");
        }

        const single = new RegExp(regex.source, regex.flags.replace("g", ""));
        const edits = [];
        const seenLines = new Set();

        for (const match of T.allMatches(region, regex)) {
            const line = T.lineIndex(region, match.start);

            if (!flags.includes("g")) {
                if (seenLines.has(line)) {
                    continue;
                }

                seenLines.add(line);
            }

            const found = region.slice(match.start, match.end);

            edits.push({
                a: start + match.start,
                b: start + match.end,
                text: found.replace(single, replacement),
            });
        }

        if (edits.length === 0) {
            showMessage("E486: Pattern not found: " + pattern);
            return;
        }

        // Line of the last match, counted before the text shifts.
        const lastLine =
            T.lineIndex(text, edits[edits.length - 1].a) +
            (edits[edits.length - 1].text.split("\n").length - 1);

        beginChange();

        for (let i = edits.length - 1; i >= 0; i--) {
            replaceRange(edits[i].a, edits[i].b, edits[i].text);
        }

        V.pos = T.firstNonBlank(
            V.model.text,
            T.lineStartOf(V.model.text, lastLine),
        );
        endChange();
        showMessage(
            edits.length +
                " substitution" +
                (edits.length === 1 ? "" : "s"),
        );
    }

    function runCmdline(type, input, pendingOp) {
        const m = sync();

        if (!m) {
            return;
        }

        if (type === "/" || type === "?") {
            const forward = type === "/";
            const pattern =
                input || (V.lastSearch ? V.lastSearch.pattern : "");

            if (!pattern) {
                return;
            }

            V.lastSearch = { pattern, forward };

            const p = T.search(m.text, pattern, V.pos, forward, 1);

            if (p < 0) {
                showMessage("E486: Pattern not found: " + pattern);
            } else if (pendingOp) {
                // d/pattern: operate from the cursor up to the match.
                const range = motionToRange(m.text, V.pos, { pos: p }, false);
                const op = pendingOp.cmd.op;

                if (op !== "y") {
                    beginChange();
                }

                applyOperator(op, range, pendingOp.cmd.reg);

                if (!inInsert()) {
                    if (endChange() && !V.replaying) {
                        V.lastChange = {
                            keys: pendingOp.keys.concat(
                                tokenizeKeys(input),
                                ["<CR>"],
                            ),
                            text: "",
                        };
                    }
                } else {
                    V.pendingDot = pendingOp.keys.concat(tokenizeKeys(input), [
                        "<CR>",
                    ]);
                }
            } else {
                setJump();
                V.pos = T.clampNormal(m.text, p);
                V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
            }

            return;
        }

        V.lastCmd = input;

        const wasVisual = isVisual();
        const range = parseLineRange(input.replace(/^\s+/, ""), m);
        // Leading blanks only: ":normal A " must keep its trailing space.
        const rest = range.rest.replace(/^\s+/, "");

        if (wasVisual) {
            setModeNormal();
            V.pos = T.clampNormal(m.text, V.pos);
        }

        if (rest.trim() === "") {
            if (range.given) {
                setJump();
                V.pos = T.firstNonBlank(m.text, T.lineStartOf(m.text, range.l2));
            }

            return;
        }

        const match = /^([a-zA-Z]+)(!?)\s*(.*)$/.exec(rest);
        const name = match ? match[1] : rest;
        const sub = /^s(?:ubstitute)?([^a-zA-Z0-9\s].*)$/.exec(rest);

        if (sub) {
            substitute(m, range.l1, range.l2, sub[1]);
            return;
        }

        const lineRange = () => ({
            start: T.lineStartOf(m.text, range.l1),
            end: T.lineEnd(m.text, T.lineStartOf(m.text, range.l2)),
            lw: true,
        });

        const args = match ? match[3] : "";

        switch (name) {
            case "w":
            case "write":
                sendPython({ cmd: "w" });
                return;

            case "t":
            case "co":
            case "copy":
            case "m":
            case "move": {
                // :t / :m {line} - copy or move the range below that line.
                const total = T.lineCount(m.text);
                const a = args.trim();
                let dest;

                if (a === "$") {
                    dest = total - 1;
                } else if (a === "." || a === "") {
                    dest = T.lineIndex(m.text, V.pos);
                } else if (/^\d+$/.test(a)) {
                    dest = Math.min(parseInt(a, 10), total) - 1;
                } else {
                    showMessage("E14: Invalid address");
                    return;
                }

                const move = name[0] === "m";
                const n = range.l2 - range.l1 + 1;

                if (move && dest >= range.l1 - 1 && dest <= range.l2) {
                    return;
                }

                const data = captureRange(m, lineRange());

                beginChange();

                if (dest < 0) {
                    V.pos = 0;
                    pasteData(data, true, 1);
                } else {
                    V.pos = T.lineStartOf(V.model.text, dest);
                    pasteData(data, false, 1);
                }

                let first = dest + 1;

                if (move) {
                    const shift = dest < range.l1 ? n : 0;
                    const t = V.model.text;

                    deleteLines({
                        start: T.lineStartOf(t, range.l1 + shift),
                        end: T.lineEnd(t, T.lineStartOf(t, range.l2 + shift)),
                        lw: true,
                    });

                    if (dest >= range.l1) {
                        first -= n;
                    }
                }

                V.pos = T.firstNonBlank(
                    V.model.text,
                    T.lineStartOf(V.model.text, first + n - 1),
                );
                endChange();
                return;
            }

            case "norm":
            case "normal": {
                // :[range]normal {keys} - run normal-mode keys on each line.
                const keys = tokenizeKeys(args);

                if (keys.length === 0) {
                    return;
                }

                V.playing++;

                try {
                    asOneChange(() => {
                        for (let line = range.l1; line <= range.l2; line++) {
                            if (line >= T.lineCount(V.model.text)) {
                                break;
                            }

                            V.pos = T.lineStartOf(V.model.text, line);
                            placeCursor();

                            for (const key of keys) {
                                dispatchKey(key);
                            }

                            if (inInsert()) {
                                exitInsert();
                            }

                            if (isVisual()) {
                                setModeNormal();
                            }

                            remodel();
                        }
                    });
                } finally {
                    V.playing--;
                }

                return;
            }

            case "marks": {
                const names = Object.keys(V.marks)
                    .filter((k) => k !== "`")
                    .sort();

                showMessage(
                    names.length
                        ? "marks: " +
                              names
                                  .map((k) => {
                                      const mk = V.marks[k];
                                      const t =
                                          mk.field === V.field ? m.text : "";

                                      return (
                                          k +
                                          (t
                                              ? " line " +
                                                (T.lineIndex(t, mk.pos) + 1)
                                              : " (other field)")
                                      );
                                  })
                                  .join("   ")
                        : "No marks set",
                    6000,
                );
                return;
            }

            case "wq":
            case "x":
            case "xit":
                sendPython({ cmd: "wq" });
                return;

            case "q":
            case "quit":
            case "close":
                sendPython({ cmd: "q" });
                return;

            case "d":
            case "delete":
                beginChange();
                applyOperator("d", lineRange(), null);
                endChange();
                return;

            case "y":
            case "yank": {
                const keep = V.pos;

                applyOperator("y", lineRange(), null);
                V.pos = keep;
                return;
            }

            case "noh":
            case "nohlsearch":
                return;

            case "u":
            case "undo":
                undoRedo(true, 1);
                return;

            case "red":
            case "redo":
                undoRedo(false, 1);
                return;

            case "reg":
            case "registers":
            case "di":
            case "display": {
                const names = Object.keys(V.regs).sort();

                showMessage(
                    names.length
                        ? names
                              .map(
                                  (n) =>
                                      '"' +
                                      n +
                                      " " +
                                      V.regs[n].text
                                          .replace(/\n/g, "^J")
                                          .slice(0, 24),
                              )
                              .join("   ")
                        : "No registers",
                    6000,
                );
                return;
            }

            case "h":
            case "help":
                sendPython({ cmd: "help" });
                return;
        }

        showMessage("E492: Not an editor command: " + rest);
    }

    // ======================================================================
    // Status line and block cursor
    // ======================================================================

    // Letter shown in the round badge, and the colour group it uses.
    const MODE_BADGES = {
        normal: ["N", "normal"],
        insert: ["I", "insert"],
        replace: ["R", "replace"],
        visual: ["V", "visual"],
        vline: ["V", "visual"],
        vblock: ["V", "visual"],
    };
    const MODE_NOTES = { vline: "LINE", vblock: "BLOCK" };

    function showMessage(text, ms) {
        V.message = text;
        clearTimeout(V.messageTimer);
        V.messageTimer = setTimeout(() => {
            V.message = "";
            updateStatus();
        }, ms || 2500);
        updateStatus();
    }

    function updateStatus() {
        if (!document.body) {
            return;
        }

        const badge = MODE_BADGES[V.mode] || MODE_BADGES.normal;

        document.body.dataset.ankiVimMode = badge[1];

        let el = V.statusEl;

        if (!el || !el.isConnected) {
            el = document.getElementById("anki-vim-status");

            if (!el) {
                el = document.createElement("div");
                el.id = "anki-vim-status";
                document.body.appendChild(el);
            }

            V.statusEl = el;
        }

        if (el.childNodes.length !== 2) {
            el.textContent = "";

            for (const cls of ["anki-vim-badge", "anki-vim-info"]) {
                const span = document.createElement("span");

                span.className = cls;
                el.appendChild(span);
            }
        }

        let info = "";
        let kind = "";

        if (V.cmdline) {
            info = V.cmdline.type + V.cmdline.text + "\u2588";
            kind = "cmdline";
        } else if (V.message) {
            info = V.message;
            kind = "message";
        } else {
            const parts = [];

            if (MODE_NOTES[V.mode]) {
                parts.push(MODE_NOTES[V.mode]);
            }

            if (V.recording) {
                parts.push("recording @" + V.recording.reg);
            }

            if (V.keys.length > 0) {
                parts.push(V.keys.join(""));
            }

            info = parts.join("  ");
        }

        el.style.display = config.show_status ? "" : "none";
        el.dataset.position = config.status_position;
        el.dataset.kind = kind;
        el.firstChild.textContent = badge[0];
        el.lastChild.textContent = info;
        el.lastChild.style.display = info ? "" : "none";
    }

    function cursorRect(m, pos) {
        const text = m.text;

        if (pos < text.length && text[pos] !== "\n") {
            const c = m.chars[pos];

            if (c.k === "a") {
                return c.n.getBoundingClientRect();
            }

            if (c.k === "t") {
                const range = document.createRange();

                range.setStart(c.n, c.o);
                range.setEnd(c.n, c.o + 1);

                const rects = range.getClientRects();

                for (const r of rects) {
                    if (r.width > 0 && r.height > 0) {
                        return r;
                    }
                }

                if (rects.length > 0) {
                    return rects[0];
                }
            }
        }

        const p = domPos(m, pos);
        const range = document.createRange();

        try {
            range.setStart(p.n, p.o);
            range.collapse(true);

            const rects = range.getClientRects();

            if (rects.length > 0 && rects[0].height > 0) {
                return rects[0];
            }
        } catch (error) {}

        if (p.n.nodeType === 1 && p.n.childNodes[p.o]) {
            const child = p.n.childNodes[p.o];

            if (child.nodeType === 1) {
                const r = child.getBoundingClientRect();

                if (r.height > 0) {
                    return { left: r.left, top: r.top, width: 0, height: r.height };
                }
            }
        }

        const rootRect = m.root.getBoundingClientRect();
        const style = getComputedStyle(m.root);
        const lineHeight =
            parseFloat(style.lineHeight) ||
            (parseFloat(style.fontSize) || 16) * 1.3;

        // An empty field has nothing to measure. Use a box about as tall as
        // a letter, centred in the line, so it matches the cursor elsewhere.
        const height = Math.min(
            lineHeight,
            (parseFloat(style.fontSize) || 16) * 1.15,
        );

        return {
            left: rootRect.left + (parseFloat(style.paddingLeft) || 0),
            top:
                rootRect.top +
                (parseFloat(style.paddingTop) || 0) +
                (lineHeight - height) / 2,
            width: 0,
            height,
        };
    }

    function scrollParent(el) {
        let node = el;

        while (node) {
            const parent =
                node.parentElement ||
                (node.getRootNode() && node.getRootNode().host) ||
                null;

            if (!parent) {
                return null;
            }

            const style = getComputedStyle(parent);

            if (
                /(auto|scroll)/.test(style.overflowY) &&
                parent.scrollHeight > parent.clientHeight + 1
            ) {
                return parent;
            }

            node = parent;
        }

        return null;
    }

    function ensureVisible(field, rect) {
        const margin = 36;
        const scroller = scrollParent(field);
        const view = scroller
            ? scroller.getBoundingClientRect()
            : { top: 0, bottom: window.innerHeight };
        let delta = 0;

        if (rect.top < view.top + 4) {
            delta = rect.top - view.top - margin;
        } else if (rect.top + rect.height > view.bottom - 4) {
            delta = rect.top + rect.height - view.bottom + margin;
        }

        if (delta !== 0) {
            if (scroller) {
                scroller.scrollTop += delta;
            } else {
                window.scrollBy(0, delta);
            }

            return true;
        }

        return false;
    }

    // The overlays are fixed to the window, so they would otherwise stay
    // visible on top of the toolbar when their text scrolls out of the
    // fields area. This is the part of the window the field can show in.
    function visibleArea(field) {
        const area = {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
        };
        let node = field;

        while (node) {
            const parent =
                node.parentElement ||
                (node.getRootNode() && node.getRootNode().host) ||
                null;

            if (!parent || parent === document.body) {
                break;
            }

            const style = getComputedStyle(parent);

            if (style.overflowY !== "visible" || style.overflowX !== "visible") {
                const r = parent.getBoundingClientRect();

                area.left = Math.max(area.left, r.left);
                area.top = Math.max(area.top, r.top);
                area.right = Math.min(area.right, r.right);
                area.bottom = Math.min(area.bottom, r.bottom);
            }

            node = parent;
        }

        return area;
    }

    // CSS clip-path that cuts a box down to the visible area: "" when it
    // is fully visible, null when nothing of it is.
    function clipTo(area, left, top, width, height) {
        const cut = [
            Math.max(0, area.top - top),
            Math.max(0, left + width - area.right),
            Math.max(0, top + height - area.bottom),
            Math.max(0, area.left - left),
        ];

        if (cut[0] + cut[2] >= height || cut[1] + cut[3] >= width) {
            return null;
        }

        return cut.some((c) => c > 0)
            ? "inset(" + cut.map((c) => c + "px").join(" ") + ")"
            : "";
    }

    // Visual block has no native equivalent (a browser selection is one
    // continuous range), so its rectangles are drawn as an overlay.
    function drawBlockSelection() {
        let box = V.selectEl;

        if (!box || !box.isConnected) {
            box = document.getElementById("anki-vim-block-select");

            if (!box) {
                box = document.createElement("div");
                box.id = "anki-vim-block-select";
                document.body.appendChild(box);
            }

            V.selectEl = box;
        }

        box.textContent = "";

        const m = V.model;

        if (V.mode !== "vblock" || V.cmdline || !m || activeField() !== m.root) {
            return;
        }

        const area = visibleArea(m.root);

        for (const row of blockInfo(m).rows) {
            if (row.a >= row.b) {
                continue;
            }

            const pa = domPos(m, row.a, true);
            const pb = domPos(m, row.b);
            const range = document.createRange();

            try {
                range.setStart(pa.n, pa.o);
                range.setEnd(pb.n, pb.o);
            } catch (error) {
                continue;
            }

            for (const rect of range.getClientRects()) {
                if (rect.width <= 0 || rect.height <= 0) {
                    continue;
                }

                const clip = clipTo(
                    area,
                    rect.left,
                    rect.top,
                    rect.width,
                    rect.height,
                );

                if (clip === null) {
                    continue;
                }

                const div = document.createElement("div");

                div.style.clipPath = clip;

                div.style.left = rect.left + "px";
                div.style.top = rect.top + "px";
                div.style.width = rect.width + "px";
                div.style.height = rect.height + "px";
                box.appendChild(div);
            }
        }
    }

    function drawCursor(allowScroll) {
        drawBlockSelection();

        let el = V.cursorEl;

        if (!el || !el.isConnected) {
            el = document.getElementById("anki-vim-block-cursor");

            if (!el) {
                el = document.createElement("div");
                el.id = "anki-vim-block-cursor";
                document.body.appendChild(el);
            }

            V.cursorEl = el;
        }

        const field = V.field;
        let m = V.model;

        // Insert mode keeps the browser's own caret. Like Doom Emacs, there
        // is no cursor at all while the window is unfocused.
        if (
            V.mode === "insert" ||
            !V.windowFocused ||
            V.cmdline ||
            !field ||
            activeField() !== field
        ) {
            el.style.display = "none";
            return;
        }

        let pos;

        if (V.mode === "replace") {
            // Typing goes straight to the field here, so follow the caret.
            m = remodel();

            if (!m || m.caret === null) {
                el.style.display = "none";
                return;
            }

            pos = m.caret;
        } else {
            if (!m || m.root !== field) {
                el.style.display = "none";
                return;
            }

            pos = T.clamp(V.pos, 0, m.text.length);
        }

        let rect;

        try {
            rect = cursorRect(m, pos);
        } catch (error) {
            el.style.display = "none";
            return;
        }

        if (allowScroll && ensureVisible(field, rect)) {
            rect = cursorRect(m, pos);
        }

        const ch = pos < m.text.length ? m.text[pos] : "\n";
        const c = m.chars[pos];
        const source =
            c && c.k === "t" && c.n.parentElement ? c.n.parentElement : field;
        const style = getComputedStyle(source);
        const fontSize = parseFloat(style.fontSize) || 16;
        const shape = cursorShape();
        const block = shape === "block";
        // Images and MathJax have no glyph to redraw: invert them instead.
        const atom = block && ch === ATOM;
        let glyph = "";

        // The box is opaque and re-draws the character it covers in the
        // field's background colour. That also hides the browser's own thin
        // caret, which must not be hidden with CSS: `caret-color` set on the
        // field gets copied into the note's HTML when the browser merges
        // lines.
        if (block && ch !== ATOM && ch !== "\n" && !T.isBlankChar(ch)) {
            glyph = graphemeAt(m.text, pos);
        }

        // Proportional fonts make the cursor as narrow as the letter under
        // it; cursor_min_width (in em) widens it around the letter's centre.
        const minWidth = fontSize * (Number(config.cursor_min_width) || 0);
        let left = rect.left;
        let top = rect.top;
        let width = rect.width > 1 ? rect.width : fontSize * 0.55;
        let height = rect.height;
        let widened = false;

        if (rect.width > 1 && width < minWidth) {
            left -= (minWidth - width) / 2;
            width = minWidth;
            widened = true;
        }

        if (shape === "half") {
            height = Math.round(rect.height / 2);
        } else if (shape === "underline") {
            height = 2;
        }

        top += rect.height - height;

        const colour = cursorColour(style, field);
        const hollow = shape === "hollow";
        const clip = clipTo(visibleArea(field), left, top, width, height);

        if (clip === null) {
            el.style.display = "none";
            return;
        }

        el.textContent = glyph;
        el.dataset.shape = shape;
        el.classList.toggle("anki-vim-cursor-atom", atom);
        el.classList.toggle("anki-vim-cursor-blink", !!config.cursor_blink);
        el.style.display = "block";
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.width = width + "px";
        el.style.height = height + "px";
        el.style.lineHeight = height + "px";
        el.style.textAlign = widened ? "center" : "left";
        el.style.fontFamily = style.fontFamily;
        el.style.fontSize = style.fontSize;
        el.style.fontWeight = style.fontWeight;
        el.style.fontStyle = style.fontStyle;
        el.style.clipPath = clip;
        el.style.border = hollow ? "1px solid " + colour : "";
        // The hollow box sits on the selection, whose colour can be close to
        // the cursor's: a white inner line keeps it visible there.
        el.style.outline = hollow ? "1px solid rgba(255, 255, 255, 0.85)" : "";
        el.style.outlineOffset = hollow ? "-2px" : "";
        el.style.background = hollow || atom ? "transparent" : colour;
        el.style.color = inkOn(colour, field, style);
        // Images and MathJax: a frame and a tint in the cursor's colour.
        el.style.boxShadow = atom
            ? "inset 0 0 0 2px " + colour + ", inset 0 0 0 100vmax " + tint(colour)
            : "";

        // A cursor that just moved is shown solid before it blinks again.
        const key = [left, top, shape].join("|");

        if (config.cursor_blink && key !== V.cursorKey) {
            el.style.animation = "none";
            void el.offsetWidth;
            el.style.animation = "";
        }

        V.cursorKey = key;
    }

    // The shapes Doom Emacs (evil) uses for each state:
    //   block      normal mode (`box`)
    //   hollow     visual modes (`hollow`)
    //   half       an operator is waiting for its motion (`evil-half-cursor`)
    //   underline  replace mode and a pending r (`hbar`, 2px)
    function cursorShape() {
        if (V.mode === "replace") {
            return "underline";
        }

        const kind = pendingKind();

        if (kind === "replace") {
            return "underline";
        }

        if (kind === "operator") {
            return "half";
        }

        return isVisual() ? "hollow" : "block";
    }

    // cursor_color "auto": a blue for dark fields and a darker one for
    // light fields (the cursor colours of doom-one and doom-one-light).
    const CURSOR_ON_DARK = "#51afef";
    const CURSOR_ON_LIGHT = "#4078f2";

    // cursor_color: "text" (the default), "auto" or a CSS colour.
    function cursorColour(style, field) {
        const wanted = String(config.cursor_color || "").trim();

        if (wanted === "text") {
            // The field's own text colour, not the colour of the letter
            // under the cursor, so it stays the same on coloured text.
            return getComputedStyle(field).color;
        }

        if (
            wanted &&
            wanted !== "auto" &&
            typeof CSS !== "undefined" &&
            CSS.supports("color", wanted)
        ) {
            return wanted;
        }

        return isDark(field) ? CURSOR_ON_DARK : CURSOR_ON_LIGHT;
    }

    // [r, g, b] of a computed colour such as "rgb(81, 175, 239)".
    function rgbOf(colour) {
        const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour);

        return match ? [+match[1], +match[2], +match[3]] : null;
    }

    function isDark(field) {
        const rgb = rgbOf(backgroundOf(field));

        if (!rgb) {
            return document.documentElement.classList.contains("night-mode");
        }

        return brightness(rgb) < 128;
    }

    function brightness(rgb) {
        // Perceived brightness, 0 (black) to 255 (white).
        return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    }

    // [r, g, b] of any CSS colour, resolved by the browser.
    function resolve(colour) {
        const probe = V.cursorEl;
        const before = probe.style.color;

        probe.style.color = colour;

        const rgb = rgbOf(getComputedStyle(probe).color);

        probe.style.color = before;
        return rgb;
    }

    // Colour for the letter inside the box: the field's background or its
    // text colour, whichever stands out more against the cursor.
    function inkOn(colour, field, style) {
        const background = backgroundOf(field);
        const block = resolve(colour);
        const a = rgbOf(background);
        const b = rgbOf(style.color);

        if (!block || !a || !b) {
            return background;
        }

        const level = brightness(block);

        return Math.abs(brightness(a) - level) >= Math.abs(brightness(b) - level)
            ? background
            : style.color;
    }

    // The colour at about a third strength, to lay over an image.
    function tint(colour) {
        const rgb = resolve(colour);

        return rgb
            ? "rgba(" + rgb.join(", ") + ", 0.35)"
            : "rgba(81, 175, 239, 0.35)";
    }

    let segmenter;

    // The whole character at pos as the reader sees it: a letter with its
    // combining accents, or an emoji made of several code points.
    function graphemeAt(text, pos) {
        let end = pos + 1;

        while (
            end < text.length &&
            end < pos + 24 &&
            text[end] !== "\n" &&
            text[end] !== ATOM
        ) {
            end++;
        }

        const slice = text.slice(pos, end);

        if (segmenter === undefined) {
            segmenter =
                typeof Intl !== "undefined" && Intl.Segmenter
                    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
                    : null;
        }

        if (segmenter) {
            for (const part of segmenter.segment(slice)) {
                return part.segment;
            }
        }

        const code = slice.charCodeAt(0);

        return code >= 0xd800 && code <= 0xdbff ? slice.slice(0, 2) : slice[0];
    }

    function backgroundOf(el) {
        let node = el;

        while (node) {
            const bg = getComputedStyle(node).backgroundColor;
            const alpha = /^rgba\(.*,\s*0\)$/.test(bg) || bg === "transparent";

            if (bg && !alpha) {
                return bg;
            }

            node =
                node.parentElement ||
                (node.getRootNode() && node.getRootNode().host) ||
                null;
        }

        return "Canvas";
    }

    function queueDraw() {
        drawCursor(true);
    }

    // ======================================================================
    // Event handling
    // ======================================================================

    function swallow(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function resolveField(allowFocus) {
        const field = activeField();

        if (field) {
            V.field = field;
            V.lastField = field;
            return field;
        }

        if (!allowFocus) {
            return null;
        }

        // Nothing focused at all (not another widget): return to a field.
        const a = deepActive();

        if (a && a !== document.body && a !== document.documentElement) {
            return null;
        }

        const target =
            V.lastField && V.lastField.isConnected
                ? V.lastField
                : allFields()[0];

        if (!target) {
            return null;
        }

        focusField(target);
        return target;
    }

    function insertKey(event, key) {
        if (key === "<Esc>" || key === "<C-[>") {
            swallow(event);
            exitInsert();
            return;
        }

        // Ctrl-r {register}: insert a register's text.
        if (V.insertReg) {
            V.insertReg = false;

            if (key.length === 1) {
                swallow(event);

                const r = getRegister(key === '"' ? null : key);

                if (r && r.text) {
                    typeText(r.linewise ? r.text.replace(/\n$/, "") : r.text);
                }

                return;
            }
        }

        if (config.vim_ctrl_keys && key.startsWith("<C-")) {
            const m = remodel();
            const c = m ? m.caret : null;

            if (key === "<C-r>") {
                swallow(event);
                V.insertReg = true;
                return;
            }

            if (c !== null && (key === "<C-w>" || key === "<C-u>" || key === "<C-h>")) {
                const ls = T.lineStart(m.text, c);
                let from = Math.max(0, c - 1);

                if (key === "<C-u>" && c > ls) {
                    from = ls;
                } else if (key === "<C-w>" && c > ls) {
                    from = Math.max(ls, T.wordBack(m.text, c));
                }

                swallow(event);
                deleteRange(from, c);
                return;
            }
        }

        const seq = config.insert_escape;

        if (seq && seq.length === 2) {
            const now = performance.now();

            if (
                key === seq[1] &&
                V.escapeArmed &&
                now - V.escapeArmed < config.insert_escape_timeout_ms
            ) {
                const m = remodel();

                if (
                    m &&
                    m.caret !== null &&
                    m.caret > 0 &&
                    m.text[m.caret - 1] === seq[0]
                ) {
                    swallow(event);
                    deleteRange(m.caret - 1, m.caret);
                    V.escapeArmed = 0;
                    exitInsert();
                    return;
                }
            }

            V.escapeArmed = key === seq[0] ? now : 0;
        }
    }

    function onKeydown(event) {
        if (event.isComposing || event.keyCode === 229) {
            return;
        }

        const key = keyName(event);

        if (!key) {
            return;
        }

        if (V.cmdline) {
            if (key !== PASS) {
                swallow(event);
                recordKey(key);
                cmdlineKey(key);
            }

            return;
        }

        if (inInsert()) {
            if (!resolveField(false)) {
                return;
            }

            if (V.mode === "replace") {
                const isEsc = key === "<Esc>" || key === "<C-[>";

                if (isEsc || key.length === 1 || key === "<BS>") {
                    swallow(event);

                    if (!isEsc) {
                        recordKey(key);
                    }

                    replaceKey(key);
                }

                return;
            }

            insertKey(event, key);
            return;
        }

        if (key === PASS) {
            return;
        }

        if (key.startsWith("<C-") && !ctrlHandled(key)) {
            return;
        }

        if (!resolveField(true)) {
            return;
        }

        swallow(event);
        recordKey(key);
        feedKey(key);
    }

    // Called from Python, which intercepts Esc before the webview sees it
    // (otherwise Esc would close the Add Cards window).
    function escape() {
        if (V.cmdline) {
            if (isVisual()) {
                setModeNormal();
            }

            closeCmdline();
            return;
        }

        if (!activeField()) {
            const a = deepActive();

            // Let Anki's own widgets (tag editor, MathJax editor, ...) see it.
            if (a && a !== document.body) {
                a.dispatchEvent(
                    new KeyboardEvent("keydown", {
                        key: "Escape",
                        code: "Escape",
                        keyCode: 27,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                    }),
                );
            }

            return;
        }

        if (inInsert()) {
            exitInsert();
            return;
        }

        resolveField(false);
        recordKey("<Esc>");
        feedKey("<Esc>");
    }

    let selectionTimer = 0;

    function onSelectionChange() {
        if (V.mode === "replace" && !V.cmdline) {
            // Keep the underline on the caret (arrow keys, mouse).
            redrawSoon();
            return;
        }

        if (inInsert() || V.cmdline) {
            return;
        }

        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
            const field = activeField();

            if (!field || inInsert() || V.cmdline) {
                drawCursor(false);
                return;
            }

            V.field = field;
            V.lastField = field;

            if (isVisual() || stampMatches(field)) {
                return;
            }

            const sel = getSel(field);

            if (!sel || !sel.isCollapsed) {
                return;
            }

            // The caret was moved by something else (mouse, Anki, arrows).
            sync();
            placeCursor();
            updateStatus();
        }, 0);
    }

    function onMouseUp() {
        setTimeout(() => {
            const field = activeField();

            if (!field || inInsert() || V.cmdline) {
                return;
            }

            V.field = field;
            V.lastField = field;

            const m = remodel();

            if (!m || m.anchor === null || m.caret === null) {
                return;
            }

            if (m.anchor !== m.caret) {
                // A mouse drag in normal mode becomes a visual selection.
                V.mode = "visual";
                V.vAnchor = Math.min(
                    m.anchor < m.caret ? m.anchor : m.anchor - 1,
                    m.text.length,
                );
                V.pos = Math.max(0, m.caret > m.anchor ? m.caret - 1 : m.caret);
            } else {
                V.mode = "normal";
                V.pos = T.clampNormal(m.text, m.caret);
                V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
            }

            placeCursor();
            updateStatus();
        }, 0);
    }

    function onFocusIn() {
        setTimeout(() => {
            const field = activeField();

            if (field) {
                V.field = field;
                V.lastField = field;

                if (!inInsert() && !isVisual()) {
                    sync();
                    placeCursor();
                }
            }

            drawCursor(false);
        }, 0);
    }

    function onWindowFocus(event) {
        if (event.target !== window) {
            return;
        }

        V.windowFocused = event.type === "focus";

        if (V.windowFocused) {
            // Anki may have re-rendered the field while we were away.
            redrawSoon();
        } else {
            drawCursor(false);
        }
    }

    function redrawSoon() {
        if (V.drawQueued) {
            return;
        }

        V.drawQueued = true;
        requestAnimationFrame(() => {
            V.drawQueued = false;

            if (!inInsert() && V.field && activeField() === V.field) {
                remodel();
            }

            drawCursor(false);
        });
    }

    function applyConfig(next) {
        for (const key of Object.keys(config)) {
            if (next && next[key] !== undefined && next[key] !== null) {
                config[key] = next[key];
            }
        }

        updateStatus();
    }

    function init() {
        applyConfig(window.ankiVimConfig || {});

        document.addEventListener("keydown", onKeydown, true);
        document.addEventListener("selectionchange", onSelectionChange, true);
        document.addEventListener("mouseup", onMouseUp, true);
        document.addEventListener("focusin", onFocusIn, true);
        document.addEventListener("focusout", () => setTimeout(() => drawCursor(false), 0), true);
        document.addEventListener("input", redrawSoon, true);
        window.addEventListener("scroll", redrawSoon, true);
        window.addEventListener("resize", redrawSoon, true);
        window.addEventListener("blur", onWindowFocus);
        window.addEventListener("focus", onWindowFocus);

        V.mode = config.start_in_insert ? "insert" : "normal";
        updateStatus();

        const field = activeField();

        if (field) {
            V.field = field;
            V.lastField = field;

            if (V.mode === "normal") {
                sync();
                placeCursor();
            }
        }
    }

    window.ankiVim = {
        version: VERSION,
        applyConfig,
        escape,
        setClipboard: function (text) {
            V.clipboardText = typeof text === "string" ? text : "";
        },
        // Called by Python after a note is (re)loaded into the editor.
        noteLoaded: function () {
            V.undo.length = 0;
            V.redo.length = 0;
            V.change = null;
            V.stamp = null;
            redrawSoon();
        },
        setMode: function (mode) {
            if (mode === "normal") {
                if (inInsert()) {
                    exitInsert();
                } else {
                    setModeNormal();
                    updateStatus();
                }
            } else if (mode === "insert" && !inInsert()) {
                if (resolveField(true) && sync()) {
                    enterInsert(V.pos);
                }
            }
        },
        message: showMessage,
        // Introspection used by the test-suite.
        _state: V,
        _internals: {
            buildModel,
            domPos,
            parse,
            remodel,
            sync,
            placeCursor,
            focusField,
            drawCursor,
            config,
            blockInfo,
        },
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
