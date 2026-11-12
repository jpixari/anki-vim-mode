# Loaded as an add-on inside the throwaway Anki started by run_anki_e2e.py.
# Opens the Add Cards window (classic editor, then the new one), drives the
# vim add-on through it and writes what happened to a JSON file.

import json
import os
import traceback

import aqt
from aqt import gui_hooks, mw
from aqt.qt import QApplication, QEvent, QKeyEvent, Qt, QTimer

OUT = os.environ["ANKI_VIM_E2E_OUT"]
HERE = os.path.dirname(os.path.realpath(__file__))
results = {}
RUNS = []

with open(os.environ["ANKI_VIM_E2E_JS"], encoding="utf-8") as f:
    PAGE_JS = f.read()


MATHJAX_JS = r"""
(async function () {
    const out = {};
    const pause = (ms) => new Promise((r) => setTimeout(r, ms || 80));
    try {
        const V = window.ankiVim._state;
        const I = window.ankiVim._internals;
        const f = document.querySelector(".rich-text-editable").shadowRoot.querySelector("anki-editable");
        const feed = window.__vimE2E.feed;
        const text = () => I.remodel().text;
        f.focus();
        window.ankiVim.setMode("normal");
        await pause(200);
        out.liveHtml = f.innerHTML.slice(0, 600);
        await feed("gg");
        out.text = text();
        await feed("ww");
        out.charAfterWW = text()[V.pos];
        await feed("dd");
        out.afterDd = text();
        await feed("p");
        await pause(300);
        out.afterP = text();
        await feed("u");
        await pause(300);
        out.afterU = text();
        await feed("u");
        await pause(300);
        out.afterUU = text();
        await feed("ggwx");
        await pause(200);
        out.afterXOnMath = text();
        await feed("u");
        await pause(300);
        out.afterUndoX = text();
        await feed("<C-r>");
        await pause(300);
        out.afterRedoX = text();
        await feed("u");
        await pause(300);
        await feed("ggddp");
        await pause(400);
        out.final = text();
    } catch (error) {
        out.error = String(error && error.stack ? error.stack : error);
    }
    window.__vimE2EMath = JSON.stringify(out);
})();
"""


def write():
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)


def finish():
    write()

    # Stop the audio helper Anki started, then leave without the slow (and
    # here pointless) profile shutdown.
    try:
        from aqt.sound import av_player

        av_player.shutdown()
    except Exception:
        pass

    QTimer.singleShot(300, lambda: os._exit(0))


