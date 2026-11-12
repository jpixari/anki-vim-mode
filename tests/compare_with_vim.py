#!/usr/bin/env python3
"""Differential test: the same keys on the same text in real Vim and in the
add-on, then compare the resulting text and cursor position.

Vim runs headless (`vim -u NONE -es`), the add-on runs in the same headless
Qt WebEngine page as tests/run_dom_tests.py.

Usage: python3 tests/compare_with_vim.py [-v] [filter-substring]
"""

import html
import json
import os
import subprocess
import sys
import tempfile

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS", "--no-sandbox --disable-gpu"
)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run_dom_tests as harness  # noqa: E402

A = ["one two three", "four five six", "seven eight nine"]
B = ["  indented line", "", "foo(bar, baz) qux", "a.b.c d-e-f"]
C = ["alpha", "beta", "gamma", "delta", "epsilon"]
D = ['say "hello world" now', "x = [1, 2, 3]", "{a: (b)}"]
E = ["Hello there. How are you? Fine!", "", "New para here."]
N = ["x 7 y 10", "val -3 end", "plain"]
S = ["only"]
Z = [""]

# (name of text, keys). Keys use Vim notation: <Esc> <CR> <BS> <C-r> <lt>.
CASES = {
    "motions": (A, """
        l|3l|$|0|w|2w|3w|e|2e|b|wwb|$b|W|E|B|ge|wge|j|jj|jk|2j|G|Ggg|2G|$j|$jj|
        fe|fe;|fe;,|te|te;|$Fe|$Te|$Fo;|0fz|3fe|wwwww|eeeee|$bbbbb|G$|jw|j$w|
        +|j-|2+|G_|g_|$h|3|wh|jl|5l|gg$k|jj0k|llj|llljk
    """),
    "motions-punct": (B, """
        w|ww|www|e|ee|^|$|0w|j|jj|jjw|jjww|jje|jj%|jjf(%|jj$%|3Gf(l%|
        GW|Gw|Gww|Gwww|Ge|GE|G$b|G$B|G$ge|}|}}|G{|G{{|jj}|k|jjj$|Gfdb|
        3GfblyiwGp|GtdD
    """),
    "delete": (A, """
        x|3x|$x|X|lX|$X|dw|d2w|2dw|dd|2dd|jdd|Gdd|ddp|ddP|D|wD|d$|d0|wd0|
        dj|jdk|dG|jdgg|de|dE|db|wdb|$db|dfe|dte|fed;|wdge|d3l|d2h|$d2h|
        wwdw|wwwdw|jwwdw|dl|dh|ldh|x.|dw.|dd.|x3.|dw2.|xu|ddu|dwdwuu|
        d}|jd{|wd^|dvw|ddjdd|Gddk|dwwP|dwp
    """),
    "change": (A, """
        cwX<Esc>|cwX<Esc>w.|ceX<Esc>|ccX<Esc>|CX<Esc>|wCX<Esc>|sX<Esc>|SX<Esc>|
        c$X<Esc>|c0X<Esc>|wc0X<Esc>|cbX<Esc>|wcbX<Esc>|c2wX<Esc>|2cwX<Esc>|
        cjX<Esc>|jckX<Esc>|ciwX<Esc>|lciwX<Esc>|cawX<Esc>|wcawX<Esc>|
        cfeX<Esc>|cteX<Esc>|rX|3rX|lrX|$rX|~|3~|$~|w~|g~w|gUw|guw|gUU|guu|g~~|
        gUiw|wgUe|jgUjk|RXY<Esc>|wRXYZ<Esc>|$RXY<Esc>|Rab<BS><BS>c<Esc>
    """),
    "insert": (A, """
        iX<Esc>|aX<Esc>|IX<Esc>|AX<Esc>|oX<Esc>|OX<Esc>|joX<Esc>|GoX<Esc>|
        GOX<Esc>|wiX<Esc>|$aX<Esc>|$iX<Esc>|3iX<Esc>|2aab<Esc>|iX<Esc>.|
        AX<Esc>j.|oX<Esc>.|iab<CR>cd<Esc>|A<CR><Esc>|wi<CR><Esc>|
        ia<Esc>u|oX<Esc>u|iX<Esc>l.l.|3AX<Esc>|ix<BS>y<Esc>
    """),
    "yank-paste": (A, """
        yyp|yyP|yyjp|yy2p|yy3P|ywP|ywp|yw$p|yiwwviwp|yyGp|jyykP|y$P|wy$P|
        ylp|yl3p|yjP|yjGp|jykp|ddjp|dwwP|xp|xP|yegp|yegP|yygp|yygP|jyygp|"ayw"bye"ap"bp|
        "ayyj"Ayy"ap|yyjdd"0p|ddjdd"1p"2p|dw"-p|Yp|yawP|ye$p|"_ddp|yyp.|
        vey$p|Vjyp|VyGp|vjyP
    """),
    "objects": (D, """
        di"|da"|ci"X<Esc>|wdi"|$di"|wwyi"P|jdi[|jda[|jci[X<Esc>|jf1di]|
        Gdi{|Gda{|Gdi(|Gda(|Gfbdi(|Gfbdab|GdiB|Gf(di{|diw|daw|wdaw|$daw|
        wwdiw|diW|jdiW|jwdaW|wwwvi"d|jf2vi[U|Gf(va(d|jvawd|dip|jdap|
        wyiwP|f"di"|f"da"|jf[di[|jf]di[
    """),
    "visual": (A, """
        vd|vld|vlld|v$d|vjd|vjjd|vwd|ved|v2ed|vbd|wvbd|vy|vlyP|vjy|Vd|Vjd|
        VGd|jVkd|Vy|VyP|vlc X<Esc>|vecX<Esc>|VcX<Esc>|vlU|veu|v~|vjU|VU|Vu|
        vlrX|vjrX|VrX|vlod|wvlohd|vjJ|VjJ|VjjJ|viwd|vawd|vlvd|vVd|Vvd|
        vl<Esc>x|vjy|v$y|wvey$p|vex|vlD|vlX|vlY|vlS X<Esc>|vlRX<Esc>|
        vjc X<Esc>|ve<Esc>gvd|Vj<Esc>jgvd
    """),
    "block": (C, """
        <C-q>jd|<C-q>jld|<C-q>jjlld|l<C-q>jjd|<C-q>jjIX<Esc>|l<C-q>jjIX<Esc>|
        <C-q>jj$AX<Esc>|<C-q>jjlAX<Esc>|<C-q>jjlcX<Esc>|<C-q>jlrX|<C-q>jlU|
        <C-q>jl~|<C-q>jjyP|<C-q>jlyp|l<C-q>jly$p|<C-q>jjy|<C-q>jlod|
        ll<C-q>jjhd|<C-q>jj$d|<C-q>jjD|<C-q>GIX <Esc>|<C-q>jlyGp|<C-q>jlxp|
        <C-q>jIX<Esc>u|<C-q>jlvd|<C-q>jVd|v<C-q>jd|<C-q>jlJ|<C-q>jjlsX<Esc>
    """),
    "join-misc": (B, """
        J|JJ|3J|jJ|jjJ|gJ|GkJ|J.|Ju|jjJx|ggJJJ|jddJ|xJ
    """),
    "search": (A, """
        /five<CR>|/e<CR>|/e<CR>n|/e<CR>nn|/e<CR>N|?e<CR>|?e<CR>n|/zzz<CR>|
        *|w*|*n|#|/six<CR>x|d/five<CR>|/t<CR>nnnnnn|G?one<CR>|/one<CR>|
        wwd/six<CR>|/five<CR>dn|c/two<CR>X<Esc>|d/two<CR>.|wd?one<CR>|y/five<CR>P|/ei<CR>``|G''|jmajj`a|
        jmagg'a|wmajd`a|jmaGd'a|/e<CR>/<CR>
    """),
    "ex": (C, """
        :2<CR>|:$<CR>|:1,2d<CR>|:2d<CR>|:%d<CR>|:2,4y<CR>P|:3<CR>dd|
        :s/a/X/<CR>|:s/a/X/g<CR>|:%s/a/X/<CR>|:%s/a/X/g<CR>|:2,3s/a/X/g<CR>|
        :%s/a//g<CR>|:s/alpha/b&b/<CR>|:%s/l/L/g<CR>u|:2t0<CR>|:1t$<CR>|
        :1m$<CR>|:3m0<CR>|:2,3m$<CR>|:4,5m1<CR>|:1,2t3<CR>|:%norm Ax<CR>|
        :2,3norm I- <CR>|:%norm dw<CR>|:s/a/X/<CR>j&|:s/a/X/<CR>g&|
        Vj:s/a/X/g<CR>|:2,3norm x<CR>|:1,3norm A!<CR>
    """),
    "sentences": (E, """
        )|))|)))|$(|$((|G(|das|)das|dis|)cisX<Esc>|vasd|)yisP|d)|)d(|))d)
    """),
    "numbers": (N, """
        <C-a>|<C-x>|5<C-a>|3<C-a>|$<C-a>|j<C-a>|j<C-x>|j5<C-a>|jj<C-a>|
        <C-a>.|<C-a>w<C-a>|10<C-x>
    """),
    "macros": (C, """
        qaA!<Esc>jq@a|qaA!<Esc>jq@a@@|qaA!<Esc>jq3@a|qaxq@a|qaddq2@a|
        qaIx<Esc>jq@a@a@a|qa0cwX<Esc>jq@a|qaylpq3@a|qaJq@a|
        qaA!<Esc>jq@au|qqxq@qu
    """),
    "single-line": (S, """
        dd|x|D|cc X<Esc>|yyp|yyP|o<Esc>|O<Esc>|J|dw|daw|diw|ddp|ddu|dj|dk|
        ~|g~~|$x|$xx|4x|rX|dip|vd|Vd|xu|i<CR><Esc>|A<CR>x<Esc>|ddiX<Esc>
    """),
    "empty": (Z, """
        dd|x|iX<Esc>|aX<Esc>|oX<Esc>|OX<Esc>|ddp|yyp|J|dw|p|AX<Esc>dd|
        iab<Esc>dd|ia<CR>b<Esc>|o<Esc>dd|3iX<Esc>|cc<Esc>|
    """),
}

