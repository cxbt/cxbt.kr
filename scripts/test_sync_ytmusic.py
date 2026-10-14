"""Tests for sync_ytmusic.py. Run: python -m unittest scripts/test_sync_ytmusic.py"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_ytmusic as s  # noqa: E402


def raw(i, title=None, **extra):
    item = {
        "browseId": f"MPREb_test{i:04d}",
        "playlistId": f"OLAK5uy_test{i:04d}",
        "title": title or f"Album {i}",
        "type": "Album",
        "artists": [{"name": f"Artist {i}", "id": "UC1"}],
        "year": "2019",
        "thumbnails": [
            {"url": f"https://lh3.googleusercontent.com/a{i}=w60-h60", "width": 60, "height": 60},
            {"url": f"https://lh3.googleusercontent.com/a{i}=w544-h544", "width": 544, "height": 544},
        ],
    }
    item.update(extra)
    return item


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.out = Path(self.dir.name) / "albums.json"
        self.notes = Path(self.dir.name) / "music-notes"
        self.notes.mkdir()
        (self.notes / "MPREb_test0001.md").write_text("+++\nalbum = \"MPREb_test0001\"\n+++\nmy note\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def sync(self, items, now="2026-10-15T00:00:00Z", **kw):
        return s.run(self.out, lambda: items, now, **kw)

    def albums(self):
        return {a["albumId"]: a for a in json.loads(self.out.read_text(encoding="utf-8"))["albums"]}

    def test_first_sync_normalises(self):
        self.assertTrue(self.sync([raw(1), raw(2)]))
        a = self.albums()["MPREb_test0001"]
        self.assertEqual(a["title"], "Album 1")
        self.assertEqual(a["artists"], ["Artist 1"])
        self.assertEqual(a["releaseYear"], 2019)
        self.assertEqual(a["thumbnailUrl"], "https://lh3.googleusercontent.com/a1=w544-h544")
        self.assertEqual(a["youtubeMusicUrl"], "https://music.youtube.com/browse/MPREb_test0001")
        self.assertEqual(a["libraryIndex"], 0)
        self.assertTrue(a["inLibrary"])
        self.assertEqual(a["firstSeenAt"], "2026-10-15T00:00:00Z")

    def test_unchanged_library_writes_nothing(self):
        self.sync([raw(1), raw(2)])
        before = self.out.stat().st_mtime_ns
        self.assertFalse(self.sync([raw(1), raw(2)], now="2026-10-16T00:00:00Z"))
        self.assertEqual(self.out.stat().st_mtime_ns, before)

    def test_new_album_keeps_old_first_seen(self):
        self.sync([raw(1)])
        self.sync([raw(2), raw(1)], now="2026-10-16T00:00:00Z")
        a = self.albums()
        self.assertEqual(a["MPREb_test0001"]["firstSeenAt"], "2026-10-15T00:00:00Z")
        self.assertEqual(a["MPREb_test0002"]["firstSeenAt"], "2026-10-16T00:00:00Z")
        self.assertEqual(a["MPREb_test0002"]["libraryIndex"], 0)

    def test_removed_album_is_kept_and_can_return(self):
        self.sync([raw(1), raw(2)])
        self.sync([raw(2)], now="2026-10-16T00:00:00Z")
        gone = self.albums()["MPREb_test0001"]
        self.assertFalse(gone["inLibrary"])
        self.assertEqual(gone["removedAt"], "2026-10-16T00:00:00Z")
        self.assertNotIn("libraryIndex", gone)
        self.sync([raw(1), raw(2)], now="2026-10-17T00:00:00Z")
        back = self.albums()["MPREb_test0001"]
        self.assertTrue(back["inLibrary"])
        self.assertNotIn("removedAt", back)
        self.assertEqual(back["firstSeenAt"], "2026-10-15T00:00:00Z")

    def test_duplicates_are_collapsed(self):
        self.sync([raw(1), raw(2), raw(1)])
        self.assertEqual(len(self.albums()), 2)

    def test_metadata_and_cover_changes_are_applied(self):
        self.sync([raw(1)])
        changed = raw(1, title="Album 1 (Deluxe)")
        changed["thumbnails"] = [{"url": "https://lh3.googleusercontent.com/new=w544-h544", "width": 544, "height": 544}]
        self.assertTrue(self.sync([changed]))
        a = self.albums()["MPREb_test0001"]
        self.assertEqual(a["title"], "Album 1 (Deluxe)")
        self.assertEqual(a["thumbnailUrl"], "https://lh3.googleusercontent.com/new=w544-h544")

    def test_empty_result_is_refused(self):
        self.sync([raw(1), raw(2)])
        before = self.out.read_text(encoding="utf-8")
        with self.assertRaises(s.GuardError):
            self.sync([])
        self.assertEqual(self.out.read_text(encoding="utf-8"), before)

    def test_mass_removal_is_refused_unless_allowed(self):
        self.sync([raw(i) for i in range(30)])
        with self.assertRaises(s.GuardError):
            self.sync([raw(i) for i in range(20)])
        self.assertTrue(self.sync([raw(i) for i in range(20)], allow_mass_removal=True))

    def test_format_change_is_reported_and_data_kept(self):
        self.sync([raw(1)])
        before = self.out.read_text(encoding="utf-8")
        for bad in ([{"title": "no id"}], [raw(2, browseId=None)], ["not a dict"], [{**raw(3), "title": ""}]):
            with self.assertRaises(s.ApiFormatError):
                self.sync(bad)
        self.assertEqual(self.out.read_text(encoding="utf-8"), before)

    def test_odd_fields_are_tolerated(self):
        self.sync([raw(1, year="Unknown", artists=None, thumbnails=None, type=None)])
        a = self.albums()["MPREb_test0001"]
        self.assertIsNone(a["releaseYear"])
        self.assertEqual(a["artists"], [])
        self.assertIsNone(a["thumbnailUrl"])

    def test_commentary_files_are_never_touched(self):
        note = self.notes / "MPREb_test0001.md"
        before = (note.read_text(encoding="utf-8"), note.stat().st_mtime_ns)
        self.sync([raw(1)])
        self.sync([raw(2)])  # album with a note leaves the library
        self.assertEqual((note.read_text(encoding="utf-8"), note.stat().st_mtime_ns), before)
        self.assertIn("MPREb_test0001", self.albums())

    def test_main_exit_codes(self):
        fixture = Path(self.dir.name) / "fixture.json"
        fixture.write_text(json.dumps([raw(1)]), encoding="utf-8")
        self.assertEqual(s.main(["--out", str(self.out), "--from-file", str(fixture)]), 0)
        fixture.write_text(json.dumps([]), encoding="utf-8")
        self.assertEqual(s.main(["--out", str(self.out), "--from-file", str(fixture)]), 4)
        fixture.write_text(json.dumps({"unexpected": True}), encoding="utf-8")
        self.assertEqual(s.main(["--out", str(self.out), "--from-file", str(fixture)]), 3)

    def test_missing_credentials_is_a_config_error(self):
        import os
        saved = os.environ.pop("YTMUSIC_AUTH", None)
        try:
            self.assertEqual(s.main(["--out", str(self.out)]), 5)
        finally:
            if saved is not None:
                os.environ["YTMUSIC_AUTH"] = saved


if __name__ == "__main__":
    unittest.main()
