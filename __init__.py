from aqt import gui_hooks
from aqt.browser import Browser

from .vim_core import install_vim_mode, load_config


# Fires for the Add Cards, Edit Current and Browser editors, so vim mode is
# available everywhere a note is edited. It can be switched off for the
# Browser with the "enable_in_browser" config option.
def on_editor_did_init(editor):
    parent = getattr(editor, "parentWindow", None)

    if isinstance(parent, Browser) and not load_config().get(
        "enable_in_browser", True
    ):
        return

    install_vim_mode(editor)


gui_hooks.editor_did_init.append(on_editor_did_init)
