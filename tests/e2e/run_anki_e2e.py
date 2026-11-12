#!/usr/bin/env python3
"""End-to-end check inside a real, throwaway Anki.

Starts Anki invisibly (offscreen) with its own empty data folder, loads this
add-on plus a small driver add-on, exercises both of Anki's editors and prints
what happened. Your real Anki profile and collection are never touched.

Usage: python3 tests/e2e/run_anki_e2e.py <empty-or-new-work-dir>
"""

import json
import os
import shutil
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON = os.path.dirname(os.path.dirname(HERE))

CHILD = r"""
import sys
import aqt, aqt.profiles
aqt.profiles.ProfileManager.setDefaultLang = lambda self, idx: self.setLang("en_US")
aqt.profiles.ProfileManager.check_for_updates = lambda self: False
aqt.profiles.ProfileManager.check_for_addon_updates = lambda self: False
sys.argv = ["anki", "-b", sys.argv[1]]
aqt.run()
"""


def main():
    work = os.path.abspath(sys.argv[1])
    base = os.path.join(work, "base")
    out = os.path.join(work, "result.json")

    shutil.rmtree(base, ignore_errors=True)
    addons = os.path.join(base, "addons21")
    os.makedirs(addons)
    os.symlink(ADDON, os.path.join(addons, "anki_vim_mode"))
    driver = os.path.join(addons, "zz_e2e_driver")
    os.makedirs(driver)
    shutil.copy(os.path.join(HERE, "driver_addon.py"), os.path.join(driver, "__init__.py"))

    if os.path.exists(out):
        os.remove(out)

    env = dict(os.environ)
    env.update(
        QT_QPA_PLATFORM="offscreen",
        ANKI_SINGLE_INSTANCE_KEY="anki_vim_mode_e2e",
        ANKI_VIM_E2E_OUT=out,
        ANKI_VIM_E2E_JS=os.path.join(HERE, "page_test.js"),
        QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox --disable-gpu",
    )
    env.pop("WAYLAND_DISPLAY", None)

    # Anki's browser subprocesses can outlive it and hold pipes open, so log
    # to a file and stop the whole process group when it is done.
    log_path = os.path.join(work, "anki.log")

    with open(log_path, "w", encoding="utf-8") as log_file:
        proc = subprocess.Popen(
            [sys.executable, "-c", CHILD, base],
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

        try:
            proc.wait(timeout=100)
        except subprocess.TimeoutExpired:
            pass

        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    with open(log_path, encoding="utf-8") as f:
        log = f.read().strip().splitlines()

    print("--- anki output (last lines) ---")
    print("\n".join(log[-25:]))
    print("--- result ---")

    if os.path.exists(out):
        with open(out, encoding="utf-8") as f:
            print(json.dumps(json.load(f), indent=1))
    else:
        print("no result file was written")


if __name__ == "__main__":
    main()