def guarded(fn):
    def inner(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception:
            results.setdefault("errors", []).append(traceback.format_exc())
            finish()

    return inner


def press(widget, key, modifiers=Qt.KeyboardModifier.NoModifier, text=""):
    for kind in (QEvent.Type.KeyPress, QEvent.Type.KeyRelease):
        QApplication.sendEvent(widget, QKeyEvent(kind, key, modifiers, text))


class Run:
    def __init__(self, label, open_window, then):
        self.label = label
        self.open_window = open_window
        self.then = then
        self.r = results.setdefault(label, {})

    @guarded
    def start(self):
        self.count_before = mw.col.note_count()
        self.window = self.open_window()
        self.editor = self.window.editor
        self.r["editor_class"] = type(self.editor).__name__
        self.r["controller"] = hasattr(self.editor, "vim_mode_controller")
        QTimer.singleShot(4000, self.page_tests)

    @guarded
    def page_tests(self):
        self.window.activateWindow()
        self.editor.web.setFocus()
        self.editor.web.eval(PAGE_JS)
        self.polls = 0
        QTimer.singleShot(500, self.poll_page)

    @guarded
    def poll_page(self):
        self.editor.web.evalWithCallback(
            "window.__vimE2EResult || null", self.got_page
        )

    @guarded
    def got_page(self, raw):
        if not raw:
            self.polls += 1

            if self.polls > 40:
                self.r["page"] = "timed out"
                self.then()
            else:
                QTimer.singleShot(500, self.poll_page)

            return

        self.r["page"] = json.loads(raw)
        write()
        QTimer.singleShot(600, self.escape_test)

    @guarded
    def escape_test(self):
        # Real Esc key through Qt while in insert mode: must leave insert
        # mode and must NOT close the window.
        self.editor.web.evalWithCallback(
            "(function(){ window.ankiVim.setMode('insert');"
            " return window.ankiVim._state.mode; })()",
            guarded(self.escape_pressed),
        )

    def escape_pressed(self, mode):
        self.r["mode_before_esc"] = mode
        self.r["focus_widget"] = type(QApplication.focusWidget()).__name__
        target = self.editor.web.focusProxy() or self.editor.web
        target.setFocus()
        self.r["focus_in_editor"] = (
            self.editor.vim_mode_controller.focus_is_in_editor()
        )
        press(target, Qt.Key.Key_Escape)
        QTimer.singleShot(500, self.after_escape)

    @guarded
    def after_escape(self):
        self.r["window_visible_after_esc"] = self.window.isVisible()
        self.editor.web.evalWithCallback(
            "window.ankiVim._state.mode", guarded(self.read_fields)
        )

    def read_fields(self, mode):
        self.r["mode_after_esc"] = mode

        # What does Anki itself think the fields contain now?
        if hasattr(self.editor, "get_note_info"):
            self.editor.get_note_info(guarded(self.got_note_info))
        else:
            self.editor.call_after_note_saved(
                guarded(lambda: self.got_fields(list(self.editor.note.fields)))
            )

    def got_note_info(self, info):
        self.got_fields(list(info.fields))

    def got_fields(self, fields):
        self.r["anki_fields"] = fields
        write()
        # :w must add the note.
        self.editor.web.eval(
            "window.__vimE2EResult = null; window.__vimE2E.feed(':w<CR>');"
        )
        QTimer.singleShot(2500, self.after_write)

    @guarded
    def after_write(self):
        self.r["notes_added"] = mw.col.note_count() - self.count_before
        nids = mw.col.find_notes("")
        if nids:
            self.r["last_note_fields"] = list(mw.col.get_note(max(nids)).fields)
        write()

        if hasattr(self.editor, "loadNote") and getattr(self.editor, "note", None):
            self.mathjax_test()
        else:
            self.close_and_continue()

    def close_and_continue(self):
        try:
            self.window._close() if hasattr(self.window, "_close") else self.window.close()
        except Exception:
            pass
        QTimer.singleShot(1200, self.then)

    # MathJax and images are rendered by Anki as special elements inside the
    # field; check the cursor and line operations cope with them.
    @guarded
    def mathjax_test(self):
        self.editor.note.fields[0] = (
            "alpha \\(x^2\\) beta<br>second <b>bold</b> line<br>third"
        )
        self.editor.loadNote()
        QTimer.singleShot(2500, self.mathjax_run)

    @guarded
    def mathjax_run(self):
        self.editor.web.eval(MATHJAX_JS)
        QTimer.singleShot(6000, self.mathjax_collect)

    @guarded
    def mathjax_collect(self):
        self.editor.web.evalWithCallback(
            "window.__vimE2EMath || null", guarded(self.mathjax_got)
        )

    def mathjax_got(self, raw):
        self.r["mathjax_page"] = json.loads(raw) if raw else raw
        self.editor.call_after_note_saved(guarded(self.mathjax_saved))

    def mathjax_saved(self):
        self.r["mathjax_anki_fields"] = list(self.editor.note.fields)
        write()
        self.close_and_continue()


def open_legacy():
    return aqt.dialogs.open("AddCards", mw)


def open_new():
    window = aqt.dialogs.open("NewAddCards", mw)
    window.load_new_note()
    return window


def begin():
    results["anki_version"] = aqt.appVersion
    second = Run("new_editor", open_new, finish)
    first = Run("classic_editor", open_legacy, second.start)
    RUNS.extend([first, second])  # keep them alive for the timers
    QTimer.singleShot(1500, first.start)
    QTimer.singleShot(85000, finish)


gui_hooks.profile_did_open.append(guarded(begin))
