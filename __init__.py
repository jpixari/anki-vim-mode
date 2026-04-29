from aqt import gui_hooks
from .vim_core import install_vim_mode


def on_add_cards_did_init(addcards):
    install_vim_mode(addcards)


gui_hooks.add_cards_did_init.append(on_add_cards_did_init)
