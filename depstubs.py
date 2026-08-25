"""Headless dependency stubs — lets backend modules be imported and unit
tested without the heavy GUI/audio packages installed.

install() is a no-op when the real packages are present (real packages are
never replaced), so importing this in production is safe. Tests call
install() before importing app modules.
"""
import sys
import types


class _MagicAny:
    """Attribute/call chain that tolerates anything and renders sane reprs."""

    def __init__(self, name="stub"):
        self._name = name

    def __call__(self, *a, **k):
        return _MagicAny(self._name)

    def __getattr__(self, name):
        return _MagicAny(f"{self._name}.{name}")

    def __iter__(self):
        return iter(())

    def __bool__(self):
        return False

    def __repr__(self):
        return f"<stub {self._name}>"


def _module(name):
    mod = types.ModuleType(name)
    mod.__getattr__ = lambda attr, _n=name: _MagicAny(f"{_n}.{attr}")
    return mod


def install():
    """Insert stub modules for every optional heavy dependency that is not
    already importable. Returns the list of names that were stubbed."""
    names = [
        "customtkinter", "ollama", "PIL", "PIL.Image", "PIL.ImageDraw",
        "pyttsx3", "pyautogui", "psutil",
        "speech_recognition", "pyaudio",
    ]
    stubbed = []
    for name in names:
        top = name.split(".")[0]
        if top in sys.modules:
            continue
        try:
            __import__(name)
            continue
        except Exception:
            pass
        mod = _module(name)
        if name == "customtkinter":
            # Base class jarvis_gui.JarvisWindow extends. Magic attribute
            # access on instances lets the real class body do
            # `self.some_widget.configure(...)` etc. without real widgets.
            mod.CTk = type("CTk", (), {
                "__init__": lambda self, *a, **k: None,
                "__getattr__": lambda self, attr: _MagicAny(f"ctk.{attr}"),
            })
        if name == "speech_recognition":
            # caught by jarvis_gui's `except (sr.WaitTimeoutError, ...)` clauses
            mod.WaitTimeoutError = type("WaitTimeoutError", (Exception,), {})
            mod.UnknownValueError = type("UnknownValueError", (Exception,), {})
            mod.RequestError = type("RequestError", (Exception,), {})
        if name == "pyaudio":
            mod.PyAudio = _MagicAny("pyaudio.PyAudio")
        if name == "ollama":
            # jarvis_gui touches these at import/call time; give them real
            # signatures so tests can drive streaming and warm-up paths.
            mod.list = lambda: {"models": []}

            def _chat(*args, **kwargs):
                if kwargs.get("stream"):
                    return iter(())
                return {"message": {"role": "assistant", "content": ""}}

            mod.chat = _chat
        sys.modules[name] = mod
        if "." in name:
            parent, child = name.rsplit(".", 1)
            if parent in sys.modules:
                setattr(sys.modules[parent], child, mod)
        stubbed.append(name)
    return stubbed
