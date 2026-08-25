"""Inference provider layer for J.A.R.V.I.S.

Two backends:
  - local  : Ollama running on this machine (private, free, offline)
  - cloud  : any OpenAI-compatible HTTP API (OpenRouter, Groq, Together,
             llama.cpp server, the orcarouter endpoint in config.toml, ...)

GUI-agnostic: no Tk imports. The GUI drives this module and renders the
returned strings/iterators. Network access uses only the stdlib
(http.client / json) so no new dependencies are required.

Key resolution order: JARVIS_API_KEY env var -> keyring (Windows Credential
Manager) -> [llm] api_key in config.toml.
"""
import base64
import http.client
import json
import os
import re
import socket
import tomllib
import urllib.request
from urllib.parse import urlsplit

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(APP_DIR, "config.toml")
KEYRING_SERVICE = "jarvis.llm"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def load_config():
    """Parse config.toml. Missing/invalid file -> {} (never raises)."""
    try:
        with open(CONFIG_FILE, "rb") as f:
            return tomllib.load(f)
    except Exception:
        return {}


def _cfg(cfg, section, key, default=""):
    try:
        val = cfg.get(section, {}).get(key, default)
        return val if isinstance(val, str) else default
    except Exception:
        return default


def save_config(cfg):
    """Write config back to config.toml. Only known scalar sections/keys are
    persisted; the API key is deliberately never written."""
    lines = []
    for section in ("llm", "vision", "jarvis"):
        vals = cfg.get(section)
        if not isinstance(vals, dict):
            continue
        lines.append(f"[{section}]")
        for k, v in vals.items():
            if k == "api_key":
                continue
            if isinstance(v, bool):
                lines.append(f"{k} = {'true' if v else 'false'}")
            elif isinstance(v, (int, float)):
                lines.append(f"{k} = {v}")
            else:
                lines.append(f'{k} = "{str(v)}"')
        lines.append("")
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------------------
# API key storage
# ---------------------------------------------------------------------------


def _keyring():
    try:
        import keyring  # bundled with Python 3.12+ on Windows
        return keyring
    except Exception:
        return None


def get_api_key(cfg=None):
    cfg = cfg if cfg is not None else load_config()
    env = os.environ.get("JARVIS_API_KEY", "").strip()
    if env:
        return env
    kr = _keyring()
    if kr is not None:
        try:
            stored = kr.get_password(KEYRING_SERVICE, "api_key")
            if stored:
                return stored.strip()
        except Exception:
            pass
    return _cfg(cfg, "llm", "api_key", "").strip()


def set_api_key(key):
    """Store the key in the OS credential store. Returns True on success.
    Raises RuntimeError when no secure store is available so the caller can
    tell the user to set JARVIS_API_KEY instead."""
    key = (key or "").strip()
    if not key:
        raise ValueError("empty key")
    kr = _keyring()
    if kr is None:
        raise RuntimeError("no credential store available")
    kr.set_password(KEYRING_SERVICE, "api_key", key)
    return True


def delete_api_key():
    kr = _keyring()
    if kr is None:
        return False
    try:
        kr.delete_password(KEYRING_SERVICE, "api_key")
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Model specs
# ---------------------------------------------------------------------------


class ModelSpec:
    """One selectable model: a provider ("local"/"cloud"), the wire model
    name, and an optional route hint ("general" | "coding" | "vision")."""

    __slots__ = ("id", "provider", "model", "route")

    def __init__(self, spec_id, provider, model, route="general"):
        self.id = spec_id
        self.provider = provider
        self.model = model
        self.route = route

    @property
    def is_cloud(self):
        return self.provider == "cloud"

    def __repr__(self):
        return f"ModelSpec({self.id!r}, {self.provider!r}, {self.model!r}, {self.route!r})"

    def __eq__(self, other):
        return isinstance(other, ModelSpec) and self.id == other.id

    def __hash__(self):
        return hash(self.id)


# Defaults tuned for the target machine (RTX 3050 4GB VRAM / 16GB RAM):
# small Q4 models that fit VRAM, big-but-slow 7B as the ceiling.
DEFAULT_LOCAL_MODELS = {
    "qwen2.5:3b": "general",
    "qwen2.5-coder:7b": "coding",
}
DEFAULT_VISION_MODEL = "llama3.2-vision:latest"

