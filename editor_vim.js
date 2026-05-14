// editor_vim.js

(function () {
    window.ankiVim = {
        version: "debug-37-dd-cursor-visual-restore",

        mode: window.ankiVim?.mode || "normal",
        fieldIndex: window.ankiVim?.fieldIndex || 0,
        vimLineIndex: window.ankiVim?.vimLineIndex || 0,
        debugVisible: window.ankiVim?.debugVisible || false,

        lastKey: "",
        lastAction: "",
        statusEl: null,

        pendingOperator: null,
        visualAnchorOffset: null,

        yankText: window.ankiVim?.yankText || "",
        yankIsLine: window.ankiVim?.yankIsLine || false,

        pythonCaretOffset: window.ankiVim?.pythonCaretOffset || 0,

        lastPointerLineIndex: window.ankiVim?.lastPointerLineIndex ?? null,
        lastPointerFieldIndex: window.ankiVim?.lastPointerFieldIndex ?? null,
        lastPointerTime: window.ankiVim?.lastPointerTime || 0,

        lastInternalLineMoveTime: window.ankiVim?.lastInternalLineMoveTime || 0,

        lineSyncLockUntil: window.ankiVim?.lineSyncLockUntil || 0,
        lockedVimLineIndex: window.ankiVim?.lockedVimLineIndex ?? null,

        virtualBlockCursorUntil: window.ankiVim?.virtualBlockCursorUntil || 0,
        virtualBlockCursorReason:
            window.ankiVim?.virtualBlockCursorReason || "",

        init: function () {
            this.installStyle();
            this.cleanupOldLineCursor();
            this.makeStatus();
            this.installKeyHandler();
            this.installCursorTrackers();
            this.setMode(this.mode || "normal");
            console.log(
                "[Anki Vim] initialized debug-37-dd-cursor-visual-restore",
            );
        },

        cls: function (el) {
            if (!el || typeof el.className !== "string") {
                return "";
            }

            return el.className;
        },

        installStyle: function () {
            let style = document.getElementById("anki-vim-runtime-style");

            if (!style) {
                style = document.createElement("style");
                style.id = "anki-vim-runtime-style";
                document.head.appendChild(style);
            }

            style.textContent = `
                #anki-vim-status {
                    position: fixed;
                    left: 50%;
                    bottom: 0px;
                    transform: translateX(-50%);
                    z-index: 2147483647;

                    min-width: 150px;
                    padding: 7px 16px;

                    border: 1px solid rgba(255, 255, 255, 0.18);
                    border-radius: 999px;

                    background: rgba(28, 28, 32, 0.88);
                    color: #f4f4f5;

                    font-family:
                        -apple-system,
                        BlinkMacSystemFont,
                        "Segoe UI",
                        sans-serif;
                    font-size: 13px;
                    font-weight: 600;
                    letter-spacing: 0.08em;
                    text-align: center;

                    box-shadow:
                        0 8px 22px rgba(0, 0, 0, 0.22),
                        inset 0 1px 0 rgba(255, 255, 255, 0.12);

                    user-select: none;
                    pointer-events: none;

                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                }

                body[data-anki-vim-mode="normal"] #anki-vim-status {
                    background: rgba(32, 36, 44, 0.9);
                    color: #f4f4f5;
                }

                body[data-anki-vim-mode="insert"] #anki-vim-status {
                    background: rgba(24, 95, 64, 0.92);
                    color: #ecfdf5;
                }

                body[data-anki-vim-mode="visual"] #anki-vim-status {
                    background: rgba(88, 60, 150, 0.92);
                    color: #f5f3ff;
                }

                #anki-vim-debug {
                    position: fixed;
                    right: 14px;
                    bottom: 14px;
                    z-index: 2147483647;

                    max-width: 900px;
                    max-height: 520px;
                    overflow: auto;

                    padding: 10px 12px;
                    border: 1px solid rgba(255, 255, 255, 0.14);
                    border-radius: 12px;

                    background: rgba(17, 17, 20, 0.92);
                    color: #eeeeee;

                    font-family:
                        ui-monospace,
                        SFMono-Regular,
                        Menlo,
                        Consolas,
                        "Liberation Mono",
                        monospace;
                    font-size: 11px;
                    line-height: 1.45;
                    white-space: pre-wrap;
                    user-select: text;

                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);

                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                }

                .anki-vim-field-active {
                    outline: none !important;
                    outline-offset: 0 !important;
                }

                .rich-text-editable,
                [contenteditable="true"],
                [contenteditable="plaintext-only"],
                textarea,
                input {
                    caret-color: auto !important;
                }

                #anki-vim-block-cursor {
                    position: fixed;
                    z-index: 2147483647;
                    pointer-events: none;
                    background: rgba(0, 0, 0, 0.78);
                    mix-blend-mode: difference;
                    width: 9px;
                    height: 18px;
                    display: none;
                }

                #anki-vim-line-cursor,
                #anki-vim-line-highlight {
                    display: none !important;
                }
            `;
        },

        cleanupOldLineCursor: function () {
            const oldCursor = document.getElementById("anki-vim-line-cursor");
            const oldHighlight = document.getElementById(
                "anki-vim-line-highlight",
            );

            if (oldCursor) {
                oldCursor.remove();
            }

            if (oldHighlight) {
                oldHighlight.remove();
            }
        },

        makeStatus: function () {
            let el = document.getElementById("anki-vim-status");

            if (!el) {
                el = document.createElement("div");
                el.id = "anki-vim-status";
                document.body.appendChild(el);
            }

            this.statusEl = el;
            this.updateStatus();
        },

        updateStatus: function () {
            if (!this.statusEl) {
                return;
            }

            if (this.pendingOperator) {
                this.statusEl.textContent =
                    "-- " + this.pendingOperator.toUpperCase() + " --";
            } else {
                this.statusEl.textContent =
                    "-- " + this.mode.toUpperCase() + " --";
            }
        },

        setMode: function (mode) {
            this.mode = mode;
            document.body.dataset.ankiVimMode = mode;

            if (mode !== "normal") {
                this.pendingOperator = null;
            }

            this.updateStatus();
            this.ensureField();
            this.refreshFieldOutline();

            if (mode === "normal") {
                this.drawBlockCursorSoon();
            } else {
                this.removeBlockCursor();
            }

            this.updateDebugIfVisible();
        },

        installKeyHandler: function () {
            if (window.ankiVimKeyHandlerInstalledV37) {
                return;
            }

            window.ankiVimKeyHandlerInstalledV37 = true;

            document.addEventListener(
                "keydown",
                function (event) {
                    return window.ankiVim.handleKey(event);
                },
                true,
            );

            document.addEventListener(
                "keyup",
                function (event) {
                    if (!window.ankiVim) {
                        return true;
                    }

                    if (
                        window.ankiVim.mode === "visual" &&
                        (event.key === "Escape" || event.code === "Escape")
                    ) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        event.stopPropagation();
                        window.ankiVim.lastAction =
                            "visual -> normal by keyup escape";
                        window.ankiVim.exitVisualMode(false);
                        return false;
                    }

                    if (window.ankiVim.mode === "insert") {
                        window.ankiVim.scheduleSafeLineSync(
                            "insert keyup " + event.key,
                        );
                    }

                    return true;
                },
                true,
            );
        },

        installCursorTrackers: function () {
            if (window.ankiVimCursorTrackersInstalledV37) {
                return;
            }

            window.ankiVimCursorTrackersInstalledV37 = true;

            document.addEventListener(
                "mousedown",
                function (event) {
                    if (!window.ankiVim) {
                        return;
                    }

                    window.ankiVim.updateFieldFromPointerEvent(event);
                    window.ankiVim.updatePointerLineAndApply(event);
                    window.ankiVim.updateDebugIfVisible();
                },
                true,
            );

            document.addEventListener(
                "mouseup",
                function (event) {
                    if (!window.ankiVim) {
                        return;
                    }

                    window.ankiVim.updateFieldFromPointerEvent(event);
                    window.ankiVim.updatePointerLineAndApply(event);
                    window.ankiVim.scheduleSafeLineSync("mouseup");

                    if (window.ankiVim.mode === "normal") {
                        window.ankiVim.drawBlockCursorSoon();
                    }

                    window.ankiVim.updateDebugIfVisible();
                },
                true,
            );

            document.addEventListener(
                "click",
                function (event) {
                    if (!window.ankiVim) {
                        return;
                    }

                    window.ankiVim.updateFieldFromPointerEvent(event);
                    window.ankiVim.updatePointerLineAndApply(event);
                    window.ankiVim.scheduleSafeLineSync("click");
                    window.ankiVim.updateDebugIfVisible();
                },
                true,
            );

            document.addEventListener(
                "selectionchange",
                function () {
                    if (!window.ankiVim) {
                        return;
                    }

                    window.ankiVim.updateFieldIndexFromSelection();
                    window.ankiVim.scheduleSafeLineSync("selectionchange");

                    if (window.ankiVim.mode === "normal") {
                        window.ankiVim.drawBlockCursorSoon();
                    }

                    window.ankiVim.updateDebugIfVisible();
                },
                true,
            );

            document.addEventListener(
                "focusin",
                function () {
                    if (!window.ankiVim) {
                        return;
                    }

                    window.ankiVim.updateFieldIndexFromActiveElement();
                    window.ankiVim.scheduleSafeLineSync("focusin");
                    window.ankiVim.updateDebugIfVisible();
                },
                true,
            );

            document.addEventListener(
                "input",
                function () {
                    if (!window.ankiVim) {
                        return;
                    }

                    window.ankiVim.scheduleSafeLineSync("input");
                },
                true,
            );

            window.addEventListener(
                "scroll",
                function () {
                    if (window.ankiVim && window.ankiVim.mode === "normal") {
                        window.ankiVim.drawBlockCursorSoon();
                    }
                },
                true,
            );

            window.addEventListener(
                "resize",
                function () {
                    if (window.ankiVim && window.ankiVim.mode === "normal") {
                        window.ankiVim.drawBlockCursorSoon();
                    }
                },
                true,
            );
        },

        handleKey: function (event) {
            const isShiftJ =
                event.code === "KeyJ" &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.metaKey;

            const isShiftK =
                event.code === "KeyK" &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.metaKey;

            this.lastKey =
                "key=" +
                event.key +
                " code=" +
                event.code +
                " shift=" +
                event.shiftKey +
                " ctrl=" +
                event.ctrlKey +
                " alt=" +
                event.altKey +
                " isShiftJ=" +
                isShiftJ +
                " isShiftK=" +
                isShiftK;

            if (event.key === "F2") {
                event.preventDefault();
                event.stopPropagation();
                this.toggleDebug();
                return false;
            }

            if (this.mode === "insert") {
                if (event.key === "Enter") {
                    this.moveTrackedLine(1, "insert enter");
                    this.lockLineSync(this.vimLineIndex, 1400, "insert enter");
                    this.scheduleSafeLineSync("insert enter");
                    this.lastAction = "insert passthrough enter";
                    this.updateDebugIfVisible();
                    return true;
                }

                if (event.key === "Backspace") {
                    this.scheduleSafeLineSync("insert backspace");
                    this.lastAction = "insert passthrough backspace";
                    this.updateDebugIfVisible();
                    return true;
                }

                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.lastAction = "insert -> normal";
                    this.safeSyncLine("escape insert", {
                        allowPointer: true,
                        allowDom: true,
                        allowFakeZero: false,
                    });
                    this.setMode("normal");
                    return false;
                }

                this.lastAction = "insert passthrough";
                this.scheduleSafeLineSync("insert keydown " + event.key);
                this.updateDebugIfVisible();
                return true;
            }

            if (this.mode === "visual") {
                event.preventDefault();
                event.stopImmediatePropagation();
                event.stopPropagation();

                if (event.key === "Escape" || event.code === "Escape") {
                    this.lastAction = "visual -> normal";
                    this.exitVisualMode(false);
                } else if (event.key === "h") {
                    this.lastAction = "visual move left";
                    this.extendVisualSelection("backward", "character");
                    this.scheduleSafeLineSync("visual h");
                } else if (event.key === "l") {
                    this.lastAction = "visual move right";
                    this.extendVisualSelection("forward", "character");
                    this.scheduleSafeLineSync("visual l");
                } else if (event.key === "j") {
                    this.lastAction = "visual move down";
                    this.extendVisualSelection("forward", "line");
                    this.moveTrackedLine(1, "visual j");
                    this.scheduleSafeLineSync("visual j");
                } else if (event.key === "k") {
                    this.lastAction = "visual move up";
                    this.extendVisualSelection("backward", "line");
                    this.moveTrackedLine(-1, "visual k");
                    this.scheduleSafeLineSync("visual k");
                } else if (event.key === "y") {
                    const savedFieldIndex = this.fieldIndex;
                    this.yankSelection();
                    this.exitVisualMode(false, savedFieldIndex);
                    this.forceNormalCursorRestore(
                        savedFieldIndex,
                        "visual yank",
                    );
                } else if (event.key === "d") {
                    const savedFieldIndex = this.fieldIndex;
                    this.deleteSelection();
                    this.exitVisualMode(true, savedFieldIndex);
                    this.forceNormalCursorRestore(
                        savedFieldIndex,
                        "visual delete",
                    );
                } else {
                    this.lastAction = "visual ignored key";
                }

                this.refreshFieldOutline();
                this.updateDebugIfVisible();
                return false;
            }

            if (isShiftJ) {
                event.preventDefault();
                event.stopPropagation();
                this.lastAction = "shift+j next field";
                this.nextField();
                return false;
            }

            if (isShiftK) {
                event.preventDefault();
                event.stopPropagation();
                this.lastAction = "shift+k previous field";
                this.previousField();
                return false;
            }

            const handled = [
                "Escape",
                "i",
                "a",
                "o",
                "h",
                "j",
                "k",
                "l",
                "0",
                "$",
                "d",
                "y",
                "v",
                "p",
                "P",
            ];

            if (!handled.includes(event.key)) {
                this.lastAction = "normal unhandled passthrough";
                this.updateDebugIfVisible();
                return true;
            }

            event.preventDefault();
            event.stopPropagation();

            if (this.pendingOperator) {
                const op = this.pendingOperator;
                this.pendingOperator = null;
                this.updateStatus();

                this.safeSyncLine("before operator " + op, {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });

                if (op === "d" && event.key === "d") {
                    this.deleteCurrentLine();
                } else if (op === "y" && event.key === "y") {
                    this.yankCurrentLine();
                } else {
                    this.lastAction = "cancelled operator " + op;
                }

                this.refreshFieldOutline();
                this.drawBlockCursorSoon();
                this.updateDebugIfVisible();
                return false;
            }

            if (event.key === "Escape") {
                this.pendingOperator = null;
                this.lastAction = "normal";
                this.safeSyncLine("escape normal", {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.setMode("normal");
            } else if (event.key === "i") {
                this.lastAction = "normal -> insert";
                this.safeSyncLine("enter insert", {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.setMode("insert");
            } else if (event.key === "a") {
                this.lastAction = "append";
                this.moveSelection("forward", "character");
                this.scheduleSafeLineSync("append");
                this.setMode("insert");
            } else if (event.key === "o") {
                this.lastAction = "open line below";
                this.openLineBelow();
            } else if (event.key === "h") {
                this.lastAction = "move left";
                this.moveSelection("backward", "character");
                this.scheduleSafeLineSync("h");
            } else if (event.key === "l") {
                this.lastAction = "move right";
                this.moveSelection("forward", "character");
                this.scheduleSafeLineSync("l");
            } else if (event.key === "j") {
                this.lastAction = "move down";
                this.moveSelection("forward", "line");
                this.moveTrackedLine(1, "normal j");
                this.scheduleSafeLineSync("j");
            } else if (event.key === "k") {
                this.lastAction = "move up";
                this.moveSelection("backward", "line");
                this.moveTrackedLine(-1, "normal k");
                this.scheduleSafeLineSync("k");
            } else if (event.key === "0") {
                this.lastAction = "line start";
                this.moveSelection("backward", "lineboundary");
                this.scheduleSafeLineSync("0");
            } else if (event.key === "$") {
                this.lastAction = "line end";
                this.moveSelection("forward", "lineboundary");
                this.scheduleSafeLineSync("$");
            } else if (event.key === "d") {
                this.safeSyncLine("operator d", {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.pendingOperator = "d";
                this.lastAction = "waiting for delete motion";
                this.updateStatus();
            } else if (event.key === "y") {
                this.safeSyncLine("operator y", {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.pendingOperator = "y";
                this.lastAction = "waiting for yank motion";
                this.updateStatus();
            } else if (event.key === "v") {
                this.enterVisualMode();
            } else if (event.key === "p") {
                this.safeSyncLine("paste p", {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.pasteYankText("p");
            } else if (event.key === "P") {
                this.safeSyncLine("paste P", {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.pasteYankText("P");
            }

            this.refreshFieldOutline();
            this.drawBlockCursorSoon();
            this.updateDebugIfVisible();
            return false;
        },

        candidateFields: function () {
            let nodes = [];

            const selectors = [
                ".rich-text-editable",
                "[contenteditable='true']",
                "[contenteditable='plaintext-only']",
            ];

            for (const selector of selectors) {
                for (const el of Array.from(
                    document.querySelectorAll(selector),
                )) {
                    nodes.push(el);
                }
            }

            nodes = Array.from(new Set(nodes));

            nodes = nodes.filter((el) => {
                if (!el) {
                    return false;
                }

                const cls = this.cls(el).toLowerCase();
                const id = (el.id || "").toLowerCase();
                const role = (el.getAttribute("role") || "").toLowerCase();
                const aria = (
                    el.getAttribute("aria-label") || ""
                ).toLowerCase();
                const tag = el.tagName.toLowerCase();
                const rect = el.getBoundingClientRect();

                if (rect.width < 50 || rect.height < 10) {
                    return false;
                }

                if (
                    tag === "button" ||
                    tag === "select" ||
                    tag === "input" ||
                    tag === "textarea"
                ) {
                    return false;
                }

                if (cls.includes("tag-spacer")) {
                    return false;
                }

                if (id.includes("tag") || aria.includes("tag")) {
                    return false;
                }

                if (role === "textbox" && cls.includes("tag")) {
                    return false;
                }

                if (cls.includes("rich-text-editable")) {
                    return true;
                }

                if (el.isContentEditable) {
                    return true;
                }

                const ce = el.getAttribute("contenteditable");
                return ce === "true" || ce === "plaintext-only";
            });

            nodes.sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();

                if (Math.abs(ar.top - br.top) > 5) {
                    return ar.top - br.top;
                }

                return ar.left - br.left;
            });

            return nodes;
        },

        fields: function () {
            return this.candidateFields();
        },

        fieldByIndex: function (index) {
            const fields = this.fields();

            if (fields.length === 0) {
                return null;
            }

            let safeIndex = index;

            if (safeIndex === undefined || safeIndex === null) {
                safeIndex = this.fieldIndex || 0;
            }

            safeIndex = Math.max(
                0,
                Math.min(Number(safeIndex) || 0, fields.length - 1),
            );

            this.fieldIndex = safeIndex;
            return fields[safeIndex];
        },

        updateFieldIndexFromActiveElement: function () {
            const fields = this.fields();
            const active = document.activeElement;

            if (!active) {
                return false;
            }

            for (let i = 0; i < fields.length; i++) {
                const container = this.fieldContainer(fields[i]);
                const control = this.editorControl(fields[i]);

                if (
                    fields[i] === active ||
                    fields[i].contains(active) ||
                    control === active ||
                    (container && container.contains(active))
                ) {
                    const oldIndex = this.fieldIndex;
                    this.fieldIndex = i;

                    if (oldIndex !== i) {
                        this.vimLineIndex = 0;
                    }

                    this.syncPythonCurrentField(i);
                    return true;
                }
            }

            return false;
        },

        updateFieldIndexFromSelection: function () {
            const fields = this.fields();
            const sel = window.getSelection();

            if (!sel || sel.rangeCount === 0) {
                return false;
            }

            let node = sel.getRangeAt(0).startContainer;

            if (node && node.nodeType === Node.TEXT_NODE) {
                node = node.parentElement;
            }

            while (node && node !== document.body) {
                for (let i = 0; i < fields.length; i++) {
                    const container = this.fieldContainer(fields[i]);

                    if (
                        fields[i] === node ||
                        fields[i].contains(node) ||
                        (container && container.contains(node))
                    ) {
                        const oldIndex = this.fieldIndex;
                        this.fieldIndex = i;

                        if (oldIndex !== i) {
                            this.vimLineIndex = 0;
                        }

                        this.syncPythonCurrentField(i);
                        return true;
                    }
                }

                node = node.parentElement;
            }

            return false;
        },

        fieldContainer: function (field) {
            let node = field;

            while (node && node !== document.body) {
                const cls = this.cls(node).toLowerCase();
                const role = (node.getAttribute?.("role") || "").toLowerCase();

                if (
                    cls.includes("field-container") ||
                    role === "presentation"
                ) {
                    return node;
                }

                node = node.parentElement;
            }

            return field ? field.parentElement || field : null;
        },

        updateFieldFromPointerEvent: function (event) {
            const fields = this.fields();

            let index = -1;

            for (let i = 0; i < fields.length; i++) {
                const field = fields[i];
                const container = this.fieldContainer(field);
                const rect = (container || field).getBoundingClientRect();

                const inside =
                    event.clientY >= rect.top &&
                    event.clientY <= rect.bottom &&
                    event.clientX >= rect.left &&
                    event.clientX <= rect.right;

                if (inside) {
                    index = i;
                    break;
                }
            }

            if (index < 0) {
                return false;
            }

            const oldIndex = this.fieldIndex;
            this.fieldIndex = index;

            if (oldIndex !== index) {
                this.vimLineIndex = 0;
            }

            this.syncPythonCurrentField(index);
            this.refreshFieldOutline();
            this.drawBlockCursorSoon();

            return true;
        },

        updatePointerLineAndApply: function (event) {
            const field = this.fieldByIndex(this.fieldIndex);

            if (!field) {
                return false;
            }

            const rect = field.getBoundingClientRect();

            if (!rect || rect.height <= 0) {
                return false;
            }

            const style = window.getComputedStyle(field);
            const paddingTop = parseFloat(style.paddingTop || "0") || 0;
            const lineHeight = this.lineHeightPx(field);

            let lineIndex = Math.floor(
                (event.clientY - rect.top - paddingTop) / lineHeight,
            );

            lineIndex = Math.max(0, lineIndex);

            this.lastPointerLineIndex = lineIndex;
            this.lastPointerFieldIndex = this.fieldIndex;
            this.lastPointerTime = Date.now();

            this.vimLineIndex = lineIndex;
            this.normalizeVimLineIndex();

            this.lastAction =
                "pointer line field=" +
                this.fieldIndex +
                " line=" +
                this.vimLineIndex;

            return true;
        },

        syncPythonCurrentField: function (index) {
            try {
                if (typeof pycmd === "function") {
                    pycmd("focus:" + index);
                }
            } catch (error) {
                console.log("[Anki Vim] pycmd focus failed", error);
            }
        },

        isVisibleControl: function (el, fieldRect) {
            if (!el) {
                return false;
            }

            const tag = el.tagName ? el.tagName.toLowerCase() : "";

            if (tag !== "textarea" && tag !== "input") {
                return false;
            }

            const type = (el.getAttribute("type") || "").toLowerCase();

            if (
                type === "hidden" ||
                type === "button" ||
                type === "submit" ||
                type === "checkbox" ||
                type === "radio"
            ) {
                return false;
            }

            const rect = el.getBoundingClientRect();

            if (rect.width <= 0 || rect.height <= 0) {
                return false;
            }

            if (!fieldRect) {
                return true;
            }

            const overlaps =
                rect.bottom >= fieldRect.top &&
                rect.top <= fieldRect.bottom &&
                rect.right >= fieldRect.left &&
                rect.left <= fieldRect.right;

            return overlaps;
        },

        editorControl: function (field) {
            if (!field) {
                return null;
            }

            const active = document.activeElement;

            if (active && (active.tagName || "").toLowerCase() === "textarea") {
                return active;
            }

            if (
                active &&
                (active.tagName || "").toLowerCase() === "input" &&
                typeof active.value === "string"
            ) {
                return active;
            }

            const container = this.fieldContainer(field);
            const fieldRect = field.getBoundingClientRect();
            const candidates = [];

            if (container && container.querySelectorAll) {
                for (const el of Array.from(
                    container.querySelectorAll("textarea, input"),
                )) {
                    if (this.isVisibleControl(el, fieldRect)) {
                        candidates.push(el);
                    }
                }
            }

            if (field.querySelectorAll) {
                for (const el of Array.from(
                    field.querySelectorAll("textarea, input"),
                )) {
                    if (this.isVisibleControl(el, fieldRect)) {
                        candidates.push(el);
                    }
                }
            }

            const unique = Array.from(new Set(candidates));

            if (unique.length === 0) {
                return null;
            }

            unique.sort((a, b) => {
                const av = typeof a.value === "string" ? a.value.length : 0;
                const bv = typeof b.value === "string" ? b.value.length : 0;

                if (bv !== av) {
                    return bv - av;
                }

                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();

                return ar.top - br.top;
            });

            return unique[0];
        },

        nodePlainText: function (node) {
            if (!node) {
                return "";
            }

            if (typeof node.value === "string") {
                return node.value;
            }

            let text = node.innerText;

            if (text === undefined || text === null) {
                text = node.textContent || "";
            }

            return String(text).replace(/\n$/, "");
        },

        getFieldPlainText: function (field) {
            const control = this.editorControl(field);

            if (control) {
                return control.value || "";
            }

            return this.nodePlainText(field);
        },

        isBlockElement: function (node) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) {
                return false;
            }

            const tag = node.tagName.toLowerCase();

            return [
                "div",
                "p",
                "li",
                "section",
                "article",
                "header",
                "footer",
                "blockquote",
                "pre",
            ].includes(tag);
        },

        fragmentToPlainText: function (root) {
            let out = "";

            const walk = (node) => {
                if (!node) {
                    return;
                }

                if (node.nodeType === Node.TEXT_NODE) {
                    out += node.nodeValue || "";
                    return;
                }

                if (node.nodeType !== Node.ELEMENT_NODE) {
                    for (const child of Array.from(node.childNodes || [])) {
                        walk(child);
                    }

                    return;
                }

                const tag = node.tagName.toLowerCase();

                if (tag === "br") {
                    out += "\n";
                    return;
                }

                const isBlock = this.isBlockElement(node);
                const before = out.length;

                for (const child of Array.from(node.childNodes || [])) {
                    walk(child);
                }

                if (isBlock && out.length === before) {
                    out += "\n";
                    return;
                }

                if (isBlock && out.length > 0 && !out.endsWith("\n")) {
                    out += "\n";
                }
            };

            for (const child of Array.from(root.childNodes || [])) {
                walk(child);
            }

            return out;
        },

        isProbablyFakeRootZeroSelection: function (field, range, beforeText) {
            if (!field || !range) {
                return false;
            }

            const start = range.startContainer;
            const offset = range.startOffset || 0;

            const text = this.getFieldPlainText(field);
            const fieldHasMultipleLines = String(text || "").includes("\n");

            if (!fieldHasMultipleLines) {
                return false;
            }

            if (offset !== 0) {
                return false;
            }

            if (beforeText && beforeText.length > 0) {
                return false;
            }

            if (start === field) {
                return true;
            }

            if (start && start.nodeType === Node.ELEMENT_NODE) {
                const el = start;
                const cls = this.cls(el).toLowerCase();

                if (
                    el === field ||
                    cls.includes("rich-text") ||
                    cls.includes("relative") ||
                    cls.includes("editable") ||
                    field.contains(el)
                ) {
                    return true;
                }
            }

            return false;
        },

        getCaretLineIndexFromDomSelection: function (field) {
            const sel = window.getSelection();

            if (!field || !sel || sel.rangeCount === 0) {
                return null;
            }

            const range = sel.getRangeAt(0);

            if (
                !field.contains(range.startContainer) &&
                field !== range.startContainer
            ) {
                return null;
            }

            try {
                const pre = document.createRange();
                pre.selectNodeContents(field);
                pre.setEnd(range.startContainer, range.startOffset);

                const fragment = pre.cloneContents();
                const beforeText = this.fragmentToPlainText(fragment);

                if (
                    this.isProbablyFakeRootZeroSelection(
                        field,
                        range,
                        beforeText,
                    )
                ) {
                    return null;
                }

                let lineIndex = beforeText.split("\n").length - 1;
                lineIndex = Math.max(0, lineIndex);

                return lineIndex;
            } catch (error) {
                return null;
            }
        },

        lockLineSync: function (lineIndex, durationMs, reason) {
            this.vimLineIndex = Math.max(0, Number(lineIndex) || 0);
            this.lockedVimLineIndex = this.vimLineIndex;
            this.lineSyncLockUntil = Date.now() + (durationMs || 1200);
            this.lastInternalLineMoveTime = Date.now();
            this.lastAction =
                "locked line sync reason=" +
                reason +
                " line=" +
                this.vimLineIndex;
        },

        forceVirtualBlockCursor: function (durationMs, reason) {
            this.virtualBlockCursorUntil = Date.now() + (durationMs || 1200);
            this.virtualBlockCursorReason = reason || "";
            this.drawBlockCursorSoon();
        },

        scheduleSafeLineSync: function (reason) {
            setTimeout(() => {
                this.safeSyncLine(reason + " t0", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
            }, 0);

            setTimeout(() => {
                this.safeSyncLine(reason + " t50", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
            }, 50);

            setTimeout(() => {
                this.safeSyncLine(reason + " t160", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
            }, 160);
        },

        safeSyncLine: function (reason, options) {
            const opts = options || {};
            const allowPointer = opts.allowPointer !== false;
            const allowDom = opts.allowDom !== false;

            const field =
                this.currentField() || this.fieldByIndex(this.fieldIndex);

            if (!field) {
                return false;
            }

            const lockActive =
                this.lockedVimLineIndex !== null &&
                Date.now() < this.lineSyncLockUntil;

            const control = this.editorControl(field);

            if (control && typeof control.value === "string") {
                const text = control.value || "";
                const caret = control.selectionStart || 0;

                const controlLine = this.lineIndexFromOffset(text, caret);

                if (
                    lockActive &&
                    controlLine === 0 &&
                    this.lockedVimLineIndex > 0
                ) {
                    this.vimLineIndex = this.lockedVimLineIndex;
                    this.normalizeVimLineIndex();

                    this.lastAction =
                        "kept locked line from fake control zero reason=" +
                        reason +
                        " line=" +
                        this.vimLineIndex;

                    return false;
                }

                this.vimLineIndex = controlLine;
                this.normalizeVimLineIndex();

                this.lastAction =
                    "synced line from control reason=" +
                    reason +
                    " line=" +
                    this.vimLineIndex;

                return true;
            }

            if (
                allowPointer &&
                this.lastPointerFieldIndex === this.fieldIndex &&
                this.lastPointerLineIndex !== null &&
                this.lastPointerTime >= this.lastInternalLineMoveTime &&
                Date.now() - this.lastPointerTime < 1600
            ) {
                this.vimLineIndex = this.lastPointerLineIndex;
                this.normalizeVimLineIndex();

                this.lastAction =
                    "synced line from pointer reason=" +
                    reason +
                    " line=" +
                    this.vimLineIndex;

                return true;
            }

            if (allowDom) {
                const domLine = this.getCaretLineIndexFromDomSelection(field);

                if (domLine !== null && domLine !== undefined) {
                    if (
                        lockActive &&
                        domLine === 0 &&
                        this.lockedVimLineIndex > 0
                    ) {
                        this.vimLineIndex = this.lockedVimLineIndex;
                        this.normalizeVimLineIndex();

                        this.lastAction =
                            "kept locked line from fake DOM zero reason=" +
                            reason +
                            " line=" +
                            this.vimLineIndex;

                        return false;
                    }

                    if (
                        domLine === 0 &&
                        this.vimLineIndex > 0 &&
                        Date.now() - this.lastInternalLineMoveTime < 1200
                    ) {
                        this.normalizeVimLineIndex();
                        this.lastAction =
                            "ignored fake DOM zero reason=" +
                            reason +
                            " kept line=" +
                            this.vimLineIndex;
                        return false;
                    }

                    this.vimLineIndex = domLine;
                    this.normalizeVimLineIndex();

                    this.lastAction =
                        "synced line from DOM reason=" +
                        reason +
                        " line=" +
                        this.vimLineIndex;

                    return true;
                }
            }

            this.normalizeVimLineIndex();
            return false;
        },

        normalizeVimLineIndex: function () {
            const parsed = Number(this.vimLineIndex);

            if (!Number.isFinite(parsed)) {
                this.vimLineIndex = 0;
            } else {
                this.vimLineIndex = Math.floor(parsed);
            }

            if (this.vimLineIndex < 0) {
                this.vimLineIndex = 0;
            }

            return this.vimLineIndex;
        },

        lineIndexFromOffset: function (text, offset) {
            const safeOffset = Math.max(0, Math.min(offset || 0, text.length));
            return text.slice(0, safeOffset).split("\n").length - 1;
        },

        offsetForLineIndex: function (text, lineIndex) {
            const lines = String(text || "").split("\n");
            const safeLine = Math.max(
                0,
                Math.min(Number(lineIndex) || 0, lines.length - 1),
            );

            let offset = 0;

            for (let i = 0; i < safeLine; i++) {
                offset += lines[i].length + 1;
            }

            return offset;
        },

        getCurrentFieldLineCountDebugOnly: function () {
            const field = this.fieldByIndex(this.fieldIndex);

            if (!field) {
                return 1;
            }

            const text = this.getFieldPlainText(field);

            if (text === "") {
                return 1;
            }

            return Math.max(1, text.split("\n").length);
        },

        currentField: function () {
            const fields = this.fields();

            if (fields.length === 0) {
                return null;
            }

            if (this.updateFieldIndexFromActiveElement()) {
                return fields[this.fieldIndex];
            }

            if (this.updateFieldIndexFromSelection()) {
                return fields[this.fieldIndex];
            }

            this.fieldIndex = Math.max(
                0,
                Math.min(this.fieldIndex || 0, fields.length - 1),
            );

            return fields[this.fieldIndex];
        },

        moveTrackedLine: function (delta, reason) {
            this.vimLineIndex = (Number(this.vimLineIndex) || 0) + delta;
            this.normalizeVimLineIndex();
            this.lastInternalLineMoveTime = Date.now();

            this.lastAction =
                "tracked vimLineIndex=" +
                this.vimLineIndex +
                " reason=" +
                reason +
                " jsLineCountDebugOnly=" +
                this.getCurrentFieldLineCountDebugOnly();
        },

        sendPythonLineOp: function (op) {
            const field =
                this.currentField() || this.fieldByIndex(this.fieldIndex);

            let caretOffset = 0;

            if (field) {
                this.safeSyncLine("send op " + op, {
                    allowPointer: true,
                    allowDom: true,
                    allowFakeZero: false,
                });
                caretOffset = this.getCaretOffsetInField(field);
            }

            this.normalizeVimLineIndex();

            const payload = {
                op: op,
                fieldIndex: this.fieldIndex,
                caretOffset: caretOffset,
                vimLineIndex: this.vimLineIndex,
                yankText: this.yankText || "",
                yankIsLine: !!this.yankIsLine,
            };

            try {
                if (typeof pycmd === "function") {
                    pycmd("anki_vim:" + JSON.stringify(payload));
                    this.lastAction =
                        "sent python op " +
                        op +
                        " fieldIndex=" +
                        payload.fieldIndex +
                        " vimLineIndex=" +
                        payload.vimLineIndex;
                } else {
                    this.lastAction = "python op failed: no pycmd";
                }
            } catch (error) {
                this.lastAction = "python op failed: " + error;
            }

            this.refreshFieldOutline();
            this.drawBlockCursorSoon();
            this.updateDebugIfVisible();
        },

        receivePythonLineOp: function (result) {
            if (!result) {
                return;
            }

            if (result.yankText !== undefined) {
                this.yankText = result.yankText;
            }

            if (result.yankIsLine !== undefined) {
                this.yankIsLine = !!result.yankIsLine;
            }

            if (result.fieldIndex !== undefined) {
                this.fieldIndex = result.fieldIndex;
            }

            if (result.caretOffset !== undefined) {
                this.pythonCaretOffset = result.caretOffset;
            }

            if (result.vimLineIndex !== undefined) {
                this.vimLineIndex = result.vimLineIndex;
            } else if (result.currentLineIndex !== undefined) {
                this.vimLineIndex = result.currentLineIndex;
            } else if (result.lineIndexHint !== undefined) {
                this.vimLineIndex = result.lineIndexHint;
            }

            this.normalizeVimLineIndex();

            /*
              dd/p reload the field, so Anki may briefly report the caret at
              the bottom or wrapper offset 0. Lock the Python-confirmed line and
              draw a virtual block cursor long enough for the editor to settle.
            */
            this.lockLineSync(
                this.vimLineIndex,
                1800,
                "python result " + result.op,
            );
            this.forceVirtualBlockCursor(1800, "python result " + result.op);

            this.pendingOperator = null;
            this.mode = "normal";
            document.body.dataset.ankiVimMode = "normal";
            this.updateStatus();

            this.lastAction = result.action || result.error || "python op done";

            const wantedFieldIndex = this.fieldIndex;
            const wantedCaretOffset =
                result.caretOffset !== undefined
                    ? result.caretOffset
                    : this.pythonCaretOffset || 0;

            const refocus = () => {
                const field = this.fieldByIndex(wantedFieldIndex);

                if (!field) {
                    this.lastAction += " | refocus failed: no field";
                    this.updateDebugIfVisible();
                    return;
                }

                this.focusFieldElement(field, false);

                const restored = this.setCaretOffsetInField(
                    field,
                    wantedCaretOffset,
                );

                if (!restored) {
                    this.focusFieldElement(field, false);
                }

                this.vimLineIndex =
                    this.lockedVimLineIndex ?? this.vimLineIndex;
                this.normalizeVimLineIndex();
                this.refreshFieldOutline();
                this.drawBlockCursor();
                this.updateDebugIfVisible();
            };

            setTimeout(refocus, 0);
            setTimeout(refocus, 80);
            setTimeout(refocus, 180);
            setTimeout(refocus, 360);
            setTimeout(refocus, 720);
        },

        nativeFocusField: function (index, end) {
            const fields = this.fields();

            if (fields.length === 0) {
                this.lastAction = "nativeFocusField failed: no fields";
                this.updateDebugIfVisible();
                return;
            }

            if (index < 0) {
                index = fields.length - 1;
            }

            if (index >= fields.length) {
                index = 0;
            }

            this.fieldIndex = index;
            this.syncPythonCurrentField(index);

            this.vimLineIndex = end ? 999999 : 0;
            this.normalizeVimLineIndex();

            try {
                if (
                    typeof window.focusField === "function" &&
                    window.focusField !== this.nativeFocusField
                ) {
                    window.focusField(index);
                }
            } catch (error) {
                console.log(
                    "[Anki Vim] native window.focusField failed",
                    error,
                );
            }

            const field = fields[index];

            try {
                field.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                });
            } catch (error) {}

            this.focusFieldElement(field, end);
            this.lastAction =
                "native focused field index " +
                index +
                " total=" +
                fields.length +
                " vimLineIndex=" +
                this.vimLineIndex;

            this.forceRefocusAndCursor(field);
        },

        focusField: function (index, end) {
            this.nativeFocusField(index, end);
        },

        focusFieldElement: function (field, end) {
            if (!field) {
                return;
            }

            const control = this.editorControl(field);

            if (control) {
                try {
                    control.focus({ preventScroll: true });
                } catch (error) {
                    control.focus();
                }

                const pos = end ? control.value.length : 0;

                try {
                    control.setSelectionRange(pos, pos);
                } catch (error) {}

                this.safeSyncLine("focus control", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
                return;
            }

            try {
                field.focus({ preventScroll: true });
            } catch (error) {
                try {
                    field.focus();
                } catch (innerError) {}
            }
        },

        ensureField: function () {
            let field = this.currentField();

            if (!field) {
                this.focusField(this.fieldIndex, true);
                field = this.currentField();
            } else {
                const control = this.editorControl(field);

                try {
                    (control || field).focus({ preventScroll: true });
                } catch (error) {
                    try {
                        (control || field).focus();
                    } catch (innerError) {}
                }
            }

            return field;
        },

        forceRefocusAndCursor: function (field) {
            const target =
                field ||
                this.currentField() ||
                this.fieldByIndex(this.fieldIndex);

            if (!target) {
                return;
            }

            const tick = () => {
                const control = this.editorControl(target);

                try {
                    (control || target).focus({ preventScroll: true });
                } catch (error) {
                    try {
                        (control || target).focus();
                    } catch (innerError) {}
                }

                this.refreshFieldOutline();
                this.drawBlockCursor();
                this.updateDebugIfVisible();
            };

            tick();
            setTimeout(tick, 0);
            setTimeout(tick, 80);
            setTimeout(tick, 180);
        },

        forceNormalCursorRestore: function (fieldIndex, reason) {
            const wantedFieldIndex =
                fieldIndex !== undefined && fieldIndex !== null
                    ? fieldIndex
                    : this.fieldIndex;

            this.forceVirtualBlockCursor(1400, reason);

            const restore = () => {
                this.mode = "normal";
                this.pendingOperator = null;
                this.visualAnchorOffset = null;
                document.body.dataset.ankiVimMode = "normal";
                this.updateStatus();

                const field = this.fieldByIndex(wantedFieldIndex);

                if (field) {
                    try {
                        field.focus({ preventScroll: true });
                    } catch (error) {
                        try {
                            field.focus();
                        } catch (innerError) {}
                    }

                    this.refreshFieldOutline();
                }

                this.drawBlockCursor();
                this.updateDebugIfVisible();

                this.lastAction =
                    (this.lastAction || "") +
                    " | restored normal cursor after " +
                    reason;
            };

            restore();
            setTimeout(restore, 0);
            setTimeout(restore, 60);
            setTimeout(restore, 140);
            setTimeout(restore, 280);
            setTimeout(restore, 520);
        },

        moveSelection: function (direction, granularity) {
            const field = this.ensureField();

            if (!field) {
                this.lastAction = "move failed: no field";
                return;
            }

            const control = this.editorControl(field);

            if (control) {
                this.moveControlSelection(control, direction, granularity);
                this.safeSyncLine("move control", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.drawBlockCursorSoon();
                return;
            }

            const sel = window.getSelection();

            if (!sel || sel.rangeCount === 0) {
                this.focusField(this.fieldIndex, true);
                return;
            }

            try {
                sel.modify("move", direction, granularity);
            } catch (error) {
                console.log("[Anki Vim] selection.modify failed", error);
                this.lastAction = "move failed: " + error;
            }

            this.drawBlockCursorSoon();
        },

        moveControlSelection: function (control, direction, granularity) {
            const text = control.value || "";
            let pos = control.selectionStart || 0;

            if (granularity === "character") {
                pos += direction === "forward" ? 1 : -1;
            } else if (granularity === "lineboundary") {
                const bounds = this.getLineBounds(text, pos, false);
                pos = direction === "forward" ? bounds.end : bounds.start;
            } else if (granularity === "line") {
                const lines = text.split("\n");
                let currentLine = 0;
                let column = 0;
                let running = 0;

                for (let i = 0; i < lines.length; i++) {
                    const lineLen = lines[i].length;

                    if (pos <= running + lineLen) {
                        currentLine = i;
                        column = pos - running;
                        break;
                    }

                    running += lineLen + 1;
                }

                let nextLine = currentLine + (direction === "forward" ? 1 : -1);
                nextLine = Math.max(0, Math.min(nextLine, lines.length - 1));

                let nextOffset = 0;

                for (let i = 0; i < nextLine; i++) {
                    nextOffset += lines[i].length + 1;
                }

                pos = nextOffset + Math.min(column, lines[nextLine].length);
            }

            pos = Math.max(0, Math.min(pos, text.length));

            try {
                control.setSelectionRange(pos, pos);
            } catch (error) {}
        },

        dispatchInputForField: function (field, inputType, data) {
            const control = this.editorControl(field);

            for (const target of [control, field]) {
                if (!target) {
                    continue;
                }

                try {
                    target.dispatchEvent(
                        new InputEvent("input", {
                            bubbles: true,
                            cancelable: false,
                            inputType: inputType || "insertText",
                            data: data || null,
                        }),
                    );
                } catch (error) {
                    try {
                        target.dispatchEvent(
                            new Event("input", {
                                bubbles: true,
                                cancelable: false,
                            }),
                        );
                    } catch (innerError) {}
                }

                try {
                    target.dispatchEvent(
                        new Event("change", {
                            bubbles: true,
                            cancelable: false,
                        }),
                    );
                } catch (error) {}
            }
        },

        getCaretOffsetInField: function (field) {
            const control = this.editorControl(field);

            if (control) {
                return Math.max(
                    0,
                    Math.min(control.selectionStart || 0, control.value.length),
                );
            }

            const sel = window.getSelection();

            if (!field || !sel || sel.rangeCount === 0) {
                return this.pythonCaretOffset || 0;
            }

            const range = sel.getRangeAt(0);

            if (
                !field.contains(range.startContainer) &&
                field !== range.startContainer
            ) {
                return this.pythonCaretOffset || 0;
            }

            try {
                const pre = document.createRange();
                pre.selectNodeContents(field);
                pre.setEnd(range.startContainer, range.startOffset);

                const fragment = pre.cloneContents();
                const beforeText = this.fragmentToPlainText(fragment);

                if (
                    this.isProbablyFakeRootZeroSelection(
                        field,
                        range,
                        beforeText,
                    )
                ) {
                    return this.pythonCaretOffset || 0;
                }

                return beforeText.length;
            } catch (error) {
                return this.pythonCaretOffset || 0;
            }
        },

        setCaretOffsetInField: function (field, offset) {
            if (!field) {
                return false;
            }

            const control = this.editorControl(field);

            if (control) {
                const pos = Math.max(0, Math.min(offset, control.value.length));

                try {
                    control.focus({ preventScroll: true });
                } catch (error) {
                    control.focus();
                }

                try {
                    control.setSelectionRange(pos, pos);
                } catch (error) {}

                this.safeSyncLine("set caret control", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
                return true;
            }

            try {
                field.focus({ preventScroll: true });
            } catch (error) {
                try {
                    field.focus();
                } catch (innerError) {}
            }

            return true;
        },

        getLineBounds: function (text, offset, includeNewline) {
            const safeOffset = Math.max(0, Math.min(offset, text.length));

            let start = text.lastIndexOf("\n", Math.max(0, safeOffset - 1));

            if (start === -1) {
                start = 0;
            } else {
                start = start + 1;
            }

            let end = text.indexOf("\n", safeOffset);

            if (end === -1) {
                end = text.length;
            } else if (includeNewline) {
                end = end + 1;
            }

            return {
                start: start,
                end: end,
            };
        },

        lineHeightPx: function (field) {
            try {
                const style = window.getComputedStyle(field);
                const lineHeight = parseFloat(style.lineHeight);

                if (!Number.isNaN(lineHeight) && lineHeight > 0) {
                    return lineHeight;
                }

                const fontSize = parseFloat(style.fontSize);

                if (!Number.isNaN(fontSize) && fontSize > 0) {
                    return fontSize * 1.2;
                }
            } catch (error) {}

            return 20;
        },

        replaceFieldPlainText: function (
            field,
            newText,
            caretOffset,
            inputType,
        ) {
            const control = this.editorControl(field);

            if (control) {
                const safeCaret = Math.max(
                    0,
                    Math.min(caretOffset || 0, newText.length),
                );

                control.value = newText;
                this.dispatchInputForField(
                    field,
                    inputType || "insertText",
                    newText,
                );

                try {
                    control.focus({ preventScroll: true });
                } catch (error) {
                    control.focus();
                }

                try {
                    control.setSelectionRange(safeCaret, safeCaret);
                } catch (error) {}

                this.safeSyncLine("replace text", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.forceRefocusAndCursor(field);
                return true;
            }

            return false;
        },

        yankCurrentLine: function () {
            this.sendPythonLineOp("yy");
        },

        deleteCurrentLine: function () {
            this.sendPythonLineOp("dd");
        },

        enterVisualMode: function () {
            const field = this.ensureField();

            if (!field) {
                this.lastAction = "visual failed: no field";
                return;
            }

            this.safeSyncLine("enter visual", {
                allowPointer: true,
                allowDom: true,
                allowFakeZero: false,
            });

            const control = this.editorControl(field);

            if (control) {
                const caret = control.selectionStart || 0;
                const end = Math.min(caret + 1, control.value.length);

                this.visualAnchorOffset = caret;

                this.mode = "visual";
                document.body.dataset.ankiVimMode = "visual";
                this.pendingOperator = null;
                this.lastAction = "entered visual mode";
                this.updateStatus();

                try {
                    control.setSelectionRange(caret, end);
                } catch (error) {}

                this.removeBlockCursor();
                this.updateDebugIfVisible();
                return;
            }

            const sel = window.getSelection();

            if (!sel || sel.rangeCount === 0) {
                this.lastAction = "visual failed: no range";
                return;
            }

            this.mode = "visual";
            document.body.dataset.ankiVimMode = "visual";
            this.pendingOperator = null;
            this.lastAction = "entered visual mode";
            this.updateStatus();

            try {
                sel.modify("extend", "forward", "character");
            } catch (error) {}

            this.removeBlockCursor();
            this.updateDebugIfVisible();
        },

        exitVisualMode: function (collapseToStart, forcedFieldIndex) {
            const savedFieldIndex =
                forcedFieldIndex !== undefined && forcedFieldIndex !== null
                    ? forcedFieldIndex
                    : this.fieldIndex;

            const field =
                this.currentField() || this.fieldByIndex(savedFieldIndex);
            const control = field ? this.editorControl(field) : null;
            let finalOffset = this.pythonCaretOffset || 0;

            if (control) {
                const start = control.selectionStart || 0;
                const end = control.selectionEnd || 0;
                const pos = collapseToStart
                    ? Math.min(start, end)
                    : Math.max(start, end);

                try {
                    control.setSelectionRange(pos, pos);
                } catch (error) {}

                finalOffset = pos;
                this.safeSyncLine("exit visual control", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
            } else if (field) {
                const sel = window.getSelection();

                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0).cloneRange();
                    range.collapse(!!collapseToStart);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    this.safeSyncLine("exit visual dom", {
                        allowPointer: false,
                        allowDom: true,
                        allowFakeZero: false,
                    });
                }
            }

            this.mode = "normal";
            this.pendingOperator = null;
            this.visualAnchorOffset = null;
            document.body.dataset.ankiVimMode = "normal";
            this.updateStatus();
            this.forceVirtualBlockCursor(1400, "exit visual");

            const refocus = () => {
                const target = this.fieldByIndex(savedFieldIndex) || field;

                if (!target) {
                    return;
                }

                this.setCaretOffsetInField(target, finalOffset);
                this.forceRefocusAndCursor(target);
                this.refreshFieldOutline();
                this.drawBlockCursor();
                this.updateDebugIfVisible();
            };

            refocus();
            setTimeout(refocus, 0);
            setTimeout(refocus, 80);
            setTimeout(refocus, 180);
            setTimeout(refocus, 360);
        },

        extendVisualSelection: function (direction, granularity) {
            const field = this.ensureField();

            if (!field) {
                this.lastAction = "visual move failed: no field";
                return;
            }

            const control = this.editorControl(field);

            if (control) {
                const text = control.value || "";
                const anchor =
                    this.visualAnchorOffset === null
                        ? control.selectionStart || 0
                        : this.visualAnchorOffset;

                let focus = control.selectionEnd || 0;

                if (granularity === "character") {
                    focus += direction === "forward" ? 1 : -1;
                } else if (granularity === "line") {
                    this.moveControlSelection(control, direction, "line");
                    focus = control.selectionStart || focus;
                }

                focus = Math.max(0, Math.min(focus, text.length));

                try {
                    control.setSelectionRange(
                        Math.min(anchor, focus),
                        Math.max(anchor, focus),
                    );
                } catch (error) {}

                this.safeSyncLine("extend visual control", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
                return;
            }

            const sel = window.getSelection();

            if (!sel || sel.rangeCount === 0) {
                return;
            }

            try {
                sel.modify("extend", direction, granularity);
                this.safeSyncLine("extend visual dom", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
            } catch (error) {
                console.log("[Anki Vim] visual extend failed", error);
                this.lastAction = "visual extend failed: " + error;
            }
        },

        getSelectionText: function () {
            const field = this.currentField();
            const control = field ? this.editorControl(field) : null;

            if (control) {
                return control.value.slice(
                    control.selectionStart || 0,
                    control.selectionEnd || 0,
                );
            }

            const sel = window.getSelection();

            if (!sel || sel.rangeCount === 0) {
                return "";
            }

            return sel.toString();
        },

        yankSelection: function () {
            const text = this.getSelectionText();

            if (!text) {
                this.lastAction = "nothing selected to yank";
                return;
            }

            this.yankText = text;
            this.yankIsLine = false;
            this.lastAction = "yanked selection: " + JSON.stringify(text);
        },

        deleteSelection: function () {
            const field = this.currentField();
            const control = field ? this.editorControl(field) : null;

            if (control) {
                const start = control.selectionStart || 0;
                const end = control.selectionEnd || 0;
                const selected = control.value.slice(start, end);

                if (!selected) {
                    this.lastAction =
                        "delete selection failed: empty selection";
                    return;
                }

                this.yankText = selected;
                this.yankIsLine = false;

                const newText =
                    control.value.slice(0, start) + control.value.slice(end);

                this.replaceFieldPlainText(
                    field,
                    newText,
                    start,
                    "deleteContentForward",
                );

                this.pythonCaretOffset = start;
                this.lastAction =
                    "deleted selection: " + JSON.stringify(selected);
                return;
            }

            const text = this.getSelectionText();

            if (!text) {
                this.lastAction = "delete selection failed: empty selection";
                return;
            }

            this.yankText = text;
            this.yankIsLine = false;

            try {
                document.execCommand("delete", false, null);
                this.pythonCaretOffset = field
                    ? this.getCaretOffsetInField(field)
                    : this.pythonCaretOffset;
                this.safeSyncLine("delete visual dom", {
                    allowPointer: false,
                    allowDom: true,
                    allowFakeZero: false,
                });
                this.forceVirtualBlockCursor(1400, "visual delete");
                this.lastAction =
                    "deleted selection: " + JSON.stringify(this.yankText);
            } catch (error) {
                this.lastAction = "delete selection failed: " + error;
            }
        },

        pasteYankText: function (op) {
            this.sendPythonLineOp(op || "p");
        },

        openLineBelow: function () {
            const field = this.ensureField();

            if (!field) {
                this.lastAction = "open line failed: no field";
                return;
            }

            this.safeSyncLine("before open line below", {
                allowPointer: true,
                allowDom: true,
                allowFakeZero: false,
            });

            const targetLine = Math.max(
                0,
                (Number(this.vimLineIndex) || 0) + 1,
            );

            const control = this.editorControl(field);

            if (control) {
                const text = control.value || "";
                const caret = control.selectionStart || 0;
                const bounds = this.getLineBounds(text, caret, false);
                const insertAt = bounds.end;
                const newText =
                    text.slice(0, insertAt) + "\n" + text.slice(insertAt);

                control.value = newText;
                this.dispatchInputForField(field, "insertLineBreak", "\n");

                try {
                    control.focus({ preventScroll: true });
                } catch (error) {
                    control.focus();
                }

                try {
                    control.setSelectionRange(insertAt + 1, insertAt + 1);
                } catch (error) {}

                this.vimLineIndex = targetLine;
                this.lockLineSync(targetLine, 1800, "open line below control");

                this.lastAction = "opened line below";
                this.setMode("insert");
                return;
            }

            const sel = window.getSelection();

            try {
                sel.modify("move", "forward", "lineboundary");
                document.execCommand("insertLineBreak");

                this.vimLineIndex = targetLine;
                this.lockLineSync(targetLine, 1800, "open line below dom");

                this.setMode("insert");
                this.lastAction = "opened line below";
            } catch (error) {
                console.log("[Anki Vim] openLineBelow failed", error);
                this.lastAction = "open line failed: " + error;
            }

            this.updateDebugIfVisible();
        },

        nextField: function () {
            const fields = this.fields();
            let index = this.fieldIndex;

            const field = this.currentField();
            const currentIndex = fields.indexOf(field);

            if (currentIndex !== -1) {
                index = currentIndex;
            }

            const resolvedIndex = index + 1 >= fields.length ? 0 : index + 1;

            this.lastAction =
                "next field from index " +
                index +
                " to " +
                resolvedIndex +
                " total=" +
                fields.length;

            this.nativeFocusField(resolvedIndex, true);
        },

        previousField: function () {
            const fields = this.fields();
            let index = this.fieldIndex;

            const field = this.currentField();
            const currentIndex = fields.indexOf(field);

            if (currentIndex !== -1) {
                index = currentIndex;
            }

            const resolvedIndex = index - 1 < 0 ? fields.length - 1 : index - 1;

            this.lastAction =
                "previous field from index " +
                index +
                " to " +
                resolvedIndex +
                " total=" +
                fields.length;

            this.nativeFocusField(resolvedIndex, true);
        },

        refreshFieldOutline: function () {
            const fields = this.fields();

            for (const field of fields) {
                field.classList.remove("anki-vim-field-active");
            }

            const index = Math.min(this.fieldIndex, fields.length - 1);

            if (fields[index]) {
                fields[index].classList.add("anki-vim-field-active");
            }
        },

        getOrCreateBlockCursor: function () {
            let cursor = document.getElementById("anki-vim-block-cursor");

            if (!cursor) {
                cursor = document.createElement("div");
                cursor.id = "anki-vim-block-cursor";
                document.body.appendChild(cursor);
            }

            return cursor;
        },

        removeBlockCursor: function () {
            const cursor = document.getElementById("anki-vim-block-cursor");

            if (cursor) {
                cursor.style.display = "none";
            }
        },

        drawBlockCursorSoon: function () {
            setTimeout(() => {
                this.drawBlockCursor();
            }, 0);
        },

        getVirtualCaretRect: function (field) {
            if (!field) {
                return null;
            }

            const rect = field.getBoundingClientRect();
            const style = window.getComputedStyle(field);
            const paddingTop = parseFloat(style.paddingTop || "0") || 0;
            const paddingLeft = parseFloat(style.paddingLeft || "0") || 0;
            const lineHeight = this.lineHeightPx(field);
            const lineIndex = Math.max(0, Number(this.vimLineIndex) || 0);

            return {
                left: rect.left + paddingLeft + 3,
                top:
                    rect.top +
                    paddingTop +
                    lineHeight * lineIndex +
                    Math.max(0, (lineHeight - 18) / 2),
                width: 9,
                height: Math.max(18, Math.min(lineHeight, 24)),
            };
        },

        getCaretRect: function () {
            const field = this.currentField();

            if (!field) {
                return null;
            }

            const useVirtual =
                Date.now() < this.virtualBlockCursorUntil ||
                Date.now() < this.lineSyncLockUntil;

            if (useVirtual) {
                const virtualRect = this.getVirtualCaretRect(field);

                if (virtualRect) {
                    return virtualRect;
                }
            }

            const control = this.editorControl(field);

            if (control) {
                const pos = control.selectionStart || 0;

                try {
                    const mirror = document.createElement("div");
                    const style = window.getComputedStyle(control);

                    mirror.style.position = "fixed";
                    mirror.style.visibility = "hidden";
                    mirror.style.whiteSpace = "pre-wrap";
                    mirror.style.wordWrap = "break-word";
                    mirror.style.overflow = "hidden";
                    mirror.style.font = style.font;
                    mirror.style.fontSize = style.fontSize;
                    mirror.style.fontFamily = style.fontFamily;
                    mirror.style.fontWeight = style.fontWeight;
                    mirror.style.letterSpacing = style.letterSpacing;
                    mirror.style.lineHeight = style.lineHeight;
                    mirror.style.padding = style.padding;
                    mirror.style.border = style.border;
                    mirror.style.boxSizing = style.boxSizing;
                    mirror.style.width =
                        control.getBoundingClientRect().width + "px";

                    const before = document.createTextNode(
                        control.value.slice(0, pos),
                    );
                    const marker = document.createElement("span");
                    marker.textContent =
                        control.value.slice(pos, pos + 1) || " ";

                    mirror.appendChild(before);
                    mirror.appendChild(marker);
                    document.body.appendChild(mirror);

                    const controlRect = control.getBoundingClientRect();
                    const markerRect = marker.getBoundingClientRect();
                    const mirrorRect = mirror.getBoundingClientRect();

                    const rect = {
                        left:
                            controlRect.left +
                            (markerRect.left - mirrorRect.left) -
                            control.scrollLeft,
                        top:
                            controlRect.top +
                            (markerRect.top - mirrorRect.top) -
                            control.scrollTop,
                        width: Math.max(markerRect.width || 9, 9),
                        height: Math.max(markerRect.height || 18, 18),
                    };

                    mirror.remove();
                    return rect;
                } catch (error) {}
            }

            const sel = window.getSelection();

            if (sel && sel.rangeCount > 0) {
                try {
                    const range = sel.getRangeAt(0).cloneRange();

                    if (
                        field.contains(range.startContainer) ||
                        field === range.startContainer
                    ) {
                        range.collapse(true);

                        let rect = range.getBoundingClientRect();

                        if (
                            (!rect || rect.width === 0) &&
                            range.startContainer
                        ) {
                            const marker = document.createElement("span");
                            marker.textContent = "\u200b";
                            range.insertNode(marker);
                            rect = marker.getBoundingClientRect();
                            marker.remove();
                        }

                        if (rect && rect.top && rect.left) {
                            return {
                                left: rect.left,
                                top: rect.top,
                                width: Math.max(rect.width || 9, 9),
                                height: Math.max(rect.height || 18, 18),
                            };
                        }
                    }
                } catch (error) {}
            }

            const virtualRect = this.getVirtualCaretRect(field);

            if (virtualRect) {
                return virtualRect;
            }

            const r = field.getBoundingClientRect();

            return {
                left: r.left + 5,
                top: r.top + 5,
                width: 9,
                height: Math.min(Math.max(r.height - 10, 18), 22),
            };
        },

        drawBlockCursor: function () {
            if (this.mode !== "normal") {
                this.removeBlockCursor();
                return;
            }

            const rect = this.getCaretRect();

            if (!rect) {
                this.removeBlockCursor();
                return;
            }

            const cursor = this.getOrCreateBlockCursor();

            cursor.style.left = rect.left + "px";
            cursor.style.top = rect.top + "px";
            cursor.style.width = Math.max(rect.width || 9, 9) + "px";
            cursor.style.height = Math.max(rect.height || 18, 18) + "px";
            cursor.style.display = "block";
        },

        selectionInfo: function () {
            const field = this.currentField();
            const control = field ? this.editorControl(field) : null;

            if (control) {
                return (
                    "control=" +
                    this.describeEl(control) +
                    " selectionStart=" +
                    control.selectionStart +
                    " selectionEnd=" +
                    control.selectionEnd +
                    " valueLen=" +
                    control.value.length
                );
            }

            const sel = window.getSelection();

            if (!sel || sel.rangeCount === 0) {
                return "no selection";
            }

            const range = sel.getRangeAt(0);
            let node = range.startContainer;

            let nodeDesc = "";

            if (node.nodeType === Node.TEXT_NODE) {
                nodeDesc =
                    "TEXT len=" +
                    node.textContent.length +
                    " text=" +
                    JSON.stringify(node.textContent.slice(0, 40));
            } else {
                nodeDesc = this.describeEl(node);
            }

            return (
                "anchorOffset=" +
                sel.anchorOffset +
                " focusOffset=" +
                sel.focusOffset +
                " collapsed=" +
                sel.isCollapsed +
                " rangeStart=" +
                range.startOffset +
                " rangeEnd=" +
                range.endOffset +
                " node=" +
                nodeDesc
            );
        },

        toggleDebug: function () {
            this.debugVisible = !this.debugVisible;

            let el = document.getElementById("anki-vim-debug");

            if (!el) {
                el = document.createElement("div");
                el.id = "anki-vim-debug";
                document.body.appendChild(el);
            }

            if (!this.debugVisible) {
                el.style.display = "none";
                return;
            }

            el.style.display = "block";
            this.updateDebug();
        },

        updateDebugIfVisible: function () {
            if (this.debugVisible) {
                this.updateDebug();
            }
        },

        updateDebug: function () {
            let el = document.getElementById("anki-vim-debug");

            if (!el) {
                return;
            }

            const candidates = this.candidateFields();
            const fields = this.fields();
            const active = document.activeElement;
            const field = this.currentField();
            const control = field ? this.editorControl(field) : null;
            const fieldText = field ? this.getFieldPlainText(field) : "";
            const caretOffset = field ? this.getCaretOffsetInField(field) : -1;
            const domLine = field
                ? this.getCaretLineIndexFromDomSelection(field)
                : null;

            const lines = [];

            lines.push("Anki Vim Debug");
            lines.push("version: " + this.version);
            lines.push("mode: " + this.mode);
            lines.push("lastKey: " + this.lastKey);
            lines.push("lastAction: " + this.lastAction);
            lines.push("active: " + this.describeEl(active));
            lines.push("currentField: " + this.describeEl(field));
            lines.push("editorControl: " + this.describeEl(control));
            lines.push("selection: " + this.selectionInfo());
            lines.push("candidate fields: " + candidates.length);
            lines.push("usable fields: " + fields.length);
            lines.push("fieldIndex: " + this.fieldIndex);
            lines.push("vimLineIndex: " + this.vimLineIndex);
            lines.push("domLineIndex: " + domLine);
            lines.push("lastPointerLineIndex: " + this.lastPointerLineIndex);
            lines.push(
                "lastInternalLineMoveTime: " + this.lastInternalLineMoveTime,
            );
            lines.push("lineSyncLockUntil: " + this.lineSyncLockUntil);
            lines.push("lockedVimLineIndex: " + this.lockedVimLineIndex);
            lines.push(
                "virtualBlockCursorUntil: " + this.virtualBlockCursorUntil,
            );
            lines.push(
                "virtualBlockCursorReason: " + this.virtualBlockCursorReason,
            );
            lines.push(
                "jsLineCountDebugOnly: " +
                    this.getCurrentFieldLineCountDebugOnly(),
            );
            lines.push("pendingOperator: " + this.pendingOperator);
            lines.push("yankText: " + JSON.stringify(this.yankText));
            lines.push("yankIsLine: " + this.yankIsLine);
            lines.push("caretOffset: " + caretOffset);
            lines.push("pythonCaretOffset: " + this.pythonCaretOffset);
            lines.push("fieldText: " + JSON.stringify(fieldText.slice(0, 300)));
            lines.push("");

            candidates.forEach((candidate, i) => {
                const r = candidate.getBoundingClientRect();
                const controlForCandidate = this.editorControl(candidate);
                const controlText = controlForCandidate
                    ? controlForCandidate.value || ""
                    : "";

                lines.push(
                    i +
                        ": " +
                        this.describeEl(candidate) +
                        " top=" +
                        Math.round(r.top) +
                        " left=" +
                        Math.round(r.left) +
                        " w=" +
                        Math.round(r.width) +
                        " h=" +
                        Math.round(r.height) +
                        " control=" +
                        this.describeEl(controlForCandidate) +
                        " controlText=" +
                        JSON.stringify(controlText.slice(0, 80)),
                );
            });

            el.textContent = lines.join("\n");
        },

        describeEl: function (el) {
            if (!el) {
                return "null";
            }

            const tag = el.tagName ? el.tagName.toLowerCase() : "?";
            const id = el.id ? "#" + el.id : "";
            const cls =
                typeof el.className === "string" && el.className
                    ? "." + el.className.split(/\s+/).slice(0, 6).join(".")
                    : "";
            const role = el.getAttribute ? el.getAttribute("role") || "" : "";
            const aria = el.getAttribute
                ? el.getAttribute("aria-label") || ""
                : "";
            const ce = el.getAttribute
                ? el.getAttribute("contenteditable") || ""
                : "";

            return (
                tag + id + cls + " role=" + role + " aria=" + aria + " ce=" + ce
            );
        },
    };

    window.ankiVim.init();
})();