VIM_SETTINGS = (
    "set nocompatible noautoindent nojoinspaces ignorecase smartcase "
    "whichwrap= nrformats= clipboard= nowrapscan noshowmode "
    "backspace=indent,eol,start noundofile noswapfile shortmess+=s"
)


def vim_string(keys):
    """Vim-notation keys -> a double-quoted Vimscript string body."""
    out = keys.replace("\\", "\\\\").replace('"', '\\"')
    out = out.replace("<", "\\<")
    return out.replace("\\<lt>", "\\<lt>")


def run_vim(cases):
    with tempfile.TemporaryDirectory() as tmp:
        script = [VIM_SETTINGS, "set wrapscan", "let g:out = []"]

        for lines, keys in cases:
            script += [
                "enew!",
                "let @/ = ''",
                "call setline(1, %s)" % json.dumps(lines),
                "call cursor(1, 1)",
                "for r in split('abcdefghijklmnopqrstuvwxyz0123456789-', '\\zs')"
                " | call setreg(r, '') | endfor",
                "call setreg('\"', '')",
                "delmarks! | delmarks A-Z",
                "try",
                '  call feedkeys("%s", "tx")' % vim_string(keys),
                "catch",
                "endtry",
                'call feedkeys("\\<Esc>", "tx")',
                "call add(g:out, json_encode({'lines': getline(1, '$'),"
                " 'row': line('.'), 'col': col('.')}))",
            ]

        out = os.path.join(tmp, "out.json")
        script += ["call writefile(g:out, %s)" % json.dumps(out), "qa!"]
        path = os.path.join(tmp, "cases.vim")

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(script) + "\n")

        subprocess.run(
            ["vim", "-u", "NONE", "-i", "NONE", "-N", "-n", "-es",
             "--not-a-term", "-S", path],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )

        with open(out, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]