# Canonical aliases -> ids of whatever specs are registered (local or cloud).
DEFAULT_AUTO_ROUTES = {"general": "qwen2.5:3b", "coding": "qwen2.5-coder:7b"}


def _local_models_from_cfg(cfg):
    raw = _cfg(cfg, "jarvis", "local_models", "")
    if not raw.strip():
        return dict(DEFAULT_LOCAL_MODELS)
    out = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            name, route = part.split("=", 1)
            out[name.strip()] = route.strip() or "general"
        else:
            out[part] = "general"
    return out or dict(DEFAULT_LOCAL_MODELS)


def _list_setting(cfg, section, key):
    val = cfg.get(section, {}).get(key)
    if isinstance(val, list):
        return [str(v).strip() for v in val if str(v).strip()]
    if isinstance(val, str) and val.strip():
        return [p.strip() for p in val.split(",") if p.strip()]
    return []


def build_model_registry(cfg=None):
    """Build the full model registry from config + defaults.

    Returns {spec_id: ModelSpec}. Local ids are bare model names; cloud ids
    are prefixed "cloud/<model>". Every spec carries a route hint so
    provider-agnostic auto routing can work over ids only.
    """
    cfg = cfg if cfg is not None else load_config()
    registry = {}
    for name, route in _local_models_from_cfg(cfg).items():
        registry[name] = ModelSpec(name, "local", name, route)
    for name in _list_setting(cfg, "llm", "cloud_models"):
        registry[f"cloud/{name}"] = ModelSpec(f"cloud/{name}", "cloud", name, "general")
    for name in _list_setting(cfg, "llm", "cloud_coding_models"):
        registry[f"cloud/{name}"] = ModelSpec(f"cloud/{name}", "cloud", name, "coding")
    # Single-model shorthand from [llm] model = ...
    single = _cfg(cfg, "llm", "model", "").strip()
    if single and f"cloud/{single}" not in registry:
        registry[f"cloud/{single}"] = ModelSpec(f"cloud/{single}", "cloud", single, "general")
    return registry


def vision_specs(cfg=None):
    """All registered specs that can analyze images, cloud ones first (a
    configured cloud vision model is more likely intended than the 7.8GB
    local one)."""
    cfg = cfg if cfg is not None else load_config()
    specs = []
    cloud_v = _cfg(cfg, "vision", "cloud_model", "").strip()
    if cloud_v:
        specs.append(ModelSpec(f"cloud/{cloud_v}", "cloud", cloud_v, "vision"))
    local_v = _cfg(cfg, "vision", "local_model", DEFAULT_VISION_MODEL).strip()
    if local_v:
        specs.append(ModelSpec(local_v, "local", local_v, "vision"))
    return specs


def auto_routes(cfg=None):
    """Effective route table {alias: spec_id}: config [jarvis] general_model /
    coding_model override the defaults, but only when the id exists."""
    cfg = cfg if cfg is not None else load_config()
    registry = build_model_registry(cfg)
    routes = dict(DEFAULT_AUTO_ROUTES)
    for alias, key in (("general", "general_model"), ("coding", "coding_model")):
        override = _cfg(cfg, "jarvis", key, "").strip()
        if override:
            if override in registry:
                routes[alias] = override
            elif f"cloud/{override}" in registry:
                routes[alias] = f"cloud/{override}"
    # Keep only routes whose target is registered.
    return {a: sid for a, sid in routes.items() if sid in registry}


# ---------------------------------------------------------------------------
# Provider-agnostic auto routing (stateful, sticky)
# ---------------------------------------------------------------------------


class AutoRouter:
    """Picks a spec id for each message based on coding keywords, sticky so a
    coding conversation doesn't bounce between models. Knows nothing about
    providers — works purely over spec ids + route hints."""

    def __init__(self, routes, coding_keywords, sticky_threshold=3):
        # routes: {"general": spec_id, "coding": spec_id}
        self.routes = dict(routes)
        self.coding_keywords = list(coding_keywords)
        self.sticky_threshold = max(1, int(sticky_threshold))
        self.last_resolved = None
        self.consecutive_non_coding = 0

    def reset(self):
        self.last_resolved = None
        self.consecutive_non_coding = 0

    def resolve(self, message):
        is_coding = any(w in message.lower() for w in self.coding_keywords)
        if is_coding:
            self.consecutive_non_coding = 0
            coding = self.routes.get("coding")
            if coding:
                self.last_resolved = coding
        else:
            self.consecutive_non_coding += 1
            general = self.routes.get("general")
            if self.last_resolved is None or \
                    self.consecutive_non_coding >= self.sticky_threshold:
                if general:
                    self.last_resolved = general
        # Fall back to whatever route exists if one direction is missing.
        if self.last_resolved is None:
            self.last_resolved = (
                self.routes.get("general")
                or self.routes.get("coding")
                or next(iter(self.routes.values()), None)
            )
        return self.last_resolved


