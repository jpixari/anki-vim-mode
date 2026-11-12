// Runs inside Anki's real editor page. Stores a JSON string in
// window.__vimE2EResult when finished (the driver polls for it).
(async function () {
    const out = {};
    const pause = (ms) => new Promise((r) => setTimeout(r, ms || 60));

    try {
        if (!window.ankiVim) {
            window.__vimE2EResult = JSON.stringify({ error: "ankiVim not loaded" });
            return;
        }

        const V = window.ankiVim._state;
        const hosts = Array.from(document.querySelectorAll(".rich-text-editable"));
        const fields = hosts.map((h) =>
            h.shadowRoot ? h.shadowRoot.querySelector("anki-editable") : null,
        );
        const f = fields[0];

        out.version = window.ankiVim.version;
        out.hosts = hosts.length;
        out.fieldTag = f ? f.tagName : null;
        out.whiteSpace = f ? getComputedStyle(f).whiteSpace : null;

        function deepActive() {
            let a = document.activeElement;
            while (a && a.shadowRoot && a.shadowRoot.activeElement) {
                a = a.shadowRoot.activeElement;
            }
            return a;
        }

        const NAMED = { "<Esc>": "Escape", "<CR>": "Enter", "<BS>": "Backspace" };

        async function feed(str) {
            await pause(15);
            for (const tok of str.match(/<C-.>|<[A-Za-z]+>|[\s\S]/g) || []) {
                const ctrl = /^<C-.>$/.test(tok);
                const key = ctrl ? tok[3] : NAMED[tok] || tok;
                const ev = new KeyboardEvent("keydown", {
                    key, ctrlKey: ctrl, bubbles: true, cancelable: true, composed: true,
                });
                (deepActive() || document.body).dispatchEvent(ev);
                if (!ev.defaultPrevented && !ctrl) {
                    if (key.length === 1) document.execCommand("insertText", false, key);
                    else if (key === "Enter") document.execCommand("insertLineBreak");
                    else if (key === "Backspace") document.execCommand("delete");
                }
            }
        }

        window.__vimE2E = { feed };

        f.focus();
        window.ankiVim.setMode("normal");
        out.activeIsField = deepActive() === f;

        await feed("ione<CR>two<CR>three<Esc>");
        out.typed = f.innerHTML;
        await feed("kdd");
        out.afterDd = f.innerHTML;
        await feed("u");
        out.afterU = f.innerHTML;
        await feed("dd");
        out.afterDd2 = f.innerHTML;
        document.execCommand("undo");
        out.afterNativeUndo = f.innerHTML;
        await feed("qwe");
        out.afterUnmappedKeys = f.innerHTML;
        await feed("ggyyP");
        out.afterYyP = f.innerHTML;
        await feed("cwX<Esc>");
        out.afterCw = f.innerHTML;
        await feed("jdd.");
        out.afterDot = f.innerHTML;
        await feed("J");
        out.movedToField2 = V.field === fields[1];
        await feed("iback <Esc>");
        out.field2 = fields[1] ? fields[1].innerHTML : null;
        await feed("K");
        out.backToField1 = V.field === f;
        await pause(300);
        out.mode = V.mode;
        out.statusText = (document.getElementById("anki-vim-status") || {}).textContent;
        const cur = document.getElementById("anki-vim-block-cursor");
        out.cursor = cur ? { display: cur.style.display, w: cur.style.width, h: cur.style.height, glyph: cur.textContent } : null;
        out.final = f.innerHTML;
    } catch (error) {
        out.error = String(error && error.stack ? error.stack : error);
    }

    window.__vimE2EResult = JSON.stringify(out);
})();
