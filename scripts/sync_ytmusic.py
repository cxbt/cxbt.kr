#!/usr/bin/env python3
"""Sync the albums saved in a YouTube Music library into data/music/albums.json.

This script only ever writes data/music/albums.json. Personal commentary lives in
content/music-notes/ and the video mapping in data/music/media.yaml; both are
hand-written and never read or written here.

Credentials come from the environment (GitHub Actions secrets), never from the repo:
  YTMUSIC_AUTH               JSON produced by `ytmusicapi oauth` or `ytmusicapi browser`
  YTMUSIC_OAUTH_CLIENT_ID    only for OAuth auth
  YTMUSIC_OAUTH_CLIENT_SECRET only for OAuth auth

Exit codes: 0 ok (changed or not) · 2 authentication · 3 unexpected API response
            4 safety guard (suspicious removal) · 5 configuration
On any non-zero exit the existing data file is left untouched.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SCHEMA = 1
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data" / "music" / "albums.json"
ALBUM_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
URL_ALBUM = "https://music.youtube.com/browse/{}"

log = logging.getLogger("sync_ytmusic")


class SyncError(Exception):
    code = 1


class AuthError(SyncError):
    code = 2


class ApiFormatError(SyncError):
    code = 3


class GuardError(SyncError):
    code = 4


class ConfigError(SyncError):
    code = 5


# ───────────────────────────── fetching ─────────────────────────────


def safe(exc: BaseException, limit: int = 300) -> str:
    """A one-line description of an error, with anything token-like blanked out."""
    text = re.sub(r"[A-Za-z0-9_\-=/+.%]{32,}", "…", f"{type(exc).__name__}: {exc}")
    text = " ".join(text.split())
    return text[:limit]


def annotate(message: str) -> None:
    """Surface the failure on the GitHub Actions run summary, not only in the log."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::error title=Music sync failed::{message}", flush=True)



def make_client() -> Any:
    raw = os.environ.get("YTMUSIC_AUTH", "").strip()
    if not raw:
        raise ConfigError("YTMUSIC_AUTH is not set")
    try:
        auth = json.loads(raw)
    except json.JSONDecodeError:
        raise ConfigError("YTMUSIC_AUTH is not valid JSON") from None
    if not isinstance(auth, dict):
        raise ConfigError("YTMUSIC_AUTH must be a JSON object")

    from ytmusicapi import OAuthCredentials, YTMusic

    client_id = os.environ.get("YTMUSIC_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YTMUSIC_OAUTH_CLIENT_SECRET", "").strip()
    is_oauth = "refresh_token" in auth
    if is_oauth and not (client_id and client_secret):
        raise ConfigError("OAuth auth needs YTMUSIC_OAUTH_CLIENT_ID and YTMUSIC_OAUTH_CLIENT_SECRET")
    creds = OAuthCredentials(client_id=client_id, client_secret=client_secret) if is_oauth else None
    session = requests_session()
    try:
        return YTMusic(auth, oauth_credentials=creds, requests_session=session)
    except Exception as exc:  # message may echo header values, so only the type is logged
        raise AuthError(f"could not initialise the client ({type(exc).__name__})") from None


LAST_RESPONSE: dict[str, Any] = {}


def requests_session() -> Any:
    """A session that remembers the status and shape of the last response (never its headers or cookies),
    so a non-JSON answer from YouTube Music can be described instead of surfacing as a bare JSONDecodeError."""
    import requests

    def remember(response: Any, *args: Any, **kwargs: Any) -> None:
        body = response.text[:4000] if response.content else ""
        title = re.search(r"<title[^>]*>([^<]{0,120})", body, re.I)
        LAST_RESPONSE.update(
            status=response.status_code,
            type=response.headers.get("content-type", "").split(";")[0],
            title=" ".join(title.group(1).split()) if title else "",
            empty=not body.strip(),
            redirected=bool(response.history),
            host=re.sub(r"^https?://([^/]+).*$", r"\1", response.url),
        )

    session = requests.Session()
    session.hooks["response"].append(remember)
    return session


