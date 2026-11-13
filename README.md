# Anki Vim Mode

https://ankiweb.net/shared/info/761935116

Vim keybindings for Anki's note editor: Add Cards, Edit Current and the Browser.

Normal, insert, replace, visual, visual-line and visual-block modes, operators with motions and counts, text objects, registers, macros, marks, dot-repeat, search, `:s` substitution, and undo that works with Anki's own undo.

Its behaviour is checked against real Vim: the test-suite runs the same keystrokes on the same text in Vim and in the add-on and compares the resulting text and cursor position.

## What's new in 3.0

Version 3 is a rewrite.

- Keys that aren't vim commands are no longer typed into your card in normal mode.
- `dd`, `yy`, `p` and every other edit now happen directly in the field, so `u`, `Ctrl+Z` and Anki's undo button all restore what you deleted.
- Deleting and pasting lines keeps bold, colours, images and MathJax intact.
- `:` and `Esc` only act while you are in a note field. The Browser's search bar, the tag editor and Anki's dialogs are left alone.
- Works in both the classic editor and Anki's new editor.
- Many more commands (see below), a `:` command line and `/` search inside the editor, and a config screen.
- A small round mode badge in the corner (green N, blue I, yellow V, red R) replaces the old pill.

## Keys

A count works in front of most commands: `3dd`, `2dw`, `5j`, `d3w`.

### Modes

| Key | Action |
| --- | --- |
| `Esc`, `Ctrl-[` | normal mode |
| `i` `a` `I` `A` | insert before / after cursor, at line start / end |
| `o` `O` | open a line below / above |
| `gi` | insert where you last left insert mode |
| `R` | replace mode: typing overwrites, Backspace restores |
| `v` `V` `Ctrl-q` | visual / visual-line / visual-block mode |
| `gv` | reselect the last visual area |

### Moving

| Key | Action |
| --- | --- |
| `h` `j` `k` `l` | left, down, up, right |
| `w` `b` `e` `ge` | word forward / back / end / previous end (`W` `B` `E` `gE` for WORDS) |
| `0` `^` `$` `g_` | line start, first non-blank, line end, last non-blank |
| `gg` `G` `{n}G` | first line, last line, line n |
| `H` `M` `L` | first, middle, last line of the field |
| `f` `F` `t` `T` + char | find a character on the line; `;` `,` repeat |
| `{` `}` | previous / next blank line |
| `(` `)` | previous / next sentence |
| `m` + letter | set a mark; `` ` `` + letter jumps to it, `'` + letter to its line |
| ` `` ` | back to where you were before the last jump |
| `%` | matching bracket |
| `gj` `gk` | down / up by screen line in wrapped text |
| `J` `K` | next / previous field |

### Editing

