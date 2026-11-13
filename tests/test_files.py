import unittest

from eastroom.files import patient


class Patient(unittest.TestCase):
    def test_a_file_that_is_busy_for_a_moment_is_tried_again(self):
        calls: list[int] = []

        def act() -> str:
            calls.append(1)
            if len(calls) < 3:
                raise PermissionError("in use")
            return "done"

        self.assertEqual(patient(act), "done")
        self.assertEqual(len(calls), 3)

    def test_a_file_that_stays_busy_is_reported(self):
        def act() -> None:
            raise PermissionError("in use")

        with self.assertRaises(PermissionError):
            patient(act)

    def test_any_other_failure_is_not_tried_again(self):
        calls: list[int] = []

        def act() -> None:
            calls.append(1)
            raise FileNotFoundError("gone")

        with self.assertRaises(FileNotFoundError):
            patient(act)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