def describe_non_json() -> str:
    r = LAST_RESPONSE
    if not r:
        return "YouTube Music returned something that is not JSON"
    what = "an empty body" if r.get("empty") else f"{r.get('type') or 'unknown content'}" + (f" titled '{r['title']}'" if r.get("title") else "")
    hint = ""
    if r.get("status") in (429, 403) or "sorry" in r.get("title", "").lower():
        hint = "; Google is likely blocking requests from this machine's IP (common on CI runners)"
    elif r.get("redirected") or r.get("host", "").startswith(("accounts.", "consent.")):
        hint = "; the request was redirected to a sign-in/consent page, so the cookie is probably invalid or incomplete"
    return f"YouTube Music answered HTTP {r.get('status')} from {r.get('host')} with {what} instead of JSON{hint}"


def fetch_library(client: Any) -> list[dict[str, Any]]:
    from ytmusicapi.exceptions import YTMusicServerError, YTMusicUserError

    try:
        # YouTube Music answers a signed-out request with an empty library rather than an error,
        # so confirm the session is signed in before trusting an empty or short result.
        try:
            client.get_account_info()
        except (KeyError, IndexError, TypeError):
            raise AuthError("the credentials are not signed in to YouTube Music (no account menu); the cookie or token is invalid or expired") from None
        items = client.get_library_albums(limit=None, order="recently_added")
    except YTMusicServerError as exc:
        status = re.search(r"HTTP (\d{3})", str(exc))
        if status and status.group(1) in {"401", "403"}:
            raise AuthError(f"YouTube Music rejected the credentials (HTTP {status.group(1)})") from None
        if status and status.group(1) == "400":
            # what an expired/invalid OAuth token or cookie looks like in practice
            raise AuthError("YouTube Music answered HTTP 400; the credentials are most likely expired or invalid") from None
        raise SyncError(f"YouTube Music request failed: {safe(exc)}") from None
    except YTMusicUserError as exc:
        raise AuthError(f"not authenticated ({type(exc).__name__})") from None
    except ValueError as exc:  # json.JSONDecodeError: the body was HTML or empty
        if type(exc).__name__ != "JSONDecodeError":
            raise
        status = LAST_RESPONSE.get("status")
        message = describe_non_json()
        if status in (401, 403) or LAST_RESPONSE.get("redirected"):
            raise AuthError(message) from None
        raise SyncError(message) from None
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ApiFormatError(f"could not parse the library response ({type(exc).__name__}: {exc})") from None
    if not isinstance(items, list):
        raise ApiFormatError(f"expected a list of albums, got {type(items).__name__}")
    return items


# ───────────────────────────── normalising ─────────────────────────────


def best_thumbnail(thumbs: Any) -> str | None:
    if not isinstance(thumbs, list):
        return None
    good = [t for t in thumbs if isinstance(t, dict) and isinstance(t.get("url"), str) and t["url"].startswith("https://")]
    if not good:
        return None
    return max(good, key=lambda t: (t.get("width") or 0) * (t.get("height") or 0))["url"]


def parse_year(value: Any) -> int | None:
    if isinstance(value, int):
        year = value
    elif isinstance(value, str) and value.strip().isdigit():
        year = int(value.strip())
    else:
        return None
    return year if 1900 <= year <= 2100 else None


