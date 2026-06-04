from aqt.qt import QDialog, QVBoxLayout, QLineEdit
from aqt.utils import tooltip


class VimCommandLine(QDialog):
    def __init__(self, window, controller):
        super().__init__(window)
        self.window = window
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
            self.controller.save_note()
            self.close()
            self.controller.set_mode("normal")
            return

        if command == "wq":
            self.controller.save_note()
            self.close()
            self.controller.close_window()
            return

        if command == "q":
            self.close()
            self.controller.close_window()
            return

        tooltip(f"Unknown Vim command: {command}")
