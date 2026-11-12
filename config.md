Changes apply to editor windows opened after you press OK.

- **enable_in_browser** (`true`/`false`): use vim mode in the Browser's editor. Add Cards and Edit Current always use it.
- **insert_escape** (two letters, e.g. `"jk"` or `"jj"`): typing these quickly in insert mode returns to normal mode. Empty (`""`) turns it off.
- **insert_escape_timeout_ms**: how fast the two letters must be typed, in milliseconds.
- **jk_display_lines** (`true`/`false`): make `j`/`k` move by lines as they appear on screen (like `gj`/`gk`) instead of by real lines. Useful if your fields are long wrapped paragraphs.
- **shift_jk_fields** (`true`/`false`): `J`/`K` jump to the next/previous field. When `false`, `J` joins lines as in vim. `gJ` always joins lines.
- **show_status** (`true`/`false`): show the mode indicator at the bottom of the editor.
- **start_in_insert** (`true`/`false`): open editors in insert mode instead of normal mode.
- **system_clipboard** (`true`/`false`): yank, delete and paste use the system clipboard (like `set clipboard=unnamedplus`). The `"+` register always uses it.

Type `:help` in normal mode for the list of keys.
