Changes apply to editor windows opened after you press OK.

- **cursor_blink** (`true`/`false`): make the cursor blink.
- **cursor_color** (`"auto"`, a CSS colour such as `"#da8548"`, or `"text"`): colour of the cursor, the same in every mode. `"auto"` is a blue chosen to suit a light or a dark field; `"text"` uses the text colour, like reverse video in a terminal.
- **cursor_min_width** (number, in em; `0` = off): fields use a proportional font, so the cursor is as narrow as the letter under it (thin on `i` or `l`). A value such as `0.55` gives it at least that width, at the cost of overlapping the neighbouring letters a little.
- **enable_in_browser** (`true`/`false`): use vim mode in the Browser's editor. Add Cards and Edit Current always use it.
- **insert_escape** (two letters, e.g. `"jk"` or `"jj"`): typing these quickly in insert mode returns to normal mode. Empty (`""`) turns it off.
- **insert_escape_timeout_ms**: how fast the two letters must be typed, in milliseconds.
- **jk_display_lines** (`true`/`false`): make `j`/`k` move by lines as they appear on screen (like `gj`/`gk`) instead of by real lines. Useful if your fields are long wrapped paragraphs.
- **shift_jk_fields** (`true`/`false`): `J`/`K` jump to the next/previous field. When `false`, `J` joins lines as in vim. `gJ` always joins lines.
- **show_status** (`true`/`false`): show the mode indicator at the bottom of the editor.
- **status_position** (`"bottom-left"`, `"bottom-right"`, `"top-left"`, `"top-right"`): which corner the mode badge sits in.
- **start_in_insert** (`true`/`false`): open editors in insert mode instead of normal mode.
- **system_clipboard** (`true`/`false`): yank, delete and paste use the system clipboard (like `set clipboard=unnamedplus`). The `"+` register always uses it.
- **vim_ctrl_keys** (`true`/`false`): give more Ctrl keys their vim meaning instead of Anki's. Normal mode: `Ctrl-v` visual block (instead of paste), `Ctrl-a`/`Ctrl-x` add/subtract from a number (instead of select all/cut), `Ctrl-d`/`Ctrl-u`/`Ctrl-f`/`Ctrl-b` move by half/full pages, `Ctrl-o`/`Ctrl-i` jump back/forward. Insert mode: `Ctrl-w` delete word, `Ctrl-u` delete to line start (instead of underline), `Ctrl-h` backspace, `Ctrl-r` + register to paste it. `Ctrl-r` (redo) and `Ctrl-q` (visual block) always work.

The cursor's shapes follow Doom Emacs: a box in normal mode, a hollow box in visual mode, a half-height block after an operator such as `d` or `c`, and an underline after `r` and in replace mode. Insert mode keeps the usual thin caret. The cursor is hidden while the editor window is not focused.

Type `:help` in normal mode for the list of keys.
