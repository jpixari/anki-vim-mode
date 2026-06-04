from aqt import gui_hooks
from .vim_core import install_vim_mode


def on_editor_did_init(editor):
    # Fires for the Add Cards, Edit Current and Browser editors, so vim mode
    # is available everywhere a note is edited (not just Add Cards).
    install_vim_mode(editor)


gui_hooks.editor_did_init.append(on_editor_did_init)