# ---------------------------------------------------------------------------
# Cloud (OpenAI-compatible) HTTP client — stdlib only, streaming
# ---------------------------------------------------------------------------


class CloudError(Exception):
    pass


class CloudUnavailable(CloudError):
    """Endpoint/key/base-url problem — caller should consider falling back
    to local Ollama."""


def _cloud_endpoint(cfg):
    base = _cfg(cfg, "llm", "base_url", "").strip()
    if not base:
        raise CloudUnavailable("no cloud base_url configured")
    return base.rstrip("/")


def _cloud_parts(cfg):
    """Return (host, port, path_prefix, use_ssl) for the configured base_url,
    with the chat-completions path appended."""
    endpoint = _cloud_endpoint(cfg)
    if endpoint.endswith("/chat/completions"):
        url = endpoint
    elif endpoint.endswith("/v1"):
        url = endpoint + "/chat/completions"
    else:
        url = endpoint + "/v1/chat/completions"
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise CloudUnavailable(f"invalid cloud base_url: {endpoint!r}")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = parts.path or "/"
    return parts.hostname, port, path, parts.scheme == "https"


def _cloud_conn(cfg, timeout=60):
    host, port, _path, use_ssl = _cloud_parts(cfg)
    if use_ssl:
        return http.client.HTTPSConnection(host, port, timeout=timeout)
    return http.client.HTTPConnection(host, port, timeout=timeout)


def _cloud_headers(cfg):
    key = get_api_key(cfg)
    if not key:
        raise CloudUnavailable("no API key (set JARVIS_API_KEY or save one in Settings)")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
        "Accept": "text/event-stream",
    }


def cloud_chat_stream(cfg, model, messages, temperature=None, max_tokens=None,
                      stop_flag=None):
    """Yield content pieces from an OpenAI-compatible streaming chat call.

    stop_flag: optional callable -> bool; checked between chunks so the GUI's
    Stop button works for cloud replies too.
    """
    _host, _port, path, _ssl = _cloud_parts(cfg)
    payload = {"model": model, "messages": messages, "stream": True}
    if temperature is not None:
        payload["temperature"] = temperature
    if max_tokens not in (None, -1):
        payload["max_tokens"] = max_tokens
    body = json.dumps(payload)
    conn = _cloud_conn(cfg, timeout=90)
    try:
        conn.request("POST", path, body=body, headers=_cloud_headers(cfg))
        resp = conn.getresponse()
        if resp.status != 200:
            detail = resp.read(4096).decode("utf-8", "replace")
            raise CloudError(f"cloud API error {resp.status}: {detail[:400]}")
        buf = b""
        while True:
            if stop_flag and stop_flag():
                break
            chunk = resp.read1(4096) if hasattr(resp, "read1") else resp.read(4096)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line or not line.startswith(b"data:"):
                    continue
                data = line[5:].strip()
                if data == b"[DONE]":
                    return
                try:
                    obj = json.loads(data)
                except ValueError:
                    continue
                for choice in obj.get("choices", []):
                    delta = choice.get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        yield piece
    except (CloudError, CloudUnavailable):
        raise
    except (OSError, http.client.HTTPException) as e:
        raise CloudUnavailable(f"cloud endpoint unreachable: {e}") from e
    finally:
        conn.close()


def cloud_chat(cfg, model, messages, temperature=None, max_tokens=None):
    """Non-streaming cloud chat. Returns the full reply text."""
    return "".join(cloud_chat_stream(cfg, model, messages,
                                     temperature=temperature,
                                     max_tokens=max_tokens))


def _image_to_data_url(image_path):
    ext = os.path.splitext(image_path)[1].lower().lstrip(".") or "png"
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif",
            "webp": "webp", "bmp": "bmp"}.get(ext, "png")
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:image/{mime};base64,{b64}"


