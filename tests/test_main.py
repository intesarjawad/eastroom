import contextlib
import io
import socket
import tempfile
import threading
import unittest
import unittest.mock
from pathlib import Path

from eastroom import library
from eastroom.__main__ import main, shelf


class OpenedTwice(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = Path(self.tmp.name) / "library"
        self.addCleanup(self.tmp.cleanup)

    def run_main(self, port):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(["--library", str(self.library), "--port", str(port), "--no-open"])
        return code, out.getvalue(), err.getvalue()

    def test_a_second_start_points_at_the_one_that_runs(self):
        self.library.mkdir()
        server = library.serve(self.library, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.workshop.stop)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        code, out, err = self.run_main(server.server_address[1])
        self.assertEqual(code, 0)
        self.assertIn("already running", out)
        self.assertEqual(err, "")

    def test_another_program_on_the_port_is_named_with_the_next_step(self):
        with socket.socket() as other:
            other.bind(("127.0.0.1", 0))
            other.listen()
            port = other.getsockname()[1]
            code, _, err = self.run_main(port)
        self.assertEqual(code, 2)
        self.assertIn(f"--port {port + 1}", err)


class FormerName(unittest.TestCase):
    """The app was called Devour at first, and kept its books in ~/.devour."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        patch = unittest.mock.patch.object(Path, "home", lambda: self.home)
        patch.start()
        self.addCleanup(patch.stop)

    def test_the_library_kept_under_the_first_name_is_taken_over(self):
        (self.home / ".devour" / "a-book").mkdir(parents=True)
        self.assertEqual(shelf(1), self.home / ".eastroom")
        self.assertTrue((self.home / ".eastroom" / "a-book").is_dir())
        self.assertFalse((self.home / ".devour").exists())

    def test_it_stays_where_it_is_while_a_home_from_before_serves_it(self):
        (self.home / ".devour").mkdir()
        with unittest.mock.patch("eastroom.__main__.running", lambda port: True):
            self.assertEqual(shelf(1), self.home / ".devour")
        self.assertTrue((self.home / ".devour").is_dir())

    def test_a_library_under_the_new_name_is_never_replaced(self):
        (self.home / ".devour").mkdir()
        (self.home / ".eastroom").mkdir()
        self.assertEqual(shelf(1), self.home / ".eastroom")
        self.assertTrue((self.home / ".devour").is_dir())


if __name__ == "__main__":
    unittest.main()
