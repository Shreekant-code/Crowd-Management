import importlib.util
import pathlib
import sys
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("main_module", ROOT / "main.py")
main_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main_module)


class StreamLifecycleTests(unittest.TestCase):
    def test_stream_processor_release_is_safe_without_prior_acquire(self) -> None:
        main_module.slot_limiter = threading.BoundedSemaphore(1)
        processor = main_module.StreamProcessor("cam-1", "http://example.com/stream.mp4", None, None)

        self.assertTrue(processor.acquire_slot())
        processor.release_slot()
        processor.release_slot()
        self.assertFalse(processor._slot_acquired)


if __name__ == "__main__":
    unittest.main()
