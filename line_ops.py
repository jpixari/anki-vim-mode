# line_ops.py

import html
import re


class VimLineOps:
    # If a field contains any block-level tag we cannot safely treat <br> as
    # the only line separator, so we fall back to a plain-text rewrite (which
    # loses inline formatting but stays correct).
    BLOCK_RE = re.compile(
        r"(?i)<\s*/?\s*"
        r"(div|p|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|"
        r"section|article|header|footer|h[1-6])\b"
    )
    BR_RE = re.compile(r"(?i)<\s*br\s*/?\s*>")
    TAG_RE = re.compile(r"<\s*(/?)\s*([a-zA-Z0-9]+)([^>]*)>")
    VOID_TAGS = {
        "br",
        "img",
        "hr",
        "input",
        "meta",
        "link",
        "col",
        "area",
        "base",
        "embed",
        "source",
        "track",
        "wbr",
    }

    def __init__(self):
        self.yank_text = ""
        self.yank_is_line = False
        # HTML of the most recently yanked/deleted line, used to paste a line
        # back with its original inline formatting.
        self.yank_html = None

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

    def escape_inline(self, line_text):
        # A single plain line never contains a newline, so escaping is enough.
        return html.escape(str(line_text), quote=False)

    def is_html_balanced(self, segment):
        """
        True when every non-void tag in `segment` is opened and closed within
        the segment. This stops us from splitting a field in the middle of an
        inline tag (e.g. "<b>a<br>b</b>"), which would produce broken HTML.
        """
        stack = []

        for match in self.TAG_RE.finditer(segment):
            closing = match.group(1) == "/"
            name = match.group(2).lower()
            attrs = match.group(3) or ""

            if name in self.VOID_TAGS:
                continue

            if not closing and attrs.rstrip().endswith("/"):
                continue

            if closing:
                if not stack or stack[-1] != name:
                    return False

                stack.pop()
            else:
                stack.append(name)

        return not stack

    def split_html_lines(self, html_value, plain_line_count):
        """
        Best-effort split of field HTML into per-line HTML segments that map
        1:1 onto html_to_plain() lines, preserving inline formatting.

        Returns the list of segments, or None when the HTML is too complex to
        split safely (block tags, formatting spanning a <br>, or a line-count
        mismatch). Callers fall back to the plain-text path when this is None.
        """
        source = "" if html_value is None else str(html_value)

        if self.BLOCK_RE.search(source):
            return None

        segments = self.BR_RE.split(source)

        if len(segments) != plain_line_count:
            return None

        if self.html_to_plain("<br>".join(segments)) != self.html_to_plain(
            source
        ):
            return None

        for segment in segments:
            if "\n" in self.html_to_plain(segment):
                return None

            if not self.is_html_balanced(segment):
                return None

        return segments

    def resolve_line_html(self, line_text):
        # Reuse the stored HTML segment when it faithfully represents the plain
        # line being pasted; otherwise fall back to escaped plain text.
        if self.yank_html is not None:
            plain = self.html_to_plain(self.yank_html).rstrip("\n")

            if plain == str(line_text).rstrip("\n"):
                return self.yank_html

        return self.escape_inline(line_text)

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
            return 0

        if line_index >= line_count:
            return line_count - 1

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
        """
        Linewise commands use the JS-side Vim line tracker.

        Priority:
        1. vimLineIndex: current normal-mode tracked line
        2. currentLineIndex: compatibility with older JS
        3. lineIndexHint: compatibility with older JS
        4. caretOffset: fallback only
        """
        lines = self.text_lines_keep_empty(text)

        for key in ["vimLineIndex", "currentLineIndex", "lineIndexHint"]:
            value = payload.get(key, None)

            if value is not None:
                return self.clamp_line_index(value, len(lines))

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

    def make_result(
        self,
        ok,
        op,
        field_index,
        line_index,
        text,
        action,
        changed=False,
        error=None,
    ):
        lines = self.text_lines_keep_empty(text)
        safe_line = self.clamp_line_index(line_index, len(lines))
        caret = self.offset_for_line_index(text, safe_line)

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
        }

        if error:
            data["error"] = error

        return data, changed

    def error_result(self, op, field_index, line_index, text, error):
        if text is None:
            text = ""

        return self.make_result(
            ok=False,
            op=op,
            field_index=field_index,
            line_index=line_index,
            text=text,
            action=error,
            changed=False,
            error=error,
        )

    def payload_yank(self, payload):
        """
        Prefer JS yank state when present, but fall back to Python yank state.
        This avoids losing the yank after editor reload/reinjection.
        """
        payload_text = payload.get("yankText", None)

        if payload_text is None or payload_text == "":
            yank_text = self.yank_text
            yank_is_line = self.yank_is_line
        else:
            yank_text = str(payload_text)

            if "yankIsLine" in payload:
                yank_is_line = bool(payload.get("yankIsLine"))
            else:
                yank_is_line = self.yank_is_line

        return yank_text, yank_is_line

    def process(self, note, payload, fallback_field_index=0):
        if not note:
            return (
                {
                    "ok": False,
                    "op": payload.get("op"),
                    "error": "no note",
                    "action": "no note",
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
                    "action": "bad field index",
                },
                False,
            )

        raw = note.fields[field_index]
        text = self.html_to_plain(raw)
        lines = self.text_lines_keep_empty(text)
        line_index = self.safe_line_index(text, payload)

        # Per-line HTML segments when the field can be split losslessly;
        # otherwise None and we fall back to a plain-text rewrite.
        segments = self.split_html_lines(raw, len(lines))

        if op == "yy":
            line_text = lines[line_index]

            self.yank_text = line_text + "\n"
            self.yank_is_line = True
            self.yank_html = (
                segments[line_index] if segments is not None else None
            )

            return self.make_result(
                ok=True,
                op="yy",
                field_index=field_index,
                line_index=line_index,
                text=text,
                action=f"yy yanked line index={line_index} text={line_text!r}",
                changed=False,
            )

        if op == "dd":
            deleted_line = lines[line_index]

            self.yank_text = deleted_line + "\n"
            self.yank_is_line = True
            self.yank_html = (
                segments[line_index] if segments is not None else None
            )

            if segments is not None:
                if len(segments) <= 1:
                    new_segments = [""]
                    new_line_index = 0
                else:
                    new_segments = list(segments)
                    del new_segments[line_index]
                    new_line_index = max(
                        0, min(line_index, len(new_segments) - 1)
                    )

                new_html = "<br>".join(new_segments)
                new_text = self.html_to_plain(new_html)
                note.fields[field_index] = new_html
            else:
                if len(lines) <= 1:
                    new_lines = [""]
                    new_line_index = 0
                else:
                    new_lines = list(lines)
                    del new_lines[line_index]
                    new_line_index = max(0, min(line_index, len(new_lines) - 1))

                new_text = "\n".join(new_lines)
                note.fields[field_index] = self.plain_to_html(new_text)

            return self.make_result(
                ok=True,
                op="dd",
                field_index=field_index,
                line_index=new_line_index,
                text=new_text,
                action=f"dd deleted line index={line_index} text={deleted_line!r}",
                changed=True,
            )

        if op == "p" or op == "P":
            yank_text, yank_is_line = self.payload_yank(payload)

            if not yank_text:
                return self.error_result(
                    op=op,
                    field_index=field_index,
                    line_index=line_index,
                    text=text,
                    error="paste failed: empty yank",
                )

            if yank_is_line:
                line_text = str(yank_text).rstrip("\n")

                if segments is not None:
                    seg_html = self.resolve_line_html(line_text)

                    if (
                        text == ""
                        and len(segments) == 1
                        and segments[0] == ""
                    ):
                        new_segments = [seg_html]
                        new_line_index = 0
                    elif op == "P":
                        new_segments = list(segments)
                        new_segments.insert(line_index, seg_html)
                        new_line_index = line_index
                    else:
                        new_segments = list(segments)
                        insert_index = line_index + 1
                        new_segments.insert(insert_index, seg_html)
                        new_line_index = insert_index

                    new_html = "<br>".join(new_segments)
                    new_text = self.html_to_plain(new_html)
                    note.fields[field_index] = new_html
                    self.yank_html = seg_html
                else:
                    new_lines = list(lines)

                    if (
                        text == ""
                        and len(new_lines) == 1
                        and new_lines[0] == ""
                    ):
                        new_lines = [line_text]
                        new_line_index = 0
                    elif op == "P":
                        new_lines.insert(line_index, line_text)
                        new_line_index = line_index
                    else:
                        insert_index = line_index + 1
                        new_lines.insert(insert_index, line_text)
                        new_line_index = insert_index

                    new_text = "\n".join(new_lines)
                    note.fields[field_index] = self.plain_to_html(new_text)
                    self.yank_html = None

                self.yank_text = line_text + "\n"
                self.yank_is_line = True

                return self.make_result(
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
            self.yank_html = None

            return self.make_result(
                ok=True,
                op=op,
                field_index=field_index,
                line_index=new_line_index,
                text=new_text,
                action=(
                    f"{op} pasted text index={new_line_index} " f"text={insert_text!r}"
                ),
                changed=True,
            )

        return self.error_result(
            op=op,
            field_index=field_index,
            line_index=line_index,
            text=text,
            error=f"unknown op {op!r}",
        )
