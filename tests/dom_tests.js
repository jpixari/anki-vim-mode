// Editor tests. Executed inside the page by tests/run_dom_tests.py; the last
// expression is returned to Python as a JSON string.

(function () {
    const V = window.ankiVim._state;
    const I = window.ankiVim._internals;
    const results = [];
    let errors = [];

    function fields() {
        return Array.from(
            document.querySelectorAll(".rich-text-editable"),
        ).map((h) => h.shadowRoot.querySelector("anki-editable"));
    }

    function field(i) {
        return fields()[i || 0];
    }

    function reset() {
        V.mode = "normal";
        V.keys = [];
        V.regs = {};
        V.undo.length = 0;
        V.redo.length = 0;
        V.change = null;
        V.insert = null;
        V.cmdline = null;
        V.lastFind = null;
        V.lastSearch = null;
        V.lastChange = null;
        V.lastVisual = null;
        V.clipboardText = "";
        V.lastClipWrite = null;
        V.stamp = null;
        window.__cmds.length = 0;
        I.config.shift_jk_fields = true;
        I.config.insert_escape = "";
        I.config.system_clipboard = false;
        I.config.jk_display_lines = false;
    }

    function setup(html, pos, index) {
        reset();

        for (const f of fields()) {
            f.innerHTML = "";
        }

        const f = field(index);

        f.innerHTML = html;
        I.focusField(f, pos || 0);
    }

    const NAMED = {
        "<Esc>": { key: "Escape" },
        "<CR>": { key: "Enter" },
        "<BS>": { key: "Backspace" },
        "<Del>": { key: "Delete" },
        "<Left>": { key: "ArrowLeft" },
        "<Right>": { key: "ArrowRight" },
        "<Up>": { key: "ArrowUp" },
        "<Down>": { key: "ArrowDown" },
        "<Tab>": { key: "Tab" },
        "<lt>": { key: "<" },
        "<Space>": { key: " " },
    };

    // feed("ciwhello<Esc>"): dispatches real keydown events. Keys the add-on
    // does not swallow are applied the way the browser would in insert mode.
    function feed(str) {
        const tokens = str.match(/<C-.>|<[A-Za-z]+>|[\s\S]/g) || [];

        for (const tok of tokens) {
            let init;

            if (/^<C-.>$/.test(tok)) {
                init = { key: tok[3], ctrlKey: true };
            } else if (NAMED[tok]) {
                init = NAMED[tok];
            } else {
                init = { key: tok };
            }

            const ev = new KeyboardEvent(
                "keydown",
                Object.assign(
                    { bubbles: true, cancelable: true, composed: true },
                    init,
                ),
            );
            const target = document.activeElement || document.body;

            target.dispatchEvent(ev);

            if (!ev.defaultPrevented && !init.ctrlKey) {
                if (init.key.length === 1) {
                    document.execCommand("insertText", false, init.key);
                } else if (init.key === "Enter") {
                    document.execCommand("insertLineBreak");
                } else if (init.key === "Backspace") {
                    document.execCommand("delete");
                }
            }
        }
    }

    function html(i) {
        return field(i).innerHTML;
    }

    // Browsers store some spaces as non-breaking spaces while editing.
    function text() {
        return I.remodel().text.replace(/\u00a0/g, " ");
    }

    function eq(actual, expected, label) {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);

        if (a !== e) {
            errors.push((label || "value") + ": expected " + e + " got " + a);
        }
    }

    // Common assertion: field text, cursor position (optional), mode.
    function expect(expectedText, expectedPos, expectedMode) {
        eq(text(), expectedText, "text");

        if (expectedPos !== undefined && expectedPos !== null) {
            eq(V.pos, expectedPos, "pos");
        }

        eq(V.mode, expectedMode || "normal", "mode");
    }

    function test(name, fn) {
        if (window.__only && !name.includes(window.__only)) {
            return;
        }

        errors = [];

        try {
            fn();
        } catch (error) {
            errors.push("threw: " + (error && error.stack ? error.stack : error));
        }

        results.push({ name, ok: errors.length === 0, errors });
    }

    // ---- model -----------------------------------------------------------

    function modelText(h) {
        setup(h);
        return text();
    }

    test("model: br lines", () => {
        eq(modelText("a<br>b<br>c"), "a\nb\nc");
        eq(modelText("a<br>"), "a", "trailing br is filler");
        eq(modelText("a<br><br>"), "a\n", "double br = empty last line");
        eq(modelText("<br>"), "", "lone br");
        eq(modelText(""), "", "empty");
        eq(modelText("a<br><br>b"), "a\n\nb", "empty middle line");
    });

    test("model: block lines", () => {
        eq(modelText("a<div>b</div><div>c</div>"), "a\nb\nc");
        eq(modelText("<div>a</div><div><br></div><div>b</div>"), "a\n\nb");
        eq(modelText("<div>a</div>\n<div>b</div>"), "a\nb", "source newline");
        eq(modelText("<ul><li>x</li><li>y</li></ul>z"), "x\ny\nz");
        eq(modelText("a<br><div>b</div>"), "a\nb");
        eq(modelText("<div>a<br></div><div>b</div>"), "a\nb");
    });

    test("model: inline formatting and atoms", () => {
        eq(modelText("a<b>b</b>c"), "abc");
        eq(modelText('x<img src="data:,">y'), "x\uFFFCy");
        eq(modelText('a<span contenteditable="false">zzz</span>b'), "a\uFFFCb");
    });

    test("model: caret offsets round-trip", () => {
        const cases = [
            "abc",
            "a<br>b<br>c",
            "a<br><br>b",
            "a<br><br>",
            "<div>a</div><div><br></div><div>bc</div>",
            "a<b>bc</b>d<br><i>e</i>",
            'x<img src="data:,">y<br>z',
            "a<div>b</div><div>c</div>",
            "<ul><li>x</li><li>y</li></ul>",
        ];

        for (const h of cases) {
            setup(h);

            const m = I.remodel();
            const sel = field().getRootNode().getSelection();

            for (let i = 0; i <= m.text.length; i++) {
                const p = I.domPos(m, i);

                sel.setBaseAndExtent(p.n, p.o, p.n, p.o);
                eq(I.remodel().caret, i, h + " offset " + i);
            }
        }
    });

    // ---- the reviews -----------------------------------------------------

    test("review: unmapped keys are never typed in normal mode", () => {
        setup("hello world");
        feed("qQzZmM&@!'`=RTH LU");
        feed("<Esc>");
        expect("hello world", null);
        eq(html(), "hello world", "html untouched");
    });

    test("review: w and e move instead of inserting", () => {
        setup("one two three");
        feed("w");
        expect("one two three", 4);
        feed("e");
        expect("one two three", 6);
        feed("b");
        expect("one two three", 4);
    });

    test("review: dd deletes the cursor line", () => {
        setup("one<br>two<br>three", 5);
        feed("dd");
        expect("one\nthree", 4);
        eq(html(), "one<br>three");
    });

    test("review: u restores what dd deleted", () => {
        setup("one<br>two<br>three", 5);
        feed("dd");
        feed("u");
        expect("one\ntwo\nthree", 5);
        eq(html(), "one<br>two<br>three");
    });

    test("review: native undo (Ctrl+Z) restores what dd deleted", () => {
        setup("one<br>two<br>three", 5);
        feed("dd");
        eq(text(), "one\nthree");
        document.execCommand("undo");
        eq(html(), "one<br>two<br>three");
    });

    test("dd keeps images and formatting in the rest of the field", () => {
        setup('<div><b>bold</b></div><div>x</div><div><img src="data:,"></div>', 5);
        feed("dd");
        eq(html(), '<div><b>bold</b></div><div><img src="data:,"></div>');
    });

    // ---- motions ---------------------------------------------------------

    test("hjkl", () => {
        setup("abc<br>de<br>fghi", 1);
        feed("l");
        expect("abc\nde\nfghi", 2);
        feed("l");
        expect("abc\nde\nfghi", 2);
        feed("j");
        expect("abc\nde\nfghi", 5);
        feed("j");
        expect("abc\nde\nfghi", 9);
        feed("k");
        feed("k");
        expect("abc\nde\nfghi", 2);
        feed("hhh");
        expect("abc\nde\nfghi", 0);
    });

    test("counts on motions", () => {
        setup("a b c d e f");
        feed("3w");
        expect("a b c d e f", 6);
        feed("2h");
        expect("a b c d e f", 4);
    });

    test("0 ^ $ and $ column memory", () => {
        setup("  abc<br>x<br>hello", 3);
        feed("0");
        eq(V.pos, 0);
        feed("^");
        eq(V.pos, 2);
        feed("$");
        eq(V.pos, 4);
        feed("jj");
        eq(V.pos, 12, "$ sticks to end of line");
    });

    test("gg G", () => {
        setup("a<br>b<br>c<br>d", 2);
        feed("G");
        eq(V.pos, 6);
        feed("gg");
        eq(V.pos, 0);
        feed("3G");
        eq(V.pos, 4);
    });

    test("f t ; ,", () => {
        setup("a,b,c,d");
        feed("f,");
        eq(V.pos, 1);
        feed(";");
        eq(V.pos, 3);
        feed(",");
        eq(V.pos, 1);
        feed("tc");
        eq(V.pos, 3);
    });

    test("% { }", () => {
        setup("f(a[b])<br><br>x");
        feed("%");
        eq(V.pos, 6);
        feed("%");
        eq(V.pos, 1);
        feed("}");
        eq(V.pos, 8);
        feed("{");
        eq(V.pos, 0);
    });

    test("motion through bold/italic markup", () => {
        setup("a<b>bc</b> <i>de</i>f");
        feed("w");
        eq(V.pos, 4);
        feed("e");
        eq(V.pos, 6);
    });

    // ---- operators -------------------------------------------------------

    test("x X", () => {
        setup("abcdef", 2);
        feed("x");
        expect("abdef", 2);
        feed("X");
        expect("adef", 1);
        feed("3x");
        expect("a", 0);
    });

    test("dw de db d$ D d0", () => {
        setup("one two three", 4);
        feed("dw");
        expect("one three", 4);
        feed("db");
        expect("three", 0);
        setup("one two three", 4);
        feed("de");
        expect("one  three", 4);
        setup("one two three", 4);
        feed("D");
        expect("one ", 3);
        setup("one two three", 4);
        feed("d0");
        expect("two three", 0);
    });

    test("dw on last word stops at end of line", () => {
        setup("one two<br>three", 4);
        feed("dw");
        expect("one \nthree", 3);
    });

    test("d with counts", () => {
        setup("a b c d e");
        feed("d2w");
        expect("c d e", 0);
        feed("2dw");
        expect("e", 0);
    });

    test("dd variants", () => {
        setup("a<br>b<br>c<br>d", 0);
        feed("2dd");
        expect("c\nd", 0);
        feed("jdd");
        expect("c", 0);
        feed("dd");
        expect("", 0);
    });

    test("dj dk dG dgg", () => {
        setup("a<br>b<br>c<br>d", 2);
        feed("dj");
        expect("a\nd", 2);
        setup("a<br>b<br>c<br>d", 4);
        feed("dk");
        expect("a\nd", 2);
        setup("a<br>b<br>c<br>d", 2);
        feed("dG");
        expect("a", 0);
        setup("a<br>b<br>c<br>d", 2);
        feed("dgg");
        expect("c\nd", 0);
    });

    test("dd in div-structured field", () => {
        setup("<div>one</div><div>two</div><div>three</div>", 5);
        feed("dd");
        expect("one\nthree", 4);
        feed("u");
        expect("one\ntwo\nthree");
    });

    test("df dt", () => {
        setup("a,b,c");
        feed("df,");
        expect("b,c", 0);
        feed("dt,");
        expect(",c", 0);
    });

    test("cw ciw cc C s S", () => {
        setup("one two three", 4);
        feed("cwXY<Esc>");
        expect("one XY three", 5);
        setup("one two three", 5);
        feed("ciwZ<Esc>");
        expect("one Z three", 4);
        setup("a<br>bcd<br>e", 3);
        feed("ccnew<Esc>");
        expect("a\nnew\ne", 4);
        setup("one two", 4);
        feed("Cx<Esc>");
        expect("one x", 4);
        setup("abc", 1);
        feed("sZZ<Esc>");
        expect("aZZc", 2);
        setup("a<br>bcd", 3);
        feed("Sq<Esc>");
        expect("a\nq", 2);
    });

    test("text objects", () => {
        setup('say "hi there" ok', 7);
        feed('di"');
        expect('say "" ok', 5);
        setup('say "hi there" ok', 7);
        feed('da"');
        expect("say ok", 4);
        setup("f(a, b)", 3);
        feed("di(");
        expect("f()", 2);
        setup("f(a, b) x", 3);
        feed("dab");
        expect("f x", 1);
        setup("one two three", 5);
        feed("daw");
        expect("one three", 4);
        setup("x [1, 2] y", 4);
        feed("ci[z<Esc>");
        expect("x [z] y", 3);
    });

    test("cloze text object", () => {
        setup("The {{c1::capital::hint}} of France", 12);
        feed("cicParis<Esc>");
        expect("The {{c1::Paris::hint}} of France");
        feed("dac");
        expect("The  of France");
    });

    test("y p P charwise", () => {
        setup("one two", 0);
        feed("yw");
        feed("$p");
        expect("one twoone ", 10);
        setup("abc", 1);
        feed("ylP");
        expect("abbc", 1);
    });

    test("yy p P linewise", () => {
        setup("one<br>two", 0);
        feed("yyp");
        expect("one\none\ntwo", 4);
        feed("jP");
        expect("one\none\none\ntwo", 8);
        setup("only", 0);
        feed("yyp");
        expect("only\nonly", 5);
        feed("3p");
        expect("only\nonly\nonly\nonly\nonly", 10);
    });

    test("dd then p moves a line (and keeps its formatting)", () => {
        setup("<b>one</b><br>two<br>three", 0);
        feed("ddp");
        expect("two\none\nthree", 4);
        eq(html(), "two<br><b>one</b><br>three");
    });

    test("dd p keeps an image", () => {
        setup('a<br><img src="data:,"><br>b', 2);
        feed("ddp");
        eq(text(), "a\nb\n\uFFFC");
        eq(field().querySelectorAll("img").length, 1, "image survives");
    });

    test("registers", () => {
        setup("one two three", 0);
        feed('"ayw');
        feed("w");
        feed('"byw');
        feed('$"ap');
        expect("one two threeone ");
        feed('"bp');
        expect("one two threeone two ");
        setup("ab", 0);
        feed('"_x');
        feed("yl");
        feed("p");
        expect("bb");
    });

    test("r ~ J gJ", () => {
        setup("abc", 1);
        feed("rZ");
        expect("aZc", 1);
        feed("0~~");
        expect("Azc", 2);
        setup("one<br>  two<br>three", 0);
        feed("gJ");
        expect("one two\nthree", 3);
        setup("a<br>b<br>c", 0);
        I.config.shift_jk_fields = false;
        feed("3J");
        expect("a b c", 3);
    });

    test("gu gU g~", () => {
        setup("Hello World", 0);
        feed("gUiw");
        expect("HELLO World", 0);
        feed("guu");
        expect("hello world", 0);
        feed("g~w");
        expect("HELLO world", 0);
    });

    test("case change keeps formatting", () => {
        setup("<b>ab</b>cd", 0);
        feed("gUU");
        eq(html(), "<b>AB</b>CD");
    });

    // ---- insert ----------------------------------------------------------

    test("i a I A", () => {
        setup("bc", 0);
        feed("ia<Esc>");
        expect("abc", 0);
        feed("ax<Esc>");
        expect("axbc", 1);
        feed("Iy<Esc>");
        expect("yaxbc", 0);
        feed("Az<Esc>");
        expect("yaxbcz", 5);
    });

    test("o O", () => {
        setup("one<br>two", 0);
        feed("onew<Esc>");
        expect("one\nnew\ntwo", 6);
        feed("Otop<Esc>");
        expect("one\ntop\nnew\ntwo", 6);
        setup("solo", 0);
        feed("ox<Esc>");
        expect("solo\nx", 5);
        setup("solo", 0);
        feed("Ox<Esc>");
        expect("x\nsolo", 0);
    });

    test("insert mode types every key literally", () => {
        setup("", 0);
        feed("ijkhl:wq dd JK<Esc>");
        expect("jkhl:wq dd JK");
    });

    test("insert_escape mapping (jk)", () => {
        setup("", 0);
        I.config.insert_escape = "jk";
        feed("iabjk");
        expect("ab", 1, "normal");
        feed("ajx<Esc>");
        expect("abjx");
    });

    test("typing into an empty field then Esc", () => {
        setup("", 0);
        feed("ihello<CR>world<Esc>");
        expect("hello\nworld", 10);
    });

    // ---- undo / redo / repeat --------------------------------------------

    test("u and Ctrl-r walk whole vim changes", () => {
        setup("one two three", 0);
        feed("dw");
        feed("dw");
        expect("three");
        feed("u");
        expect("two three", 0);
        feed("u");
        expect("one two three", 0);
        feed("<C-r>");
        expect("two three");
        feed("<C-r>");
        expect("three");
        feed("uu");
        expect("one two three");
    });

    test("u undoes a whole insert session", () => {
        setup("x", 0);
        feed("Ahello world<Esc>");
        expect("xhello world");
        feed("u");
        expect("x", 0);
    });

    test("u undoes cw (delete + typing) as one change", () => {
        setup("one two", 0);
        feed("cwthree<Esc>");
        expect("three two");
        feed("u");
        expect("one two", 0);
    });

    test("u undoes a linewise paste", () => {
        setup("a<br>b", 0);
        feed("yyjp");
        expect("a\nb\na");
        feed("u");
        expect("a\nb");
        eq(html(), "a<br>b");
    });

    test("dot repeat", () => {
        setup("a b c d", 0);
        feed("dw..");
        expect("d", 0);
        setup("one two three", 0);
        feed("cwX<Esc>w.w.");
        expect("X X X");
        setup("a<br>b<br>c", 0);
        feed("Ax<Esc>j.j.");
        expect("ax\nbx\ncx");
        setup("abcd", 0);
        feed("x.");
        expect("cd");
    });

    // ---- visual ----------------------------------------------------------

    test("visual d y c", () => {
        setup("one two three", 4);
        feed("ved");
        expect("one  three", 4);
        setup("one two three", 4);
        feed("vey$p");
        expect("one two threetwo");
        setup("one two three", 4);
        feed("vecX<Esc>");
        expect("one X three", 4);
    });

    test("visual backwards and o", () => {
        setup("abcdef", 4);
        feed("vhhd");
        expect("abf", 2);
        setup("abcdef", 2);
        feed("vlohd");
        expect("aef", 1);
    });

    test("visual line", () => {
        setup("a<br>b<br>c<br>d", 2);
        feed("Vjd");
        expect("a\nd", 2);
        feed("P");
        expect("a\nb\nc\nd", 2);
        feed("Vy");
        feed("Gp");
        expect("a\nb\nc\nd\nb");
    });

    test("visual text objects and case", () => {
        setup("say (hello there) ok", 6);
        feed("vi(U");
        expect("say (HELLO THERE) ok", 5);
        setup("one two", 5);
        feed("viwd");
        expect("one ", 3);
    });

    test("visual paste replaces selection", () => {
        setup("one two", 0);
        feed("yiwwviwp");
        expect("one one");
    });

    test("Esc leaves visual mode without changes", () => {
        setup("abc", 0);
        feed("vll<Esc>");
        expect("abc", 2, "normal");
        feed("x");
        expect("ab");
    });

    // ---- search and command line -----------------------------------------

    test("/ n N", () => {
        setup("foo bar foo baz foo", 0);
        feed("/foo<CR>");
        eq(V.pos, 8);
        feed("n");
        eq(V.pos, 16);
        feed("n");
        eq(V.pos, 0, "wraps");
        feed("N");
        eq(V.pos, 16);
        expect("foo bar foo baz foo");
    });

    test("* and dn", () => {
        setup("ab x ab y ab", 0);
        feed("*");
        eq(V.pos, 5);
        feed("dn");
        expect("ab x ab", 5);
    });

    test(":s and :%s", () => {
        setup("a a<br>a a", 0);
        feed(":s/a/b/<CR>");
        expect("b a\na a");
        feed(":%s/a/c/g<CR>");
        expect("b c\nc c");
        feed("u");
        expect("b a\na a");
        feed(":%s/\\(a\\) /[\\1]/g<CR>");
    });

    test(":s with capture groups", () => {
        setup("john smith", 0);
        feed(":s/(\\w+) (\\w+)/\\2 \\1/<CR>");
        expect("smith john");
    });

    test(": typed in the command line never reaches the field", () => {
        setup("abc", 0);
        feed(":nonsense<CR>");
        expect("abc", 0);
        feed(":zzz<Esc>");
        expect("abc", 0);
    });

    test(":w :wq :q go to python", () => {
        setup("abc", 0);
        feed(":w<CR>");
        feed(":wq<CR>");
        feed(":q<CR>");
        feed("ZZ");
        eq(
            window.__cmds.map((c) => JSON.parse(c.slice(9)).cmd),
            ["w", "wq", "q", "wq"],
        );
    });

    test(":3 goes to line", () => {
        setup("a<br>b<br>c", 0);
        feed(":3<CR>");
        eq(V.pos, 4);
        feed(":1,2d<CR>");
        expect("c", 0);
    });

    // ---- fields and focus ------------------------------------------------

    test("J K move between fields", () => {
        setup("first", 2);
        field(1).innerHTML = "second";
        feed("J");
        eq(V.field === field(1), true, "moved to field 2");
        feed("x");
        eq(html(1), "econd");
        feed("K");
        eq(V.field === field(0), true, "back to field 1");
        eq(V.pos, 2, "cursor position remembered");
        feed("K");
        eq(V.field === field(2), true, "wraps to last field");
    });

    test("keys are left alone outside note fields", () => {
        setup("abc", 0);

        const other = document.getElementById("other");

        other.focus();

        const ev = new KeyboardEvent("keydown", {
            key: "x",
            bubbles: true,
            cancelable: true,
            composed: true,
        });

        other.dispatchEvent(ev);
        eq(ev.defaultPrevented, false, "x not swallowed in other inputs");

        const colon = new KeyboardEvent("keydown", {
            key: ":",
            bubbles: true,
            cancelable: true,
            composed: true,
        });

        other.dispatchEvent(colon);
        eq(colon.defaultPrevented, false, ": not swallowed in other inputs");
        eq(V.cmdline, null, "no command line opened");
        eq(html(), "abc");
    });

    test("Ctrl shortcuts pass through to Anki in normal mode", () => {
        setup("abc", 0);

        for (const key of ["b", "Enter", "z", "v", "c"]) {
            const ev = new KeyboardEvent("keydown", {
                key,
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
                composed: true,
            });

            document.activeElement.dispatchEvent(ev);
            eq(ev.defaultPrevented, false, "Ctrl+" + key);
        }
    });

    test("system clipboard register", () => {
        setup("one two", 0);
        feed('"+yiw');
        eq(JSON.parse(window.__cmds[0].slice(9)), { cmd: "clip", text: "one" });
        window.ankiVim.setClipboard("EXT");
        feed('$"+p');
        expect("one twoEXT");
    });

    test("escape() from python", () => {
        setup("abc", 0);
        feed("ix");
        window.ankiVim.escape();
        expect("xabc", 0, "normal");
        feed("d");
        window.ankiVim.escape();
        feed("l");
        expect("xabc", 1);
    });

    // ---- edge cases ------------------------------------------------------

    test("empty field: commands do nothing harmful", () => {
        setup("", 0);
        feed("xXDJ.u$0wbe~\"_dd");
        expect("", 0);
        feed("p");
        expect("", 0);
        feed("ddp");
        expect("\n", 1);
        feed("u");
        expect("", 0);
        setup("", 0);
        feed("ohi<Esc>");
        expect("\nhi", 2);
        setup("", 0);
        feed("Ahi<Esc>ccyo<Esc>");
        expect("yo", 1);
    });

    test("x at end of line never joins lines", () => {
        setup("ab<br>cd", 1);
        feed("xxxx");
        expect("\ncd", 0);
    });

    test("list items", () => {
        setup("<ul><li>one</li><li>two</li><li>three</li></ul>", 4);
        feed("dd");
        expect("one\nthree", 4);
        eq(field().querySelectorAll("li").length, 2, "two list items left");
        feed("u");
        eq(field().querySelectorAll("li").length, 3, "undo restores the item");
        feed("ggyyp");
        eq(text(), "one\none\ntwo\nthree");
    });

    test("div fields: o O dd on last line, p", () => {
        setup("<div>one</div><div>two</div>", 0);
        feed("Otop<Esc>");
        expect("top\none\ntwo", 2);
        feed("Gdd");
        expect("top\none", 4);
        feed("ggddp");
        expect("one\ntop", 4);
        feed("oend<Esc>");
        expect("one\ntop\nend", 10);
    });

    test("images are single characters", () => {
        setup('ab<img src="data:,">cd', 0);
        feed("ll");
        eq(V.pos, 2, "cursor sits on the image");
        feed("x");
        eq(field().querySelectorAll("img").length, 0, "x deletes the image");
        expect("abcd", 2);
        feed("u");
        eq(field().querySelectorAll("img").length, 1, "u brings it back");
        feed("0gUU");
        eq(field().querySelectorAll("img").length, 1, "case change keeps it");
        expect("AB￼CD");
        feed("0yl$p");
        expect("AB￼CDA");
    });

    test("yank and paste an image charwise", () => {
        setup('a<img src="data:,">b', 1);
        feed("yl$p");
        eq(field().querySelectorAll("img").length, 2, "image pasted");
    });

    test("typing after A continues bold at end of line", () => {
        setup("x<b>bold</b>", 0);
        feed("A!<Esc>");
        eq(html(), "x<b>bold!</b>");
    });

    test("cursor follows an external caret move (mouse click)", () => {
        setup("one two three", 0);

        const node = field().firstChild;
        const sel = field().getRootNode().getSelection();

        sel.setBaseAndExtent(node, 8, node, 8);
        feed("dw");
        expect("one two ", 7);
    });

    test("u after a foreign edit does not loop or corrupt", () => {
        setup("abc", 0);
        feed("x");
        document.execCommand("insertText", false, "Z");
        feed("u");
        eq(text().length > 0, true, "still has text");
        feed("uuu");
        feed("<C-r><C-r>");
        eq(V.mode, "normal");
    });

    test("visual J and counts", () => {
        setup("a<br>b<br>c<br>d", 0);
        feed("VjjJ");
        expect("a b c\nd", 3);
        setup("abcdef", 0);
        feed("v3ld");
        expect("ef", 0);
    });

    test("d on wrapped display lines still uses real lines", () => {
        const long = "word ".repeat(40).trim();

        setup(long + "<br>next", 30);
        feed("dd");
        expect("next", 0);
    });

    test("gj gk move by display line", () => {
        const long = "word ".repeat(40).trim();

        setup(long, 0);
        feed("gj");
        eq(V.pos > 5 && V.pos < long.length, true, "moved down inside the line: " + V.pos);
        feed("gk");
        eq(V.pos < 5, true, "and back up: " + V.pos);
    });

    test("operators cancelled by Esc do nothing", () => {
        setup("abc def", 0);
        feed("d<Esc>w");
        expect("abc def", 4);
        feed('"a<Esc>2<Esc>x');
        expect("abc ef", 4);
    });

    test("invalid sequences are dropped, next key works", () => {
        setup("abc def", 0);
        feed("dqw");
        expect("abc def", 4);
        feed("gqx");
        expect("abc ef", 4);
    });

    test("cc keeps the line, cw on single char, c$ on empty", () => {
        setup("a<br><br>c", 2);
        feed("ccx<Esc>");
        expect("a\nx\nc", 2);
        setup("a b", 0);
        feed("cwxyz<Esc>");
        expect("xyz b", 2);
        setup("a<br><br>c", 2);
        feed("Cq<Esc>");
        expect("a\nq\nc", 2);
    });

    test("entities and angle brackets survive yank/paste", () => {
        setup("a &lt;b&gt; &amp; c", 0);
        feed("yyp");
        expect("a <b> & c\na <b> & c");
        feed("0f<lt>yt&$p");
        expect("a <b> & c\na <b> & c<b> ");
    });

    test("undo falls back to a snapshot when native history cannot", () => {
        setup("one<br>two<br>three", 4);
        feed("dd");
        // Simulate history the browser cannot replay (as with MathJax):
        // a script-made DOM change in between.
        field().appendChild(document.createTextNode(""));
        V.undo[V.undo.length - 1].after = field().innerHTML;
        // Break native undo by clearing it with a non-undoable rewrite.
        const html = field().innerHTML;
        field().innerHTML = html;
        feed("u");
        expect("one\ntwo\nthree");
        feed("<C-r>");
        expect("one\nthree");
        feed("u");
        expect("one\ntwo\nthree");
    });

    test("mathjax elements are yanked in their plain form", () => {
        setup(
            'a <anki-frame block="false"><frame-start> </frame-start>' +
                '<anki-mathjax data-mathjax="x^2" contenteditable="false" decorated="true">' +
                '<img src="data:,"></anki-mathjax><frame-end> </frame-end></anki-frame> b',
            0,
        );
        eq(text(), "a ￼ b");
        feed("yy");
        eq(V.regs['"'].htmlLines, ["a <anki-mathjax>x^2</anki-mathjax> b"]);
        feed("p");
        eq(text(), "a ￼ b\na ￼ b");
        feed("u");
        eq(text(), "a ￼ b");
    });

    return JSON.stringify(results);
})();
