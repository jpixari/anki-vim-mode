import html
import json
import os
import re

from aqt import gui_hooks
from aqt.qt import QObject, QEvent, Qt, QApplication, QTimer
from .command_line import VimCommandLine

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
        self.yank_text = ""
        self.yank_is_line = False

        addcards.installEventFilter(self)
        self.editor.web.installEventFilter(self)
        QApplication.instance().installEventFilter(self)

        # Anki hook objects are not iterable in newer Anki/PyQt builds.
        # Do not use: `if callback not in gui_hooks...`
        gui_hooks.webview_did_receive_js_message.append(self.on_js_message)

        self.inject_repeatedly()

    def read_file(self, path):
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def inject_css(self):
        if not os.path.exists(CSS_PATH):
            return

        css = self.read_file(CSS_PATH)
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
        self.editor.web.eval(js)

    def inject_js(self):
        if not os.path.exists(JS_PATH):
            return

        js = self.read_file(JS_PATH)
        self.editor.web.eval(js)

    def inject_all(self):
        self.inject_css()
        self.inject_js()

    def inject_repeatedly(self):
        self.inject_all()
        QTimer.singleShot(300, self.inject_all)
        QTimer.singleShot(1000, self.inject_all)
        QTimer.singleShot(2000, self.inject_all)
        QTimer.singleShot(4000, self.inject_all)

    def run_js(self, js):
        self.editor.web.eval(js)

    def is_add_window_active(self):
        return QApplication.activeWindow() is self.addcards

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

    def html_to_plain(self, value):
        if value is None:
            return ""

        text = str(value)

        text = re.sub(r"(?i)<br\s*/?>", "\n", text)
        text = re.sub(r"(?i)</div>\s*<div[^>]*>", "\n", text)
        text = re.sub(r"(?i)<div[^>]*>", "", text)
        text = re.sub(r"(?i)</div>", "", text)
        text = re.sub(r"(?i)</p>\s*<p[^>]*>", "\n", text)
        text = re.sub(r"(?i)<p[^>]*>", "", text)
        text = re.sub(r"(?i)</p>", "", text)
        text = re.sub(r"<[^>]+>", "", text)

        return html.unescape(text)

    def plain_to_html(self, value):
        lines = str(value).split("\n")
        return "<br>".join(html.escape(line, quote=False) for line in lines)

    def text_lines_keep_empty(self, text):
        if text == "":
            return [""]
        return text.split("\n")

    def line_index_from_offset(self, text, offset):
        offset = max(0, min(offset, len(text)))
        return text[:offset].count("\n")

    def safe_line_index(self, text, payload):
        lines = self.text_lines_keep_empty(text)

        hint = payload.get("lineIndexHint", None)
        if hint is not None:
            try:
                hint = int(hint)
            except Exception:
                hint = 0

            if hint < 0:
                hint = 0

            if hint >= len(lines):
                hint = len(lines) - 1

            return hint

        caret = payload.get("caretOffset", 0)
        try:
            caret = int(caret)
        except Exception:
            caret = 0

        return self.line_index_from_offset(text, caret)

    def offset_for_line_index(self, text, line_index):
        lines = self.text_lines_keep_empty(text)

        line_index = max(0, min(line_index, len(lines) - 1))

        offset = 0
        for i in range(line_index):
            offset += len(lines[i]) + 1

        return offset

    def line_bounds_by_index(self, text, line_index, include_newline):
        lines = self.text_lines_keep_empty(text)
        line_index = max(0, min(line_index, len(lines) - 1))

        start = self.offset_for_line_index(text, line_index)
        end = start + len(lines[line_index])

        if include_newline and end < len(text):
            end += 1

        return start, end

    def line_bounds(self, text, offset, include_newline):
        offset = max(0, min(offset, len(text)))

        start = text.rfind("\n", 0, offset)
        if start == -1:
            start = 0
        else:
            start += 1

        end = text.find("\n", offset)
        if end == -1:
            end = len(text)
        elif include_newline:
            end += 1

        return start, end

    def safe_field_index(self, index):
        note = self.editor.note
        if not note:
            return None

        if index is None:
            index = self.editor.currentField

        if index is None:
            index = self.editor.last_field_index

        if index is None:
            index = 0

        try:
            index = int(index)
        except Exception:
            index = 0

        if index < 0 or index >= len(note.fields):
            return None

        return index

    def save_current_then(self, callback):
        try:
            self.editor.call_after_note_saved(callback, keepFocus=True)
        except TypeError:
            self.editor.call_after_note_saved(callback)
        except Exception:
            callback()

    def reload_field(self, index):
        try:
            self.editor.currentField = index
            self.editor.last_field_index = index
        except Exception:
            pass

        try:
            self.editor.loadNote(index)
        except Exception:
            try:
                self.editor.loadNoteKeepingFocus()
            except Exception:
                pass

        QTimer.singleShot(120, self.inject_all)
        QTimer.singleShot(250, self.inject_all)

    def send_line_result(self, result):
        js = f"""
        if (window.ankiVim && window.ankiVim.receivePythonLineOp) {{
            window.ankiVim.receivePythonLineOp({json.dumps(result)});
        }}
        """
        self.run_js(js)

    def do_python_line_op(self, payload):
        note = self.editor.note
        if not note:
            self.send_line_result(
                {
                    "ok": False,
                    "op": payload.get("op"),
                    "error": "no note",
                }
            )
            return

        op = payload.get("op")
        index = self.safe_field_index(payload.get("fieldIndex"))

        if index is None:
            self.send_line_result(
                {
                    "ok": False,
                    "op": op,
                    "error": "bad field index",
                }
            )
            return

        raw = note.fields[index]
        text = self.html_to_plain(raw)
        line_index = self.safe_line_index(text, payload)

        caret = payload.get("caretOffset", None)
        try:
            caret = int(caret)
        except Exception:
            caret = self.offset_for_line_index(text, line_index)

        caret = max(0, min(caret, len(text)))

        if op == "yy":
            start, end = self.line_bounds_by_index(
                text,
                line_index,
                include_newline=False,
            )
            yanked = text[start:end] + "\n"

            self.yank_text = yanked
            self.yank_is_line = True

            self.send_line_result(
                {
                    "ok": True,
                    "op": "yy",
                    "fieldIndex": index,
                    "lineIndexHint": line_index,
                    "yankText": yanked,
                    "yankIsLine": True,
                    "caretOffset": self.offset_for_line_index(text, line_index),
                    "action": f"yy yanked line index={line_index} start={start} end={end} text={yanked!r}",
                }
            )
            return

        if op == "dd":
            start, end = self.line_bounds_by_index(
                text,
                line_index,
                include_newline=True,
            )
            deleted = text[start:end]

            yanked = deleted.rstrip("\n") + "\n"
            new_text = text[:start] + text[end:]

            new_lines = self.text_lines_keep_empty(new_text)
            new_line_index = min(line_index, len(new_lines) - 1)
            new_caret = self.offset_for_line_index(new_text, new_line_index)

            note.fields[index] = self.plain_to_html(new_text)
            self.yank_text = yanked
            self.yank_is_line = True

            self.reload_field(index)

            QTimer.singleShot(
                160,
                lambda: self.send_line_result(
                    {
                        "ok": True,
                        "op": "dd",
                        "fieldIndex": index,
                        "lineIndexHint": new_line_index,
                        "yankText": yanked,
                        "yankIsLine": True,
                        "caretOffset": new_caret,
                        "action": f"dd deleted line index={line_index} start={start} end={end} yank={yanked!r}",
                    }
                ),
            )
            return

        if op == "p":
            yank_text = payload.get("yankText", self.yank_text)
            yank_is_line = bool(payload.get("yankIsLine", self.yank_is_line))

            if not yank_text:
                self.send_line_result(
                    {
                        "ok": False,
                        "op": "p",
                        "error": "empty yank",
                    }
                )
                return

            if yank_is_line:
                lines = self.text_lines_keep_empty(text)
                line_index = max(0, min(line_index, len(lines) - 1))
                start, end = self.line_bounds_by_index(
                    text,
                    line_index,
                    include_newline=False,
                )
                line_text = yank_text.rstrip("\n")

                if text:
                    insert_at = end
                    insert_text = "\n" + line_text
                    new_line_index = line_index + 1
                else:
                    insert_at = 0
                    insert_text = line_text
                    new_line_index = 0
            else:
                insert_at = caret
                insert_text = yank_text
                new_line_index = self.line_index_from_offset(
                    text, insert_at + len(insert_text)
                )

            new_text = text[:insert_at] + insert_text + text[insert_at:]
            new_caret = insert_at + len(insert_text)

            note.fields[index] = self.plain_to_html(new_text)

            self.reload_field(index)

            QTimer.singleShot(
                160,
                lambda: self.send_line_result(
                    {
                        "ok": True,
                        "op": "p",
                        "fieldIndex": index,
                        "lineIndexHint": new_line_index,
                        "yankText": yank_text,
                        "yankIsLine": yank_is_line,
                        "caretOffset": new_caret,
                        "action": f"p pasted index={new_line_index} text={insert_text!r}",
                    }
                ),
            )
            return

        self.send_line_result(
            {
                "ok": False,
                "op": op,
                "error": "unknown op",
            }
        )

    def on_js_message(self, handled, message, context):
        if not isinstance(message, str):
            return handled

        if not message.startswith("anki_vim:"):
            return handled

        try:
            payload = json.loads(message[len("anki_vim:") :])
        except Exception as error:
            self.send_line_result(
                {
                    "ok": False,
                    "error": "bad json: " + str(error),
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
        # Let them pass through to the web editor; JS will move fields only
        # when Vim mode is normal/visual, and will pass them through in insert.
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
