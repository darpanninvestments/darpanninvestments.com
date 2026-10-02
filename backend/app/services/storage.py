"""File storage: Vercel Blob (private store) when BLOB_READ_WRITE_TOKEN is set, local disk otherwise.

Stored paths are opaque strings saved in documents.storage_path:
  "blob:<pathname>"  -> object in the private Vercel Blob store
  "<relative path>"  -> file under settings.upload_path (local development)
"""
import logging
import os

from ..config import settings

log = logging.getLogger("crm.storage")
BLOB_PREFIX = "blob:"


def blob_enabled() -> bool:
    return bool(os.getenv("BLOB_READ_WRITE_TOKEN") or os.getenv("VERCEL_BLOB_READ_WRITE_TOKEN"))


def save_bytes(rel_path: str, data: bytes, content_type: str | None = None) -> str:
    rel_path = rel_path.replace("\\", "/").lstrip("/")
    if blob_enabled():
        from vercel.blob import put
        res = put(rel_path, data, access="private", content_type=content_type or "application/octet-stream",
                  add_random_suffix=False, overwrite=True)
        return BLOB_PREFIX + res.pathname
    dest = settings.upload_path / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel_path


def read_bytes(stored: str) -> bytes:
    if stored.startswith(BLOB_PREFIX):
        from vercel.blob import get
        return get(stored[len(BLOB_PREFIX):], access="private", use_cache=False).content
    return (settings.upload_path / stored).read_bytes()


def delete(stored: str) -> None:
    try:
        if stored.startswith(BLOB_PREFIX):
            from vercel.blob import delete as blob_delete
            blob_delete(stored[len(BLOB_PREFIX):])
        else:
            (settings.upload_path / stored).unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001 – cleanup is best effort
        log.warning("Could not delete %s: %s", stored, e)