def field_line(line):
    """One line of plain text as field HTML. HTML collapses runs of spaces
    and drops leading ones, so those are written as non-breaking spaces - the
    same thing the editor does when you type them."""
    out = []

    for i, ch in enumerate(line):
        if ch == " " and (i == 0 or line[i - 1] == " " or i == len(line) - 1):
            out.append("&nbsp;")
        else:
            out.append(html.escape(ch, quote=False))

    return "".join(out)


def run_addon(cases):
    from PyQt6.QtCore import QTimer, QUrl
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWidgets import QApplication

    payload = []

    for lines, keys in cases:
        field = "<br>".join(field_line(line) for line in lines)

        if len(lines) > 1 and lines[-1] == "":
            field += "<br>"

        payload.append({"html": field, "keys": keys})

    app = QApplication(sys.argv[:1])
    view = QWebEngineView()
    page = harness.Page(view)
    view.setPage(page)
    view.resize(900, 700)
    view.show()
    view.setFocus()
    result = {}

    def finish(raw):
        result["raw"] = raw
        app.quit()

    def loaded(ok):
        page.runJavaScript(
            "\n;\n".join(
                [
                    harness.read("vim_text.js"),
                    harness.read("editor_vim.js"),
                    "window.__vimCases = %s;" % json.dumps(payload),
                    harness.read(os.path.join("tests", "dom_tests.js")),
                ]
            ),
            finish,
        )

    page.loadFinished.connect(loaded)
    page.setHtml(harness.PAGE, QUrl("http://localhost/"))
    QTimer.singleShot(120000, app.quit)
    app.exec()
    return json.loads(result["raw"])


def main():
    args = [a for a in sys.argv[1:] if a != "-v"]
    verbose = "-v" in sys.argv[1:]
    only = args[0] if args else ""
    cases = []
    labels = []

    for group, (lines, keys_block) in CASES.items():
        if only and only not in group:
            continue

        for keys in keys_block.replace("\n", "").split("|"):
            keys = keys.strip(" ") if keys.strip() else ""

            # Keys such as "vlc X<Esc>" contain meaningful inner spaces;
            # only the indentation around a case is dropped.
            if keys:
                cases.append((lines, keys))
                labels.append(group)

    vim = run_vim(cases)
    addon = run_addon(cases)
    bad = 0

    for label, (lines, keys), v, a in zip(labels, cases, vim, addon):
        if "error" in a:
            print(f"ERROR [{label}] {keys!r}: {a['error']}")
            bad += 1
            continue

        text = a["text"]
        before = text[: a["pos"]]
        got = {
            "lines": text.split("\n"),
            "row": before.count("\n") + 1,
            "col": len(before) - (before.rfind("\n") + 1) + 1,
        }

        if got != v:
            bad += 1
            print(f"DIFF [{label}] keys={keys!r} on {lines!r}")
            print(f"      vim  : {v['lines']!r} cursor {v['row']},{v['col']}")
            print(f"      addon: {got['lines']!r} cursor {got['row']},{got['col']}")
        elif verbose:
            print(f"ok   [{label}] {keys!r}")

    print(f"vim comparison: {len(cases) - bad} identical, {bad} different")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
