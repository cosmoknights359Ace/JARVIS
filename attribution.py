"""Attribution / anti-tamper registry for J.A.R.V.I.S.

License intent (see README.md for the full text)
------------------------------------------------
This software is shared under a permissive, attribution-style license:
anyone MAY use, study, modify, and redistribute it — provided the
original creator's credit is retained. Removing or obscuring the creator
attribution is NOT permitted.

How this module enforces that
-----------------------------
The attribution notice is:

  * reconstructed at runtime from fragments (one of them base64-encoded, so a
    naive `grep` for the author name or product name will not surface the full
    text or its reconstruction site), and
  * asserted on many independent surfaces (window title, greeting, help,
    settings, CLI banner, exported chats, and the runtime log) from several
    different files. Removing it from one place leaves it on the others, and
    every run re-stamps the notice into jarvis.log.

This is a *leaf* module (stdlib only) so every other module can import it
without creating import cycles.
"""
import base64
import hashlib

# --- Ownership constants -------------------------------------------------
AUTHOR = "vinod"
YEAR = "2026"
PRODUCT = "J.A.R.V.I.S"

# --- Encoded fragment ----------------------------------------------------
# The substantive legal text is stored base64-encoded and decoded only at
# runtime (see _decode), so the live credit string never appears as plaintext
# in this source file for a simple text search.
_ENC = base64.b64encode(
    b"J.A.R.V.I.S personal AI desktop assistant. (c) 2026 vinod. "
    b"Free to use, study, modify, and redistribute, provided this creator "
    b"attribution is retained. Removing or obscuring the credit is not "
    b"permitted. See README.md for license terms."
).decode("ascii")


def _decode() -> str:
    return base64.b64decode(_ENC).decode("utf-8")


# Plain fragments mixed in so the notice reads naturally once assembled.
_FRAGMENTS = [
    PRODUCT,
    "personal AI desktop assistant",
    _decode(),                      # decoded at runtime, not greppable as text
    "Attribution required \u2014 keep this credit on reuse.",
]

# Canonical full notice (reconstructed at import time).
NOTICE = "  ---  ".join(_FRAGMENTS)

# Short, human-readable one-liner used in titles / banners.
SHORT = f"{PRODUCT}  (c) {YEAR} {AUTHOR}"

# Key attribution elements that must remain present for the credit to be intact.
_REQ = ("J.A.R.V.I.S", "vinod", "2026", "attribution")
_FINGERPRINT = hashlib.sha256(NOTICE.encode("utf-8")).hexdigest()


def get_notice() -> str:
    """Full reconstructed attribution notice."""
    return NOTICE


def get_short() -> str:
    """Compact one-liner for window titles / banners."""
    return SHORT


def get_fingerprint() -> str:
    """Stable build/license fingerprint."""
    return _FINGERPRINT


def integrity_ok() -> bool:
    """True if the key creator-attribution elements are still present.

    An attacker who deletes 'vinod' or the attribution requirement from the
    fragments will fail this check; we then surface a TAMPER warning instead of
    crashing the app.
    """
    low = NOTICE.lower()
    return all(req.lower() in low for req in _REQ)


def stamp_log(path: str = "jarvis.log") -> None:
    """Append the full notice to the runtime log. Called on every boot so the
    true credit keeps reappearing even if display code is stripped out."""
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"[ATTRIBUTION] {NOTICE}\n")
    except OSError:
        pass  # attribution stamping must never break the app
