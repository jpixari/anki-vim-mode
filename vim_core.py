# vim_core.py

import json
import os

from aqt import gui_hooks
from aqt.qt import QObject, QEvent, Qt, QApplication, QTimer

from .command_line import VimCommandLine
from .line_ops import VimLineOps

ADDON_DIR = os.path.dirname(__file__)
JS_PATH = os.path.join(ADDON_DIR, "editor_vim.js")
CSS_PATH = os.path.join(ADDON_DIR, "editor_vim.css")


class VimModeController(QObject):
    def __init__(self, addcards):
        super().__init__(addcards)

        self.addcards = addcards
        self.editor = addcards.editor
        self.mode = "normal"
        self.command_line = VimCommandLine(addcards, self)
        self.line_ops = VimLineOps()

        addcards.installEventFilter(self)
        self.editor.web.installEventFilter(self)
        QApplication.instance().installEventFilter(self)

        # Anki hook objects are not iterable in newer Anki/PyQt builds.
        # Do not use: `if callback not in gui_hooks...`
        gui_hooks.webview_did_receive_js_message.append(self.on_js_message)

        self.inject_repeatedly()

    def web(self):
        try:
            editor = getattr(self, "editor", None)
            if editor is None:
                return None

            web = getattr(editor, "web", None)
            if web is None:
                return None

            return web
        except Exception:
            return None

    def is_web_alive(self):
        return self.web() is not None

    def read_file(self, path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def inject_css(self):
        web = self.web()

        if web is None:
            return

        if not os.path.exists(CSS_PATH):
            return

        try:
            css = self.read_file(CSS_PATH)
        except Exception:
            return

        js = f"""
        (function() {{
            let style = document.getElementById("anki-vim-css");

            if (!style) {{
                style = document.createElement("style");
                style.id = "anki-vim-css";
                document.head.appendChild(style);
            }}

            style.textContent = {css!r};
        }})();
        """

        try:
            web.eval(js)
        except Exception:
            pass

    def inject_js(self):
        web = self.web()

        if web is None:
            return

        if not os.path.exists(JS_PATH):
            return

        try:
            js = self.read_file(JS_PATH)
        except Exception:
            return

        try:
            web.eval(js)
        except Exception:
            pass

    def inject_all(self):
        if not self.is_web_alive():
            return

        self.inject_css()
        self.inject_js()

    def inject_repeatedly(self):
        self.inject_all()

        QTimer.singleShot(300, self.inject_all)
        QTimer.singleShot(1000, self.inject_all)
        QTimer.singleShot(2000, self.inject_all)
        QTimer.singleShot(4000, self.inject_all)

    def run_js(self, js):
        web = self.web()

        if web is None:
            return False

        try:
            web.eval(js)
            return True
        except Exception:
            return False

    def is_add_window_active(self):
        try:
            return QApplication.activeWindow() is self.addcards
        except Exception:
            return False

    def is_shift_j(self, key, modifiers):
        return (
            key == Qt.Key.Key_J
            and modifiers & Qt.KeyboardModifier.ShiftModifier
            and not modifiers & Qt.KeyboardModifier.ControlModifier
            and not modifiers & Qt.KeyboardModifier.AltModifier
            and not modifiers & Qt.KeyboardModifier.MetaModifier
        )

    def is_shift_k(self, key, modifiers):
        return (
            key == Qt.Key.Key_K
            and modifiers & Qt.KeyboardModifier.ShiftModifier
            and not modifiers & Qt.KeyboardModifier.ControlModifier
            and not modifiers & Qt.KeyboardModifier.AltModifier
            and not modifiers & Qt.KeyboardModifier.MetaModifier
        )

    def current_field_index(self):
        index = None

        try:
            index = self.editor.currentField
        except Exception:
            index = None

        if index is None:
            try:
                index = self.editor.last_field_index
            except Exception:
                index = None

        if index is None:
            index = 0

        try:
            return int(index)
        except Exception:
            return 0

    def set_current_field_index(self, index):
        try:
            index = int(index)
        except Exception:
            index = 0

        try:
            self.editor.currentField = index
            self.editor.last_field_index = index
        except Exception:
            pass

        return index

    def save_current_then(self, callback):
        if not self.is_web_alive():
            return

        try:
            self.editor.call_after_note_saved(callback, keepFocus=True)
        except TypeError:
            try:
                self.editor.call_after_note_saved(callback)
            except Exception:
                callback()
        except Exception:
            callback()

    def send_line_result(self, result):
        if not self.is_web_alive():
            return False

        js = f"""
        (function() {{
            if (window.ankiVim && window.ankiVim.receivePythonLineOp) {{
                window.ankiVim.receivePythonLineOp({json.dumps(result)});
            }}
        }})();
        """

        return self.run_js(js)

    def send_line_result_later(self, result, delay=0):
        def later():
            if self.is_web_alive():
                self.send_line_result(result)

        QTimer.singleShot(delay, later)

    def do_python_line_op(self, payload):
        if not self.is_web_alive():
            return

        try:
            note = self.editor.note
        except Exception:
            note = None

        fallback_field_index = self.current_field_index()

        result, changed = self.line_ops.process(
            note=note,
            payload=payload,
            fallback_field_index=fallback_field_index,
        )

        field_index = result.get("fieldIndex", fallback_field_index)
        self.set_current_field_index(field_index)

        # Important:
        # Do NOT call editor.loadNote(), loadNoteKeepingFocus(), or reload_field()
        # after dd / p / P. Reloading the field rebuilds Anki's editor DOM and
        # causes delayed selection/focus events to move the caret to the bottom
        # or to wrapper offset 0. Instead, line_ops returns newText/newHtml and
        # editor_vim.js patches the visible field in-place.
        #
        # The note field is already updated by line_ops.process(), so the model
        # data is correct; JS only needs to keep the visible editor in sync.
        self.send_line_result(result)

    def on_js_message(self, handled, message, context):
        if not isinstance(message, str):
            return handled

        if message.startswith("focus:"):
            try:
                index = int(message[len("focus:") :])
                self.set_current_field_index(index)
            except Exception:
                pass

            return (True, None)

        if not message.startswith("anki_vim:"):
            return handled

        if not self.is_web_alive():
            return (True, None)

        try:
            payload = json.loads(message[len("anki_vim:") :])
        except Exception as error:
            self.send_line_result(
                {
                    "ok": False,
                    "error": "bad json: " + str(error),
                    "action": "bad json",
                    "changed": False,
                }
            )
            return (True, None)

        self.save_current_then(lambda: self.do_python_line_op(payload))
        return (True, None)

    def eventFilter(self, obj, event):
        event_type = event.type()

        if event_type not in [
            QEvent.Type.ShortcutOverride,
            QEvent.Type.KeyPress,
        ]:
            return False

        if not self.is_add_window_active():
            return False

        key = event.key()
        text = event.text()
        modifiers = event.modifiers()

        # IMPORTANT:
        # Shift+J and Shift+K are handled in editor_vim.js, not here.
        # If Qt catches them here, insert mode cannot type capital J/K.
        shift_j = self.is_shift_j(key, modifiers)
        shift_k = self.is_shift_k(key, modifiers)

        if shift_j or shift_k:
            return False

        if key == Qt.Key.Key_Escape:
            event.accept()
            self.mode = "normal"
            self.run_js("""
                if (window.ankiVim) {
                    if (window.ankiVim.mode === "visual" && window.ankiVim.exitVisualMode) {
                        window.ankiVim.exitVisualMode(false);
                    } else {
                        window.ankiVim.setMode("normal");
                    }

                    window.ankiVim.lastAction = "python escape -> normal";
                    window.ankiVim.updateDebugIfVisible();
                }
            """)
            return True

        if event_type == QEvent.Type.ShortcutOverride:
            if text == ":" or key == Qt.Key.Key_Colon:
                event.accept()
                return True

            return False

        if text == ":" or key == Qt.Key.Key_Colon:
            event.accept()
            self.command_line.open()
            return True

        return False


def install_vim_mode(addcards):
    addcards.vim_mode_controller = VimModeController(addcards)