def cloud_vision(cfg, model, image_path, prompt):
    """Analyze an image via an OpenAI-compatible vision model."""
    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": _image_to_data_url(image_path)}},
        ],
    }]
    return cloud_chat(cfg, model, messages)


# ---------------------------------------------------------------------------
# Local (Ollama) client — lazy-imported so the module loads without ollama
# ---------------------------------------------------------------------------


def _ollama():
    import ollama
    return ollama


def local_chat_stream(model, messages, keep_alive=None, temperature=None,
                      num_predict=None):
    """Yield (piece, done_meta) tuples from a streaming Ollama chat call.
    done_meta is None until the final chunk, then {"eval_count", "eval_duration"}."""
    ollama = _ollama()
    options = {}
    if temperature is not None:
        options["temperature"] = temperature
    if num_predict not in (None, -1):
        options["num_predict"] = num_predict
    kwargs = {"model": model, "messages": messages, "stream": True}
    if keep_alive:
        kwargs["keep_alive"] = keep_alive
    if options:
        kwargs["options"] = options
    stream = ollama.chat(**kwargs)
    for part in stream:
        piece = part.get("message", {}).get("content", "")
        meta = None
        if part.get("done"):
            meta = {
                "eval_count": part.get("eval_count"),
                "eval_duration": part.get("eval_duration"),
            }
        yield piece, meta


def local_vision(model, image_path, prompt, keep_alive=None, temperature=None):
    """Analyze an image via a local Ollama vision model. Returns text."""
    ollama = _ollama()
    kwargs = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [image_path],
        }],
    }
    if keep_alive:
        kwargs["keep_alive"] = keep_alive
    if temperature is not None:
        kwargs["options"] = {"temperature": temperature}
    resp = ollama.chat(**kwargs)
    return resp["message"]["content"]


def local_list_models():
    """Return the set of locally installed Ollama model names."""
    ollama = _ollama()
    return {m.get("model") or m.get("name") for m in ollama.list().get("models", [])}


def local_warm(model, keep_alive=None):
    """Send a 1-token throwaway prompt so the model is loaded in RAM/VRAM."""
    ollama = _ollama()
    kwargs = {
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "options": {"num_predict": 1},
    }
    if keep_alive:
        kwargs["keep_alive"] = keep_alive
    ollama.chat(**kwargs)


# ---------------------------------------------------------------------------
# Health / connectivity checks
# ---------------------------------------------------------------------------


def check_ollama(timeout=3):
    """Return (ok, detail) for the local Ollama server."""
    try:
        local_list_models()
        return True, "connected"
    except Exception as e:
        return False, str(e)


def check_cloud(cfg=None, timeout=8):
    """Return (ok, detail) for the configured cloud endpoint. Uses a 1-token
    models-list request against /models if possible, else a bare TCP connect."""
    cfg = cfg if cfg is not None else load_config()
    try:
        endpoint = _cloud_endpoint(cfg)
    except CloudUnavailable as e:
        return False, str(e)
    try:
        key = get_api_key(cfg)
    except Exception:
        key = ""
    parts = urlsplit(endpoint)
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)
    # Cheap TCP reachability first.
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
    except OSError as e:
        return False, f"unreachable: {e}"
    if not key:
        return False, "reachable but no API key set"
    # Auth check against /models (OpenAI-compatible).
    scheme = parts.scheme or "https"
    models_url = f"{scheme}://{host}:{port}" + (parts.path.rstrip("/") if parts.path else "")
    if models_url.endswith("/chat/completions"):
        models_url = models_url[: -len("/chat/completions")] + "/models"
    elif models_url.endswith("/v1"):
        models_url += "/models"
    else:
        models_url += "/v1/models"
    try:
        req = urllib.request.Request(
            models_url, headers={"Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ok = 200 <= resp.status < 300
            return (True, "authenticated") if ok else (False, f"HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code} (check API key)"
    except Exception as e:
        # Endpoint reachable but /models unsupported — still usable.
        return True, f"reachable (models list failed: {e})"


# ---------------------------------------------------------------------------
# Misc helpers
# ---------------------------------------------------------------------------


def slugify_id(name):
    """Make a registry-safe id fragment from an arbitrary model name."""
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "-", name).strip("-")


def format_bytes(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"
