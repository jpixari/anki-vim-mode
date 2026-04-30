https://ankiweb.net/shared/info/761935116?cb=1777528328968

adds Vim keybindings to Anki’s note editor, so you can move around fields in normal mode and type normally in insert mode.

this add-on is intended for people who prefer keyboard-driven editing and want a more Vim-like workflow while creating or editing notes.

## features

- normal mode and insert mode inside Anki’s editor
- basic Vim-style movement inside editor fields
- field-to-field navigation with `J` and `K`
- a visible mode indicator showing the current editing state
- designed for fast, keyboard-heavy note editing

## Current working keybindings

### Mode switching

- `Esc` - enter normal mode
- `i` - enter insert mode
- `a` - enter insert mode after the cursor (append)
- `o` - create new line below and enter insert mode
- `v` - enter visual mode (not implemented well yet but technically works)

### movement inside a field

- `h` - move cursor left
- `j` - move cursor down
- `k` - move cursor up
- `l` - move cursor right

### moving between fields

- `J` - move to the next field
- `K` - move to the previous field

## current status

the normal/insert mode behavior is working, including basic movement, mode switching, and moving between fields.

some Vim-style operations are partially implemented but still considered incomplete. Visual mode, `d`, `dd`, `y`, and `yy` technically work, but after using them you may need to click back into the field to restore the cursor/focus. Because of that, they are not yet listed as finished features.

## in progress

- visual mode
- deleting and yanking
- more command-line commands
- better cursor/focus handling after operations
