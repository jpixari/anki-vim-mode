# line_ops.py

import html
import re


class VimLineOps:
    def __init__(self):
        self.yank_text = ""
        self.yank_is_line = False

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

        return str(text).split("\n")

    def clamp_line_index(self, line_index, line_count):
        if line_count <= 0:
            return 0

        try:
            line_index = int(line_index)
        except Exception:
            line_index = 0

        if line_index < 0:
            line_index = 0

        if line_index >= line_count:
            line_index = line_count - 1

        return line_index

    def offset_for_line_index(self, text, line_index):
        lines = self.text_lines_keep_empty(text)
        line_index = self.clamp_line_index(line_index, len(lines))

        offset = 0

        for i in range(line_index):
            offset += len(lines[i]) + 1

        return offset

    def line_index_from_offset(self, text, offset):
        text = str(text)

        try:
            offset = int(offset)
        except Exception:
            offset = 0

        offset = max(0, min(offset, len(text)))
        return text[:offset].count("\n")

    def safe_line_index(self, text, payload):
        lines = self.text_lines_keep_empty(text)

        current = payload.get("vimLineIndex", None)
        if current is not None:
            return self.clamp_line_index(current, len(lines))

        current = payload.get("currentLineIndex", None)
        if current is not None:
            return self.clamp_line_index(current, len(lines))

        hint = payload.get("lineIndexHint", None)
        if hint is not None:
            return self.clamp_line_index(hint, len(lines))

        caret = payload.get("caretOffset", 0)
        return self.clamp_line_index(
            self.line_index_from_offset(text, caret),
            len(lines),
        )

    def safe_field_index(self, note, index, fallback_index=0):
        if not note:
            return None

        if index is None:
            index = fallback_index

        if index is None:
            index = 0

        try:
            index = int(index)
        except Exception:
            index = 0

        if index < 0 or index >= len(note.fields):
            return None

        return index

    def result(
        self,
        ok,
        op,
        field_index,
        line_index,
        text,
        action,
        changed=False,
        should_reload=False,
        error=None,
    ):
        lines = self.text_lines_keep_empty(text)
        safe_line = self.clamp_line_index(line_index, len(lines))
        caret = self.offset_for_line_index(text, safe_line)
        html_text = self.plain_to_html(text)

        data = {
            "ok": ok,
            "op": op,
            "fieldIndex": field_index,
            "vimLineIndex": safe_line,
            "currentLineIndex": safe_line,
            "lineIndexHint": safe_line,
            "caretOffset": caret,
            "yankText": self.yank_text,
            "yankIsLine": self.yank_is_line,
            "action": action,
            # JS uses this to patch the visible editor in place.
            "changed": changed,
            "newText": text,
            "newHtml": html_text,
        }

        if error:
            data["error"] = error

        # Second tuple value means "should vim_core reload the field?"
        # Keep this False for dd/p/P so Anki does not move the caret to bottom.
        return data, should_reload

    def error_result(self, op, field_index, line_index, text, error, action):
        return self.result(
            ok=False,
            op=op,
            field_index=field_index,
            line_index=line_index,
            text=text,
            action=action,
            changed=False,
            should_reload=False,
            error=error,
        )

    def process(self, note, payload, fallback_field_index=0):
        if not note:
            return (
                {
                    "ok": False,
                    "op": payload.get("op"),
                    "error": "no note",
                    "action": "line op failed: no note",
                    "changed": False,
                },
                False,
            )

        op = payload.get("op")
        field_index = self.safe_field_index(
            note,
            payload.get("fieldIndex"),
            fallback_field_index,
        )

        if field_index is None:
            return (
                {
                    "ok": False,
                    "op": op,
                    "error": "bad field index",
                    "action": "line op failed: bad field index",
                    "changed": False,
                },
                False,
            )

        raw = note.fields[field_index]
        text = self.html_to_plain(raw)
        lines = self.text_lines_keep_empty(text)
        line_index = self.safe_line_index(text, payload)

        if op == "yy":
            yanked = lines[line_index] + "\n"

            self.yank_text = yanked
            self.yank_is_line = True

            return self.result(
                ok=True,
                op="yy",
                field_index=field_index,
                line_index=line_index,
                text=text,
                action=f"yy yanked line index={line_index} text={yanked!r}",
                changed=False,
                should_reload=False,
            )

        if op == "dd":
            deleted_line = lines[line_index]
            yanked = deleted_line + "\n"

            self.yank_text = yanked
            self.yank_is_line = True

            if len(lines) <= 1:
                new_lines = [""]
                new_line_index = 0
            else:
                new_lines = list(lines)
                del new_lines[line_index]
                new_line_index = min(line_index, len(new_lines) - 1)
                new_line_index = max(0, new_line_index)

            new_text = "\n".join(new_lines)
            note.fields[field_index] = self.plain_to_html(new_text)

            return self.result(
                ok=True,
                op="dd",
                field_index=field_index,
                line_index=new_line_index,
                text=new_text,
                action=f"dd deleted line index={line_index} text={yanked!r}",
                changed=True,
                should_reload=False,
            )

        if op == "p" or op == "P":
            yank_text = payload.get("yankText", self.yank_text)
            yank_is_line = bool(payload.get("yankIsLine", self.yank_is_line))

            if not yank_text:
                return self.error_result(
                    op=op,
                    field_index=field_index,
                    line_index=line_index,
                    text=text,
                    error="empty yank",
                    action="paste failed: empty yank",
                )

            if yank_is_line:
                line_text = str(yank_text).rstrip("\n")
                new_lines = list(lines)

                if text == "" and len(new_lines) == 1 and new_lines[0] == "":
                    new_lines = [line_text]
                    new_line_index = 0
                elif op == "P":
                    insert_index = line_index
                    new_lines.insert(insert_index, line_text)
                    new_line_index = insert_index
                else:
                    insert_index = line_index + 1
                    new_lines.insert(insert_index, line_text)
                    new_line_index = insert_index

                new_text = "\n".join(new_lines)
                note.fields[field_index] = self.plain_to_html(new_text)

                self.yank_text = str(yank_text)
                self.yank_is_line = True

                return self.result(
                    ok=True,
                    op=op,
                    field_index=field_index,
                    line_index=new_line_index,
                    text=new_text,
                    action=(
                        f"{op} pasted line index={new_line_index} "
                        f"text={line_text!r}"
                    ),
                    changed=True,
                    should_reload=False,
                )

            caret = payload.get("caretOffset", None)

            try:
                caret = int(caret)
            except Exception:
                caret = self.offset_for_line_index(text, line_index)

            caret = max(0, min(caret, len(text)))

            insert_text = str(yank_text)
            new_text = text[:caret] + insert_text + text[caret:]
            new_line_index = self.line_index_from_offset(
                new_text,
                caret + len(insert_text),
            )

            note.fields[field_index] = self.plain_to_html(new_text)

            self.yank_text = insert_text
            self.yank_is_line = False

            return self.result(
                ok=True,
                op=op,
                field_index=field_index,
                line_index=new_line_index,
                text=new_text,
                action=(
                    f"{op} pasted text index={new_line_index} " f"text={insert_text!r}"
                ),
                changed=True,
                should_reload=False,
            )

        return self.error_result(
            op=op,
            field_index=field_index,
            line_index=line_index,
            text=text,
            error="unknown op",
            action=f"unknown op {op!r}",
        )