| Key | Action |
| --- | --- |
| `d` `c` `y` + motion | delete, change, yank (`dw`, `c$`, `yiw`, `dG` ...) |
| `dd` `cc` `yy` | whole lines |
| `x` `X` `s` `S` `D` `C` `Y` | the usual shortcuts |
| `p` `P` `gp` `gP` | paste after / before (`g`: leave the cursor after the text) |
| `>` `<` + motion, `>>` `<<` | indent / outdent (nests list items) |
| `gc` `gC` + motion | wrap in a cloze deletion with a new / the same number (`gciw`, `gcc`, or select and `gc`) |
| `q` + letter ... `q` | record a macro; `@` + letter plays it, `@@` repeats |
| `r` + char | replace a character |
| `~` `gu` `gU` `g~` | change case |
| `gJ` | join lines (like vim's `J`; with `shift_jk_fields` off, `J` does that and `gJ` joins without a space) |
| `.` | repeat the last change |
| `u` `Ctrl-r` | undo / redo |
| `"a` ... `"z` | named registers; `"+` is the system clipboard, `"_` discards, `"0` last yank, `"1`-`"9` deleted lines |

### Text objects

Use after `d` `c` `y` or in visual mode, with `i` (inner) or `a` (around).

| Key | Object |
| --- | --- |
| `w` `W` | word |
| `"` `'` `` ` `` | quoted text |
| `(` `[` `{` `<` (also `b`, `B`) | brackets |
| `p` `s` | paragraph, sentence |
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
| `&` `g&` | repeat the last substitution on this line / every line |
| `:m {n}` `:t {n}` | move / copy the current line (or a range) below line n |
| `:normal {keys}` | run normal-mode keys on each line of a range, e.g. `:%normal A.` |
| `:{n}` | go to line n |
| `:reg` `:marks` | show registers / marks |
| `:help` | show the key list inside Anki |

### Visual block

`Ctrl-q` starts a block (a column across several lines). `I` and `A` type the same text on every line, `c` changes the block, `d` `y` `p` `r` `~` `u` `U` work on it, `$` extends it to each line's end.

### Anki's own shortcuts

Anything with Ctrl that vim mode doesn't use goes to Anki as usual: Ctrl+Enter adds the note, Ctrl+B makes text bold. In visual mode those shortcuts act on the selection, so `viw` then Ctrl+B bolds a word.

## Settings

Tools > Add-ons > Anki Vim Mode > Config.

| Option | Default | Meaning |
| --- | --- | --- |
| `cursor_blink` | `false` | blink the cursor |
| `cursor_color` | `"text"` | cursor colour, the same in every mode: `"text"` (the field's text colour, like reverse video), `"auto"` (a blue that suits a light or dark field) or a CSS colour |
| `cursor_min_width` | `0` | minimum cursor width in em (e.g. `0.55`) so it is not a sliver on `i` or `l`; `0` = as wide as the letter |
| `enable_in_browser` | `true` | use vim mode in the Browser's editor |
| `insert_escape` | `""` | two letters such as `"jk"` that leave insert mode when typed quickly |
| `insert_escape_timeout_ms` | `400` | how quickly they must be typed |
| `jk_display_lines` | `false` | `j`/`k` move by screen line, for long wrapped fields |
| `shift_jk_fields` | `true` | `J`/`K` switch fields; set `false` for vim's `J` (join lines) |
| `show_status` | `true` | show the mode indicator |
| `start_in_insert` | `false` | open editors in insert mode |
| `status_position` | `"bottom-left"` | corner for the mode badge |
| `vim_ctrl_keys` | `false` | vim meanings for more Ctrl keys (`Ctrl-v` block, `Ctrl-a`/`Ctrl-x`, `Ctrl-d`/`Ctrl-u`, `Ctrl-o`/`Ctrl-i`, insert-mode `Ctrl-w`/`Ctrl-u`/`Ctrl-r`) instead of Anki's |
| `system_clipboard` | `false` | yank and paste use the system clipboard |

### Cursor

The cursor's shapes follow Doom Emacs: a box in normal mode, a hollow box in visual mode, a half-height block while an operator (`d`, `c`, `y`, ...) waits for its motion, and an underline after `r` and in replace mode. Insert mode keeps the usual thin caret. The cursor takes the field's text colour, like reverse video in a terminal (`cursor_color` changes it), and is hidden while the editor window is not focused.

## Not implemented (yet)

The HTML source editor (vim mode covers the normal rich-text fields), folds, windows/tabs, `:g`, and vim's own regex dialect (`/` and `:s` use JavaScript regular expressions).

### Known differences from Vim

The add-on is checked against real Vim with thousands of generated key sequences (`tests/compare_with_vim.py`). What still differs:

- Sentence motions and objects (`(` `)` `is` `as`) around blank lines and with counts.
- An operator combined with a motion that cannot move, e.g. `g~h` in the first column, where Vim's result is a quirk.
- `.` after a visual-mode command, and the cursor column after redoing a whole-line delete.
- `` ` ` `` / `''` only remember jumps made with the jump motions.
- A yanked visual block is not padded with spaces on short lines.

## Support

Issues and source: https://github.com/jpixari/anki-vim-mode

## Development

```
node tests/test_text.js                  # motions and text objects
python3 tests/run_dom_tests.py           # editor behaviour in a headless Qt WebEngine page
python3 tests/compare_with_vim.py        # same keys in real Vim and in the add-on, results compared
python3 tests/e2e/run_anki_e2e.py /tmp/x # full check inside a throwaway Anki (own data folder)
./build.sh                               # builds anki_vim_mode.ankiaddon
```

Pushing a tag such as `v3.0.0` makes GitHub build the `.ankiaddon` and attach it to a release.

`vim_text.js` is pure text logic. `editor_vim.js` maps it onto Anki's fields and performs every edit through the browser's editing commands. `vim_core.py` injects the scripts and handles `Esc`, `:w`/`:q` and the clipboard.
