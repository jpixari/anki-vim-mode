# vim_core.py
#
# Python side of Anki Vim Mode. All editing happens in the editor webview
# (vim_text.js + editor_vim.js); this file only:
#   - injects those scripts and the user's config into each editor,
#   - turns Esc into "leave insert mode" instead of "close the window",
#   - runs the ex commands that need Anki (:w, :wq, :q, :help),
#   - bridges the system clipboard for the "+ register.

import json
import os

from aqt import gui_hooks, mw
from aqt.qt import QApplication, QEvent, QKeyEvent, QObject, Qt, QTimer
from aqt.utils import showText, tooltip

ADDON_DIR = os.path.dirname(__file__)
ADDON_PACKAGE = __name__.split(".")[0]
SCRIPTS = ["vim_text.js", "editor_vim.js"]
CSS_FILE = "editor_vim.css"
MESSAGE_PREFIX = "anki_vim:"
MAX_CLIPBOARD_CHARS = 200_000

DEFAULT_CONFIG = {
    "enable_in_browser": True,
    "shift_jk_fields": True,
    "insert_escape": "",
    "insert_escape_timeout_ms": 400,
    "start_in_insert": False,
    "system_clipboard": False,
    "jk_display_lines": False,
    "show_status": True,
    "status_position": "bottom-left",
    "vim_ctrl_keys": False,
    "cursor_color": "auto",
    "cursor_blink": False,
    "cursor_min_width": 0,
}

HELP_TEXT = """Anki Vim Mode

MODES
  Esc / Ctrl-[        normal mode          i a I A o O gi  insert
  v  V  Ctrl-q        visual / line / block               R  replace

MOVING
  h j k l             left/down/up/right   w b e ge        words (W B E gE)
  0 ^ $ g_            line start/end       gg G {n}G H M L lines
  f F t T {char}      find on line         ; ,             repeat find
  { }  ( )            paragraphs/sentences %               matching bracket
  gj gk               display lines        J K             next/previous field
  m{a-z}  `{a-z}      set / jump to mark   ``              back to last jump

EDITING
  d c y {motion}      delete/change/yank   dd cc yy        whole lines
  x X s S D C Y       shortcuts            p P gp gP       paste
  r{char}  ~          replace / flip case  gu gU g~        change case
  gJ                  join lines           > <             indent / outdent
  .                   repeat last change   u  Ctrl-r       undo / redo
  "{reg}              use a register       q{reg} @{reg}   record / play macro
  gc gC {motion}      make a cloze deletion (new number / same number)

TEXT OBJECTS (after d c y v gc, with i = inner, a = around)
  w W                 word                 " ' `           quotes
  ( [ { <             brackets             p  s            paragraph, sentence
  c                   cloze deletion: cic changes the answer of {{c1::...}}

VISUAL BLOCK (Ctrl-q)
  I A c               insert/append/change on every line   d y p r ~ u U

SEARCH AND COMMANDS
  /text  ?text        search               n N  * #        next/previous/word
  :s/old/new/g        replace on line      :%s/old/new/g   replace in field
  &  g&               repeat substitute    :{n}            go to line n
  :m {n}  :t {n}      move / copy lines    :normal {keys}  run keys on lines
  :w                  add / save note      :wq  :q         and close / close
  :reg  :marks        show registers / marks

A count works in front of most commands: 3dd, 2dw, 5j, d3w, 3., 3ix<Esc>.
In visual mode Anki's own shortcuts (Ctrl+B, Ctrl+Shift+C ...) act on the
selection. Settings: Tools > Add-ons > Anki Vim Mode > Config.
"""


def load_config():
    config = dict(DEFAULT_CONFIG)

    try:
        user = mw.addonManager.getConfig(ADDON_PACKAGE) or {}
    except Exception:
        user = {}

    for key, value in user.items():
        if value is not None:
            config[key] = value

    return config


def read_addon_file(name):
    with open(os.path.join(ADDON_DIR, name), "r", encoding="utf-8") as f:
        return f.read()


