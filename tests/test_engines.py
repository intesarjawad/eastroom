import json
import os
import stat
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, ClassVar
from unittest import mock

from eastroom import engines, work

SHAPE = {
    "type": "object",
    "properties": {"picks": {"type": "array", "items": {"type": "integer"}}},
    "required": ["picks"],
}


class Fake(BaseHTTPRequestHandler):
    """A server that speaks the OpenAI chat API, and refuses what `refuses` names."""

    seen: ClassVar[list[Any]] = []
    refuses: tuple = ()

    def log_message(self, *args):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        Fake.seen.append((self.headers.get("Authorization"), self.path))
        if self.path.startswith("/moved"):
            self.send_response(302)
            self.send_header(
                "Location", f"http://127.0.0.1:{self.server.server_address[1]}/v1/models"
            )
            self.send_header("Content-Length", "0")
            return self.end_headers()
        self.reply(200, {"data": [{"id": "small"}, {"id": "big"}]})

    def do_POST(self):
        sent = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Fake.seen.append((self.headers.get("Authorization"), sent))
        if any(name in sent for name in Fake.refuses):
            return self.reply(400, {"error": "unknown field"})
        self.reply(200, {"choices": [{"message": {"content": 'Here you go: {"picks": [2, 4]}'}}]})


class Servers(unittest.TestCase):
    def setUp(self):
        Fake.seen, Fake.refuses = [], ()
        self.server = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.library = Path(self.tmp.name)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"
        self.chosen = {
            "apis": engines.apis([{"id": "mine", "name": "Mine", "url": self.url}]),
            "engines": {"words": {"engine": "api:mine", "model": "small"}},
        }
        self.api = self.chosen["apis"][0]
        patch = mock.patch.object(
            engines.subprocess, "run", return_value=mock.Mock(stdout="90")
        )  # the memory reading of this machine is not under test
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_server_is_asked_with_its_key_a_schema_and_the_picture(self):
        engines.set_key(self.library, self.api, " secret ")
        said = engines.ask(
            self.library, self.chosen, "words", "Which?", images=(b"\x89PNG....",), schema=SHAPE
        )
        key, sent = Fake.seen[0]
        self.assertEqual((said, key, sent["model"]), ({"picks": [2, 4]}, "Bearer secret", "small"))
        self.assertEqual(
            sent["response_format"]["json_schema"]["schema"]["additionalProperties"], False
        )
        self.assertTrue(
            sent["messages"][0]["content"][1]["image_url"]["url"].startswith(
                "data:image/png;base64,"
            )
        )
        self.assertEqual(engines.models(self.url), ["big", "small"])

    def test_a_server_that_refuses_the_fuller_request_gets_a_plainer_one(self):
        Fake.refuses = ("reasoning_effort", "response_format")
        self.assertEqual(
            engines.ask(self.library, self.chosen, "words", "Which?", schema=SHAPE),
            {"picks": [2, 4]},
        )
        self.assertEqual(
            [sorted(set(sent) - {"model", "messages", "temperature"}) for _, sent in Fake.seen],
            [["reasoning_effort", "response_format"], ["response_format"], []],
        )
        self.assertIn("JSON object", Fake.seen[-1][1]["messages"][0]["content"])

    def test_the_key_is_kept_where_only_the_owner_reads_it_and_never_in_the_settings(self):
        work.save_settings(self.library, {"apis": self.chosen["apis"]})
        (self.library / "secrets.tmp").touch(mode=0o644)  # left behind by a run that was stopped
        engines.set_key(self.library, self.api, "secret")
        if os.name == "posix":  # elsewhere the file takes the protection of the owner's folder
            mode = stat.S_IMODE((self.library / "secrets.json").stat().st_mode)
            self.assertEqual(mode, 0o600)
        self.assertNotIn("secret", (self.library / "settings.json").read_text(encoding="utf-8"))
        self.assertEqual(engines.keys(self.library, self.chosen), {"mine": "secret"})
        engines.set_key(self.library, self.api, "")
        self.assertEqual(engines.keys(self.library, self.chosen), {})
        with self.assertRaises(ValueError):
            engines.set_key(self.library, {"id": "../x", "url": self.url}, "k")

    def test_a_key_goes_to_the_address_it_was_given_for_and_nowhere_else(self):
        engines.set_key(self.library, self.api, "secret")
        elsewhere = {
            "apis": [{**self.api, "url": self.url.replace("/v1", "/other")}],
            "engines": self.chosen["engines"],
        }
        self.assertEqual(
            engines.keys(self.library, elsewhere), {}
        )  # the same id pointed at another address has no key
        with self.assertRaises(
            RuntimeError
        ):  # and a server that redirects is not followed, so the key cannot travel
            engines.models(self.url.replace("/v1", "/moved"), "secret")
        self.assertEqual([path for _, path in Fake.seen], ["/moved/models"])

    def test_a_models_name_cannot_be_a_flag(self):
        for model in ("--dangerously-skip-permissions", "-m x", "a b", "x" * 201):
            with self.assertRaises(ValueError):
                engines.answer(self.library, self.chosen, "tool:claude", model, "Which?")
        self.assertEqual(
            engines.answer(
                self.library,
                self.chosen,
                "api:mine",
                "vendor/name-1.5:free",
                "Which?",
                schema=SHAPE,
            ),
            {"picks": [2, 4]},
        )

    def test_an_engine_that_is_not_set_up_says_so(self):
        for ref in ("", "tool:bash", "api:other", "/bin/sh"):
            with self.assertRaises(ValueError):
                engines.answer(self.library, self.chosen, ref, "m", "Which?")


