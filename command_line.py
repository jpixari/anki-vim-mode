from aqt.qt import QDialog, QVBoxLayout, QLineEdit
from aqt.utils import tooltip


class VimCommandLine(QDialog):
    def __init__(self, addcards, controller):
        super().__init__(addcards)
        self.addcards = addcards
        self.controller = controller

        self.setWindowTitle("Vim Command")
        self.setModal(False)

        layout = QVBoxLayout()
        self.input = QLineEdit()
        self.input.setPlaceholderText(":w, :wq, :q")
        layout.addWidget(self.input)
        self.setLayout(layout)

        self.input.returnPressed.connect(self.run_command)

    def open(self):
        self.input.clear()
        self.input.setText(":")
        self.show()
        self.input.setFocus()

    def run_command(self):
        command = self.input.text().strip()

        if command.startswith(":"):
            command = command[1:]

        if command == "w":
            self.write_card()
            self.close()
            self.controller.set_mode("normal")
            return

        if command == "wq":
            self.write_card()
            self.close()
            self.addcards.close()
            return

        if command == "q":
            self.close()
            self.addcards.close()
            return

        tooltip(f"Unknown Vim command: {command}")

    def write_card(self):
        try:
            self.addcards.addCards()
            tooltip("Card added")
        except Exception as error:
            tooltip(f"Could not add card: {error}")
