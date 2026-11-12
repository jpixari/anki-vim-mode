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
        drawQueued: false,
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
        return V.mode === "visual" || V.mode === "vline";
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

        if (V.mode === "vline") {
            return {
                start: T.lineStart(m.text, lo),
                end: T.lineEnd(m.text, hi),
                lw: true,
            };
        }

        return { start: lo, end: Math.min(hi + 1, m.text.length), lw: false };
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

        if (V.mode === "insert") {
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

        V.change = null;

        const after = fieldHtml(c.field);

        if (after === c.before) {
            return false;
        }

        c.after = after;
        c.posAfter = V.pos;
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
    const NORMAL_CTRL = new Set(["<C-r>", "<C-[>"]);
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

    const OPERATORS = new Set(["d", "c", "y", "gu", "gU", "g~"]);
    const MOTIONS = new Set(
        (
            "h l j k w W b B e E ge gE 0 ^ $ g_ gg G f F t T ; , { } % | " +
            "n N * # + - _ gj gk <CR> <BS> <Left> <Right> <Up> <Down> " +
            "<Home> <End>"
        )
            .split(" ")
            .concat([" "]),
    );
    const CHAR_ARG = new Set(["f", "F", "t", "T"]);
    const OBJECT_TYPES = new Set(
        "w W \" ' ` ( ) b [ ] { } B < > p c".split(" "),
    );
    const NORMAL_ACTIONS = new Set(
        (
            "i a I A o O x X s S D C Y p P u . v V r ~ J K gJ gv : / ? " +
            "<C-r> <Del> <Esc> <C-[> ZZ ZQ"
        ).split(" "),
    );
    const VISUAL_ACTIONS = new Set(
        (
            "d x X D y Y c s C S R u U ~ gu gU g~ J gJ p P r o v V : " +
            "<Del> <Esc> <C-[>"
        ).split(" "),
    );
    const PREFIX_KEYS = new Set(["g", "Z", "z"]);

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

            if (!/^[a-zA-Z0-9+*_"-]$/.test(keys[i + 1])) {
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

            if (k === "r") {
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
                return { pos: Math.max(ls, pos - n) };

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
                let p = pos;

                for (let i = 0; i < n; i++) {
                    p = T.wordBack(text, p, name === "B");
                }

                return { pos: p };
            }

            case "ge":
            case "gE": {
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

        const a = Math.min(pos, r.pos);
        const b = Math.max(pos, r.pos);

        if (r.lw) {
            return {
                start: T.lineStart(text, a),
                end: T.lineEnd(text, b),
                lw: true,
            };
        }

        return {
            start: a,
            end: Math.min(r.inc ? b + 1 : b, text.length),
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

                if (!range.lw || V.pos < range.start || V.pos > range.end) {
                    V.pos = range.start;
                } else if (isVisual()) {
                    V.pos = range.start;
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
        }

        V.mode = "normal";
        V.pos = T.clampNormal(V.model.text, V.pos);
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

        const m = V.model;
        const text = m.text;
        const pos = V.pos;

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
                V.pos = T.firstNonBlank(remodel().text, ls);
            } else {
                const le = T.lineEnd(text, pos);

                setSel(m, le, le);
                exec("insertLineBreak");
                insertLines(lines, htmlLines);
                V.pos = T.firstNonBlank(remodel().text, le + 1);
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

        V.pos = Math.max(at, caret - 1);
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

    function enterInsert(caret) {
        const m = V.model || remodel();

        if (!m) {
            return;
        }

        beginChange();
        caret = T.clamp(caret, 0, m.text.length);
        setSel(m, caret, caret);
        V.mode = "insert";
        V.insert = { text: m.text, pos: caret };
        V.escapeArmed = 0;
        updateStatus();
        queueDraw();
    }

    function exitInsert() {
        if (V.mode !== "insert") {
            return;
        }

        const field = activeField() || V.field;

        V.field = field;

        const m = remodel();
        const session = V.insert;
        let inserted = "";

        V.insert = null;
        V.mode = "normal";

        if (m) {
            const caret = m.caret === null ? V.pos : m.caret;

            if (
                session &&
                caret >= session.pos &&
                m.text.length - session.text.length === caret - session.pos
            ) {
                inserted = m.text.slice(session.pos, caret);
            }

            V.pos = caret > T.lineStart(m.text, caret) ? caret - 1 : caret;
            V.pos = T.clampNormal(m.text, V.pos);
            V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
        }

        endChange();

        if (V.pendingDot && !V.replaying) {
            V.lastChange = { keys: V.pendingDot, text: inserted };
        }

        V.pendingDot = null;
        placeCursor();
        updateStatus();
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
                enterInsert(pos);
                return;

            case "a":
                V.pendingDot = keys;
                enterInsert(
                    T.lineEnd(text, pos) > T.lineStart(text, pos)
                        ? pos + 1
                        : pos,
                );
                return;

            case "I":
                V.pendingDot = keys;
                enterInsert(T.firstNonBlank(text, pos));
                return;

            case "A":
                V.pendingDot = keys;
                enterInsert(T.lineEnd(text, pos));
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

            case "u":
                undoRedo(true, count);
                return;

            case "<C-r>":
                undoRedo(false, count);
                return;

            case ".":
                repeatLastChange();
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

        const range = visualBounds(m);
        const remember = () => {
            V.lastVisual = { anchor: V.vAnchor, pos: V.pos, mode: V.mode };
        };
        const linewise = () => ({
            start: T.lineStart(text, range.start),
            end: T.lineEnd(text, Math.max(range.start, range.end - (range.lw ? 0 : 1))),
            lw: true,
        });
        const run = (op, r) => {
            remember();

            if (op !== "y") {
                beginChange();
            }

            applyOperator(op, r, cmd.reg);

            if (V.mode !== "insert") {
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

        if (V.mode !== "insert") {
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

    function repeatLastChange() {
        const last = V.lastChange;

        if (!last || V.replaying) {
            return;
        }

        V.replaying = true;

        try {
            beginChange();

            for (const key of last.keys) {
                feedKey(key);
            }

            if (V.mode === "insert") {
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
                return;
            }
        }

        V.keys.push(key);

        const result = parse(V.keys, isVisual());

        if (result.status === "incomplete") {
            updateStatus();
            return;
        }

        const keys = V.keys;

        V.keys = [];

        if (result.status === "done") {
            execute(result.cmd, keys);
        } else {
            updateStatus();
        }
    }

    // ======================================================================
    // Command line (":" commands and "/" search)
    // ======================================================================

    function openCmdline(type, text) {
        V.cmdline = { type, text };
        updateStatus();
        queueDraw();
    }

    function closeCmdline() {
        V.cmdline = null;

        if (V.field) {
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
        } else if (key === "<CR>") {
            V.cmdline = null;
            runCmdline(c.type, c.text);

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

    function substitute(m, l1, l2, spec) {
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
        const flags = parts.length > 2 ? parts[2] : "";

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

        beginChange();

        for (let i = edits.length - 1; i >= 0; i--) {
            replaceRange(edits[i].a, edits[i].b, edits[i].text);
        }

        V.pos = T.firstNonBlank(V.model.text, edits[edits.length - 1].a);
        endChange();
        showMessage(
            edits.length +
                " substitution" +
                (edits.length === 1 ? "" : "s"),
        );
    }

    function runCmdline(type, input) {
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
            } else {
                V.pos = T.clampNormal(m.text, p);
                V.desiredCol = V.pos - T.lineStart(m.text, V.pos);
            }

            return;
        }

        const wasVisual = isVisual();
        const range = parseLineRange(input.trim(), m);
        const rest = range.rest.trim();

        if (wasVisual) {
            setModeNormal();
            V.pos = T.clampNormal(m.text, V.pos);
        }

        if (rest === "") {
            if (range.given) {
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

        switch (name) {
            case "w":
            case "write":
                sendPython({ cmd: "w" });
                return;

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
            case "yank":
                applyOperator("y", lineRange(), null);
                return;

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

    const MODE_LABELS = {
        normal: "NORMAL",
        insert: "INSERT",
        visual: "VISUAL",
        vline: "V-LINE",
    };

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

        document.body.dataset.ankiVimMode = V.mode;

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

        el.style.display = config.show_status ? "" : "none";
        el.classList.toggle("anki-vim-cmdline", !!V.cmdline);
        el.classList.toggle("anki-vim-message", !V.cmdline && !!V.message);

        if (V.cmdline) {
            el.textContent = V.cmdline.type + V.cmdline.text + "█";
        } else if (V.message) {
            el.textContent = V.message;
        } else {
            const pending = V.keys.join("");

            el.textContent =
                MODE_LABELS[V.mode] + (pending ? "  " + pending : "");
        }
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

        return {
            left: rootRect.left + (parseFloat(style.paddingLeft) || 0),
            top: rootRect.top + (parseFloat(style.paddingTop) || 0),
            width: 0,
            height: lineHeight,
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

    function drawCursor(allowScroll) {
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
        const m = V.model;

        if (
            V.mode === "insert" ||
            V.cmdline ||
            !field ||
            !m ||
            m.root !== field ||
            activeField() !== field
        ) {
            el.style.display = "none";
            return;
        }

        let rect;

        try {
            rect = cursorRect(m, T.clamp(V.pos, 0, m.text.length));
        } catch (error) {
            el.style.display = "none";
            return;
        }

        if (allowScroll && ensureVisible(field, rect)) {
            rect = cursorRect(m, T.clamp(V.pos, 0, m.text.length));
        }

        // The block is opaque and re-draws the character it covers in
        // inverted colours. That also hides the browser's own thin caret,
        // which must not be hidden with CSS: `caret-color` set on the field
        // gets copied into the note's HTML when the browser merges lines.
        const pos = T.clamp(V.pos, 0, m.text.length);
        const ch = pos < m.text.length ? m.text[pos] : "\n";
        const c = m.chars[pos];
        const source =
            c && c.k === "t" && c.n.parentElement ? c.n.parentElement : field;
        const style = getComputedStyle(source);
        const fontSize = parseFloat(style.fontSize) || 16;
        const atom = ch === ATOM;
        let glyph = "";

        if (!atom && ch !== "\n" && !T.isBlankChar(ch)) {
            const code = ch.charCodeAt(0);
            const next = m.text[pos + 1];

            glyph =
                code >= 0xd800 && code <= 0xdbff && next ? ch + next : ch;
        }

        el.textContent = glyph;
        el.classList.toggle("anki-vim-cursor-atom", atom);
        el.style.display = "block";
        el.style.left = rect.left + "px";
        el.style.top = rect.top + "px";
        el.style.width = (rect.width > 1 ? rect.width : fontSize * 0.55) + "px";
        el.style.height = rect.height + "px";
        el.style.lineHeight = rect.height + "px";
        el.style.fontFamily = style.fontFamily;
        el.style.fontSize = style.fontSize;
        el.style.fontWeight = style.fontWeight;
        el.style.fontStyle = style.fontStyle;
        el.style.background = atom ? "" : style.color;
        el.style.color = atom ? "" : backgroundOf(field);
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
                cmdlineKey(key);
            }

            return;
        }

        if (V.mode === "insert") {
            if (resolveField(false)) {
                insertKey(event, key);
            }

            return;
        }

        if (key === PASS) {
            return;
        }

        if (key.startsWith("<C-") && !NORMAL_CTRL.has(key)) {
            return;
        }

        if (!resolveField(true)) {
            return;
        }

        swallow(event);
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

        if (V.mode === "insert") {
            exitInsert();
            return;
        }

        resolveField(false);
        feedKey("<Esc>");
    }

    let selectionTimer = 0;

    function onSelectionChange() {
        if (V.mode === "insert" || V.cmdline) {
            return;
        }

        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
            const field = activeField();

            if (!field || V.mode === "insert" || V.cmdline) {
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

            if (!field || V.mode === "insert" || V.cmdline) {
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

                if (V.mode !== "insert" && !isVisual()) {
                    sync();
                    placeCursor();
                }
            }

            drawCursor(false);
        }, 0);
    }

    function redrawSoon() {
        if (V.drawQueued) {
            return;
        }

        V.drawQueued = true;
        requestAnimationFrame(() => {
            V.drawQueued = false;

            if (V.mode !== "insert" && V.field && activeField() === V.field) {
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
                if (V.mode === "insert") {
                    exitInsert();
                } else {
                    setModeNormal();
                    updateStatus();
                }
            } else if (mode === "insert" && V.mode !== "insert") {
                if (resolveField(true) && sync()) {
                    enterInsert(V.pos);
                }
            }
        },
        message: showMessage,
        // Introspection used by the test-suite.
        _state: V,
        _internals: { buildModel, domPos, parse, remodel, sync, placeCursor, focusField, config },
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