class Addresses(unittest.TestCase):
    def test_only_a_plain_address_with_a_short_id_is_kept(self):
        kept = engines.apis(
            [
                {"id": "or", "name": "OpenRouter", "url": "https://openrouter.ai/api/v1/"},
                {"id": "Bad Id", "name": "x", "url": "http://a"},
                {"id": "q", "name": "x", "url": "http://a/?q=1"},
                {"id": "u", "name": "x", "url": "http://user:pass@host/"},
                {"id": "f", "name": "x", "url": "file:///etc/passwd"},
                {"id": "h", "name": "x", "url": "http://169.254.169.254/latest/#"},
                "junk",
            ]
        )
        self.assertEqual(
            kept, [{"id": "or", "name": "OpenRouter", "url": "https://openrouter.ai/api/v1"}]
        )
        self.assertEqual(
            engines.apis(
                [
                    {"id": "p", "name": "x", "url": "http://host:abc/v1"},
                    {"id": "e", "name": "x", "url": "http://:11434"},
                ]
            ),
            [],
        )
        self.assertEqual(
            [
                engines.local(u)
                for u in (
                    "http://127.0.0.1:1/v1",
                    "http://[::1]:1",
                    "http://localhost./v1",
                    "http://0.0.0.0:1",
                    "https://openrouter.ai/api/v1",
                )
            ],
            [True, True, True, True, False],
        )

    def test_settings_keep_the_servers_and_drop_an_engine_that_does_not_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = Path(tmp)
            saved = work.save_settings(
                library,
                {
                    "apis": [
                        {"id": "or", "name": "OpenRouter", "url": "https://openrouter.ai/api/v1"}
                    ],
                    "engines": {
                        "eyes": {"engine": "api:or", "model": "some/model"},
                        "words": {"engine": "tool:rm", "model": "x"},
                    },
                },
            )
            self.assertEqual(
                (saved["engines"]["eyes"], saved["engines"]["words"]),
                ({"engine": "api:or", "model": "some/model"}, {"engine": "", "model": ""}),
            )
            self.assertEqual(
                len(work.save_settings(library, {"auto": {"letters": False}})["apis"]), 1
            )  # saying nothing about the servers leaves them
            self.assertEqual(
                work.save_settings(library, {"apis": []})["engines"]["eyes"],
                {"engine": "", "model": ""},
            )  # its server is gone, so is the choice


