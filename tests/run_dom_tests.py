#!/usr/bin/env python3
"""Run the editor tests in a headless Qt WebEngine page.

This is the same browser engine Anki's editor runs in. The page mimics the
structure of Anki's fields (a `.rich-text-editable` host with an open shadow
root containing an `<anki-editable>`), loads the add-on's scripts and then
drives them with synthetic key events.

Usage: python3 tests/run_dom_tests.py [filter-substring]
"""

import json
import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu"
)

from PyQt6.QtCore import QTimer, QUrl  # noqa: E402
from PyQt6.QtWebEngineCore import QWebEnginePage  # noqa: E402
from PyQt6.QtWebEngineWidgets import QWebEngineView  # noqa: E402
from PyQt6.QtWidgets import QApplication  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PAGE = """<!doctype html>
<html><head><meta charset="utf-8">
<style>body { font: 16px sans-serif; margin: 8px; }
.rich-text-editable { display: block; border: 1px solid #888; margin: 6px 0; }
</style></head>
<body>
<input id="other" value="not a field">
<div class="rich-text-editable"></div>
<div class="rich-text-editable"></div>
<div class="rich-text-editable"></div>
<script>
window.__cmds = [];
window.pycmd = function (m) { window.__cmds.push(m); };
for (const host of document.querySelectorAll(".rich-text-editable")) {
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
        "<style>anki-editable { display: block; min-height: 1.3em; " +
        "padding: 4px; outline: none; width: 300px; }</style>" +
        '<anki-editable contenteditable="true"></anki-editable>';
}
</script>
</body></html>
"""


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


class Page(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source):
        print(f"  [console] {message} (line {line})")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    app = QApplication(sys.argv[:1])
    view = QWebEngineView()
    page = Page(view)
    view.setPage(page)
    view.resize(900, 700)
    view.show()
    view.setFocus()

    exit_code = {"value": 1}

    def finish(raw):
        try:
            results = json.loads(raw) if raw else None
        except Exception:
            results = None

        if not results:
            print("no results returned from the page:", raw)
            app.quit()
            return

        failed = [r for r in results if not r["ok"]]

        for r in failed:
            print("FAIL", r["name"])

            for line in r["errors"]:
                print("     ", line)

        print(
            f"dom tests: {len(results) - len(failed)} passed, "
            f"{len(failed)} failed"
        )
        exit_code["value"] = 1 if failed else 0
        app.quit()

    def loaded(ok):
        script = "\n;\n".join(
            [
                read("vim_text.js"),
                read("editor_vim.js"),
                "window.__only = " + json.dumps(only) + ";",
                read(os.path.join("tests", "dom_tests.js")),
            ]
        )
        page.runJavaScript(script, finish)

    page.loadFinished.connect(loaded)
    page.setHtml(PAGE, QUrl("http://localhost/"))
    QTimer.singleShot(60000, app.quit)
    app.exec()
    sys.exit(exit_code["value"])


if __name__ == "__main__":
    main()