class VimModeController(QObject):
    def __init__(self, editor):
        self.editor = editor
        self.window = getattr(editor, "parentWindow", None)

        super().__init__(self.window)

        self.is_add_mode = bool(getattr(editor, "addMode", False))
        self.alive = True

        QApplication.instance().installEventFilter(self)
        gui_hooks.webview_did_receive_js_message.append(self.on_js_message)
        gui_hooks.editor_did_load_note.append(self.on_note_loaded)

        try:
            QApplication.clipboard().dataChanged.connect(self.push_clipboard)
        except Exception:
            pass

        if self.window is not None:
            try:
                self.window.destroyed.connect(self.teardown)
            except Exception:
                pass

        self.inject()

    # Setup / teardown
    ######################################################################

    def teardown(self, *args):
        if not self.alive:
            return

        self.alive = False

        for hook, callback in (
            (gui_hooks.webview_did_receive_js_message, self.on_js_message),
            (gui_hooks.editor_did_load_note, self.on_note_loaded),
        ):
            try:
                hook.remove(callback)
            except Exception:
                pass

        try:
            QApplication.clipboard().dataChanged.disconnect(self.push_clipboard)
        except Exception:
            pass

        try:
            QApplication.instance().removeEventFilter(self)
        except Exception:
            pass

    def web(self):
        if not self.alive:
            return None

        return getattr(self.editor, "web", None)

    def run_js(self, js):
        web = self.web()

        if web is None:
            return

        try:
            web.eval(js)
        except Exception:
            # The webview was deleted underneath us.
            self.teardown()

    def inject(self):
        try:
            css = read_addon_file(CSS_FILE)
            scripts = [read_addon_file(name) for name in SCRIPTS]
        except OSError as error:
            tooltip(f"Anki Vim Mode: could not load its files: {error}")
            return

        css_js = """
(function () {
    let style = document.getElementById("anki-vim-css");
    if (!style) {
        style = document.createElement("style");
        style.id = "anki-vim-css";
        document.head.appendChild(style);
    }
    style.textContent = %s;
})();
""" % json.dumps(css)

        config_js = "window.ankiVimConfig = %s;" % json.dumps(load_config())

        # The scripts are no-ops when this version is already running in the
        # page, so injecting again (e.g. after a note loads) is safe.
        self.run_js("\n;\n".join([css_js, config_js] + scripts))
        self.push_clipboard()

    def on_note_loaded(self, editor):
        if editor is not self.editor:
            return

        self.inject()
        self.run_js("if (window.ankiVim) { window.ankiVim.noteLoaded(); }")

    # Clipboard bridge for the "+ and "* registers
    ######################################################################

    def push_clipboard(self):
        try:
            text = QApplication.clipboard().text() or ""
        except Exception:
            return

        if len(text) > MAX_CLIPBOARD_CHARS:
            text = ""

        self.run_js(
            "if (window.ankiVim) { window.ankiVim.setClipboard(%s); }"
            % json.dumps(text)
        )

    # Commands from the webview
    ######################################################################

    def on_js_message(self, handled, message, context):
        # This hook is global: only react to messages from our own editor.
        if context is not self.editor:
            return handled

        if not isinstance(message, str) or not message.startswith(MESSAGE_PREFIX):
            return handled

        try:
            payload = json.loads(message[len(MESSAGE_PREFIX) :])
            command = payload.get("cmd")
        except Exception:
            return (True, None)

        if command == "w":
            self.save_note()
        elif command == "wq":
            self.save_note(then_close=True)
        elif command == "q":
            self.close_window()
        elif command == "clip":
            try:
                QApplication.clipboard().setText(str(payload.get("text", "")))
            except Exception:
                pass
        elif command == "help":
            self.show_help()

        return (True, None)

    def show_help(self):
        options = dict(
            parent=self.window, title="Anki Vim Mode", minWidth=720, minHeight=560
        )

        try:
            # Monospace view; not available on older Anki versions.
            showText(HELP_TEXT, plain_text_edit=True, **options)
        except TypeError:
            showText(HELP_TEXT, **options)

    def save_note(self, then_close=False):
        after = self.close_window if then_close else None

        if self.is_add_mode:
            self.add_note()

            if after:
                # Adding is asynchronous; give it a moment before closing.
                QTimer.singleShot(400, after)

            return

        def saved():
            tooltip("Saved", parent=self.window)

            if after:
                after()

        try:
            self.editor.call_after_note_saved(saved, keepFocus=True)
        except Exception:
            saved()

    def add_note(self):
        window = self.window

        # Classic Add Cards window.
        for name in ("add_current_note", "addCards"):
            method = getattr(window, name, None)

            if callable(method):
                try:
                    method()
                except Exception as error:
                    tooltip(f"Could not add card: {error}", parent=window)

                return

        # The new (Svelte) editor adds notes from inside the page, where the
        # Add button listens for Ctrl+Enter. Send it that key press.
        web = self.web()
        target = web.focusProxy() if web is not None else None

        if target is None:
            tooltip("Could not add card", parent=window)
            return

        for event_type in (QEvent.Type.KeyPress, QEvent.Type.KeyRelease):
            QApplication.postEvent(
                target,
                QKeyEvent(
                    event_type,
                    Qt.Key.Key_Return,
                    Qt.KeyboardModifier.ControlModifier,
                ),
            )

    def close_window(self):
        try:
            if self.window is not None:
                self.window.close()
        except Exception:
            pass

    # Esc handling
    ######################################################################

    def focus_is_in_editor(self):
        web = self.web()

        if web is None:
            return False

        try:
            widget = QApplication.focusWidget()

            while widget is not None:
                if widget is web:
                    return True

                widget = widget.parentWidget()
        except RuntimeError:
            # Wrapped C++ object was deleted.
            self.teardown()

        return False

    def eventFilter(self, obj, event):
        event_type = event.type()

        if event_type not in (
            QEvent.Type.ShortcutOverride,
            QEvent.Type.KeyPress,
        ):
            return False

        if event.key() != Qt.Key.Key_Escape or event.modifiers() not in (
            Qt.KeyboardModifier.NoModifier,
            Qt.KeyboardModifier.KeypadModifier,
        ):
            return False

        # Only while typing in this editor's fields. Everywhere else (the
        # Browser's search bar, dialogs, ...) Esc keeps its normal meaning.
        if not self.focus_is_in_editor():
            return False

        event.accept()

        if event_type == QEvent.Type.KeyPress:
            self.run_js("if (window.ankiVim) { window.ankiVim.escape(); }")

        return True


def install_vim_mode(editor):
    if getattr(editor, "vim_mode_controller", None) is not None:
        return

    editor.vim_mode_controller = VimModeController(editor)
