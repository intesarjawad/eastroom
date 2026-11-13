import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from eastroom import home


@unittest.skipUnless(hasattr(os, "getuid"), "the entry is a service of macOS")
class StartAtLogin(unittest.TestCase):
    def test_the_entry_belongs_to_the_library_that_wrote_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            mine, other, entry = (
                Path(tmp) / "mine",
                Path(tmp) / "other",
                Path(tmp) / "agents" / "eastroom.home.plist",
            )
            with (
                mock.patch.object(home, "AGENT", entry),
                mock.patch.object(home.sys, "platform", "darwin"),
                mock.patch.object(home.subprocess, "run") as run,
            ):
                self.assertFalse(home.starts_at_login(mine))
                self.assertEqual(
                    home.at_login(True, mine, 4800, ["https://home.example.ts.net:10000"]),
                    {"on": True},
                )
                self.assertFalse(home.starts_at_login(other))  # a second library does not claim it
                self.assertEqual(home.at_login(False, other, 4830, []), {"on": False})
                self.assertTrue(entry.is_file())  # and cannot remove it
                run.assert_not_called()
                self.assertEqual(home.at_login(False, mine, 4800, []), {"on": False})
                self.assertFalse(entry.exists())


if __name__ == "__main__":
    unittest.main()
