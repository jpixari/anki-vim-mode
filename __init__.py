from aqt import gui_hooks, mw
from aqt.browser import Browser
from .vim_core import install_vim_mode

# Fires for the Add Cards, Edit Current and Browser editors, so vim install_vim_mode 
# is available everywhere a note is edited (not just Add Cards).
# Can be disabled in browse to allow for entering ":" (e.g., deck:current)
def on_editor_did_init(editor):
    config = mw.addonManager.getConfig(__name__) or {}
    parent = getattr(editor, "parentWindow", None)
    if isinstance(parent, Browser) and not config.get("enable_in_browser", True):
        return

    install_vim_mode(editor)


gui_hooks.editor_did_init.append(on_editor_did_init)