def normalize(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ApiFormatError(f"album entry is {type(item).__name__}, not an object")
    album_id = item.get("browseId")
    title = item.get("title")
    if not isinstance(album_id, str) or not ALBUM_ID.match(album_id):
        raise ApiFormatError(f"album entry without a usable browseId: {album_id!r}")
    if not isinstance(title, str) or not title.strip():
        raise ApiFormatError(f"album {album_id} has no title")
    artists = [a["name"].strip() for a in item.get("artists") or [] if isinstance(a, dict) and isinstance(a.get("name"), str) and a["name"].strip()]
    record: dict[str, Any] = {
        "albumId": album_id,
        "title": title.strip(),
        "artists": artists,
        "releaseYear": parse_year(item.get("year")),
        "type": item["type"] if isinstance(item.get("type"), str) and item["type"] else None,
        "thumbnailUrl": best_thumbnail(item.get("thumbnails")),
        "youtubeMusicUrl": URL_ALBUM.format(album_id),
    }
    if isinstance(item.get("playlistId"), str) and item["playlistId"]:
        record["playlistId"] = item["playlistId"]
    return record


# ───────────────────────────── merging ─────────────────────────────


def merge(existing: list[dict[str, Any]], fetched: list[dict[str, Any]], now: str, allow_mass_removal: bool = False) -> list[dict[str, Any]]:
    """Fold a fresh library listing into the stored records.

    firstSeenAt is the first time *this archive* saw the album (not the YouTube Music save date)
    and never changes. libraryIndex is the album's position in YouTube Music's "recently added"
    order at the last successful sync. Albums that leave the library are kept with
    inLibrary=false so their pages, and the commentary attached to them, survive.
    """
    previous = {a["albumId"]: a for a in existing}
    active_before = sum(1 for a in existing if a.get("inLibrary"))

    result: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(fetched):
        album_id = record["albumId"]
        if album_id in result:  # the same album listed twice: keep the first (most recent) position
            continue
        old = previous.get(album_id, {})
        result[album_id] = {
            **record,
            "inLibrary": True,
            "libraryIndex": len(result),
            "firstSeenAt": old.get("firstSeenAt") or now,
        }

    gone = [a for a in existing if a["albumId"] not in result and a.get("inLibrary")]
    if active_before and not result:
        raise GuardError(f"library came back empty while {active_before} albums were stored; refusing to treat that as a removal")
    if not allow_mass_removal and active_before >= 10 and len(gone) > max(5, active_before // 5):
        raise GuardError(f"{len(gone)} of {active_before} albums would be marked removed at once; re-run with --allow-mass-removal if that is real")

    for album_id, old in previous.items():
        if album_id in result:
            continue
        kept = {k: v for k, v in old.items() if k != "libraryIndex"}
        if old.get("inLibrary"):
            kept["inLibrary"] = False
            kept["removedAt"] = now
        result[album_id] = kept

    return sorted(result.values(), key=lambda a: a["albumId"])


# ───────────────────────────── storage ─────────────────────────────


REQUIRED = {"albumId": str, "title": str, "artists": list, "youtubeMusicUrl": str, "inLibrary": bool, "firstSeenAt": str}


def validate(albums: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for a in albums:
        for key, kind in REQUIRED.items():
            if not isinstance(a.get(key), kind):
                raise SyncError(f"record {a.get('albumId')!r} has an invalid {key}")
        if a["albumId"] in seen:
            raise SyncError(f"duplicate albumId {a['albumId']}")
        seen.add(a["albumId"])


def load(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("albums"), list):
        raise ConfigError(f"{path} is not a schema {SCHEMA} album file")
    validate(doc["albums"])
    return doc["albums"]


def dump(albums: list[dict[str, Any]]) -> str:
    return json.dumps({"schema": SCHEMA, "albums": albums}, ensure_ascii=False, indent=2) + "\n"


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".albums.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# ───────────────────────────── entry point ─────────────────────────────


def run(out: Path, fetch: Callable[[], list[Any]], now: str, dry_run: bool = False, allow_mass_removal: bool = False) -> bool:
    existing = load(out)
    raw = fetch()
    if not isinstance(raw, list):
        raise ApiFormatError(f"expected a list of albums, got {type(raw).__name__}")
    fetched = [normalize(item) for item in raw]
    albums = merge(existing, fetched, now, allow_mass_removal)
    validate(albums)
    text = dump(albums)
    current = out.read_text(encoding="utf-8") if out.exists() else ""
    changed = text != current
    active = sum(1 for a in albums if a["inLibrary"])
    log.info("library: %d albums fetched, %d in library, %d kept as removed, changed=%s", len(fetched), active, len(albums) - active, changed)
    if changed and not dry_run:
        write_atomic(out, text)
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="album data file (default: data/music/albums.json)")
    parser.add_argument("--from-file", type=Path, help="read a saved get_library_albums() response instead of calling YouTube Music")
    parser.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    parser.add_argument("--allow-mass-removal", action="store_true", help="accept removing more than 20%% of the library in one run")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.from_file:
        fetch = lambda: json.loads(args.from_file.read_text(encoding="utf-8"))  # noqa: E731
    else:
        fetch = lambda: fetch_library(make_client())  # noqa: E731

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    try:
        changed = run(args.out, fetch, now, args.dry_run, args.allow_mass_removal)
    except SyncError as exc:
        kind = {2: "auth", 3: "api-format", 4: "guard", 5: "config"}.get(exc.code, "error")
        log.error("[%s] %s — %s left unchanged", kind, exc, args.out)
        annotate(f"[{kind}] {exc}")
        return exc.code
    except Exception as exc:  # network errors and the like
        log.error("[error] %s — %s left unchanged", safe(exc), args.out)
        annotate(f"[error] {safe(exc)}")
        return 1

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as fh:
            fh.write(f"changed={'true' if changed and not args.dry_run else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
