# Anki Vim Mode

https://ankiweb.net/shared/info/761935116

Vim keybindings for Anki's note editor: Add Cards, Edit Current and the Browser.

Normal, insert, visual and visual-line modes, operators with motions and counts, text objects, registers, dot-repeat, search, `:s` substitution, and undo that works with Anki's own undo.

## What's new in 3.0

Version 3 is a rewrite.

- Keys that aren't vim commands are no longer typed into your card in normal mode.
- `dd`, `yy`, `p` and every other edit now happen directly in the field, so `u`, `Ctrl+Z` and Anki's undo button all restore what you deleted.
- Deleting and pasting lines keeps bold, colours, images and MathJax intact.
- `:` and `Esc` only act while you are in a note field. The Browser's search bar, the tag editor and Anki's dialogs are left alone.
- Works in both the classic editor and Anki's new editor.
- Many more commands (see below), a `:` command line and `/` search inside the editor, and a config screen.

## Keys

A count works in front of most commands: `3dd`, `2dw`, `5j`, `d3w`.

### Modes

| Key | Action |
| --- | --- |
| `Esc`, `Ctrl-[` | normal mode |
| `i` `a` `I` `A` | insert before / after cursor, at line start / end |
| `o` `O` | open a line below / above |
| `v` `V` | visual / visual-line mode |
| `gv` | reselect the last visual area |

### Moving

| Key | Action |
| --- | --- |
| `h` `j` `k` `l` | left, down, up, right |
| `w` `b` `e` `ge` | word forward / back / end / previous end (`W` `B` `E` `gE` for WORDS) |
| `0` `^` `$` `g_` | line start, first non-blank, line end, last non-blank |
| `gg` `G` `{n}G` | first line, last line, line n |
| `f` `F` `t` `T` + char | find a character on the line; `;` `,` repeat |
| `{` `}` | previous / next blank line |
| `%` | matching bracket |
| `gj` `gk` | down / up by screen line in wrapped text |
| `J` `K` | next / previous field |

### Editing

| Key | Action |
| --- | --- |
| `d` `c` `y` + motion | delete, change, yank (`dw`, `c$`, `yiw`, `dG` ...) |
| `dd` `cc` `yy` | whole lines |
| `x` `X` `s` `S` `D` `C` `Y` | the usual shortcuts |
| `p` `P` | paste after / before |
| `r` + char | replace a character |
| `~` `gu` `gU` `g~` | change case |
| `gJ` | join lines |
| `.` | repeat the last change |
| `u` `Ctrl-r` | undo / redo |
| `"a` ... `"z` | named registers; `"+` is the system clipboard, `"_` discards |

### Text objects

Use after `d` `c` `y` or in visual mode, with `i` (inner) or `a` (around).

| Key | Object |
| --- | --- |
| `w` `W` | word |
| `"` `'` `` ` `` | quoted text |
| `(` `[` `{` `<` (also `b`, `B`) | brackets |
| `p` | paragraph |
| `c` | cloze deletion: `cic` changes the answer inside `{{c1::answer::hint}}`, `dac` removes the whole cloze |

### Search and commands

| Key | Action |
| --- | --- |
| `/text` `?text` | search forward / backward (regular expressions, smart case) |
| `n` `N` `*` `#` | next, previous, word under cursor |
| `:s/old/new/g` | replace on the current line |
| `:%s/old/new/g` | replace in the whole field (`\1` and `&` work) |
| `:w` | add the note (Add Cards) or save it |
| `:wq` `:x` `ZZ` | add / save and close |
| `:q` `ZQ` | close |
| `:{n}` | go to line n |
| `:reg` | show registers |
| `:help` | show the key list inside Anki |

## Settings

Tools > Add-ons > Anki Vim Mode > Config.

| Option | Default | Meaning |
| --- | --- | --- |
| `enable_in_browser` | `true` | use vim mode in the Browser's editor |
| `insert_escape` | `""` | two letters such as `"jk"` that leave insert mode when typed quickly |
| `insert_escape_timeout_ms` | `400` | how quickly they must be typed |
| `jk_display_lines` | `false` | `j`/`k` move by screen line, for long wrapped fields |
| `shift_jk_fields` | `true` | `J`/`K` switch fields; set `false` for vim's `J` (join lines) |
| `show_status` | `true` | show the mode indicator |
| `start_in_insert` | `false` | open editors in insert mode |
| `system_clipboard` | `false` | yank and paste use the system clipboard |

## Not implemented (yet)

Macros (`q`), marks (`m`), replace mode (`R`), visual block (`Ctrl-v`), `>` / `<` indenting, and the HTML source editor (vim mode covers the normal rich-text fields).

## Support

Issues and source: https://github.com/jpixari/anki-vim-mode

## Development

```
node tests/test_text.js                  # motions and text objects
python3 tests/run_dom_tests.py           # editor behaviour in a headless Qt WebEngine page
python3 tests/e2e/run_anki_e2e.py /tmp/x # full check inside a throwaway Anki (own data folder)
```

`vim_text.js` is pure text logic. `editor_vim.js` maps it onto Anki's fields and performs every edit through the browser's editing commands. `vim_core.py` injects the scripts and handles `Esc`, `:w`/`:q` and the clipboard.