class Tools(unittest.TestCase):
    def recipe(self, name, images=()):
        with tempfile.TemporaryDirectory() as tmp:
            return engines.recipe(name, f"/x/{name}", Path(tmp), "m1", "Which?", images, SHAPE, 60)

    def test_no_tool_is_ever_told_to_approve_its_own_actions(self):
        for name in engines.TOOLS:
            command, _ = self.recipe(name, () if name == "agy" else (b"\xff\xd8..",))
            self.assertEqual(command[0], f"/x/{name}")
            self.assertFalse(
                [
                    part
                    for part in command
                    if "skip-permissions" in part
                    or "bypass" in part
                    or part in ("--auto", "--yolo", "--full-auto")
                ],
                name,
            )
        claude, sent = self.recipe("claude", (b"\xff\xd8..",))
        self.assertEqual(claude[claude.index("--tools") + 1], "")  # no tools at all
        self.assertEqual(
            json.loads(sent)["message"]["content"][0]["source"]["media_type"], "image/jpeg"
        )
        self.assertIn("read-only", self.recipe("codex")[0])
        self.assertIn("plan", self.recipe("agy")[0])
        opencode = self.recipe("opencode", (b"\xff\xd8..",))[0]
        self.assertEqual(
            (opencode[opencode.index("--agent") + 1], opencode[-2]), ("plan", "--")
        )  # the question is the last word and cannot be read as a flag
        for name in engines.TOOLS:
            self.assertIn("--model=m1", self.recipe(name)[0], name)  # one argument, never two

    def test_each_tools_way_of_answering_is_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            claude = (
                '{"type":"system"}\n'
                '{"type":"result","is_error":false,"result":"{}","structured_output":{"picks":[1]}}\n'
            )
            self.assertEqual(engines.read("claude", claude, folder), {"picks": [1]})
            with self.assertRaises(RuntimeError):
                engines.read(
                    "claude", '{"type":"result","is_error":true,"result":"Not logged in"}', folder
                )
            self.assertEqual(
                engines.read(
                    "agy",
                    '{"status":"SUCCESS","response":"{\\"picks\\":[2]}","structured_output":{"picks":[2]}}',
                    folder,
                ),
                {"picks": [2]},
            )
            opencode = (
                '{"type":"step_start","part":{"type":"step-start"}}\n'
                '{"type":"text","part":{"type":"text","text":"Sure: {\\"picks\\": [3]}"}}\n'
            )
            self.assertEqual(engines.read("opencode", opencode, folder), {"picks": [3]})
            self.assertIsNone(engines.read("codex", "", folder))
            (folder / "answer.txt").write_text('{"picks": [4]}', encoding="utf-8")
            self.assertEqual(engines.read("codex", "", folder), {"picks": [4]})

    def test_a_tool_that_is_not_one_of_the_four_or_not_installed_is_refused(self):
        with self.assertRaises(ValueError):
            engines._tool("sh", "", "x", (), None, 5)
        with (
            mock.patch.object(engines.shutil, "which", return_value=None),
            self.assertRaises(ValueError),
        ):
            engines._tool("claude", "", "x", (), None, 5)
        with self.assertRaises(ValueError):
            self.recipe("agy", (b"\xff\xd8..",))

    def test_what_a_tool_said_never_reaches_the_note_a_page_can_read(self):
        ran = mock.MagicMock(pid=1)
        ran.__enter__.return_value = ran
        ran.communicate.return_value = ("SECRET from a file", "")
        with (
            mock.patch.object(engines.shutil, "which", return_value="/bin/codex"),
            mock.patch.object(engines.subprocess, "Popen", return_value=ran),
            mock.patch.object(engines, "with_group"),
            mock.patch.object(engines.sys, "stderr"),
            self.assertRaises(RuntimeError) as failed,
        ):
            engines._tool("codex", "m1", "x", (), None, 5)
        self.assertNotIn("SECRET", str(failed.exception))


if __name__ == "__main__":
    unittest.main()
