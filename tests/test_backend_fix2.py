"""Fix #2 verification: backend request-assembly helpers (pure, no Tkinter)."""
import jarvis_backend as b


def test_system_prompt_empty():
    p = b.build_system_prompt({})
    assert "User memory:" in p
    assert "(no memories stored yet)" in p
    # empty values are skipped too
    p2 = b.build_system_prompt({"a": "", "b": "  "})
    assert "(no memories stored yet)" in p2


def test_system_prompt_with_memory():
    p = b.build_system_prompt({"name": "Vinod", "lang": "Python"})
    assert "name: Vinod" in p
    assert "lang: Python" in p
    assert "You are Jarvis" in p


def test_build_request_messages_caps_context():
    hist = [{"role": "user", "content": str(i)} for i in range(10)]
    msgs = b.build_request_messages(hist, "SYS", max_context=6)
    assert msgs[0] == {"role": "system", "content": "SYS"}
    # only the last 6 history entries + system
    assert len(msgs) == 7
    assert msgs[-1]["content"] == "9"
    assert msgs[1]["content"] == "4"


def test_open_provider_stream_local(monkeypatch):
    """open_provider_stream must route to the LOCAL provider for a local spec."""
    captured = {}

    def fake_local(model, messages, keep_alive=None, temperature=None,
                   num_predict=None):
        captured["kind"] = "local"
        captured["model"] = model
        captured["keep_alive"] = keep_alive
        captured["num_predict"] = num_predict
        captured["temperature"] = temperature
        return iter([("hi ", None), ("there", {"eval_count": 2})])

    monkeypatch.setattr(b.providers, "local_chat_stream", fake_local)
    spec = b.providers.ModelSpec("qwen2.5:3b", "local", "qwen2.5:3b", "general")
    out = list(b.open_provider_stream(
        {}, spec, [{"role": "user", "content": "x"}],
        keep_alive="30m", temperature=0.4, num_predict=-1))
    assert captured["kind"] == "local"
    assert captured["model"] == "qwen2.5:3b"
    assert captured["keep_alive"] == "30m"
    assert captured["num_predict"] is None  # -1 -> None passthrough
    assert out == [("hi ", None), ("there", {"eval_count": 2})]


def test_open_provider_stream_cloud(monkeypatch):
    captured = {}

    def fake_cloud(cfg, model, messages, temperature=None, max_tokens=None,
                   stop_flag=None):
        captured["kind"] = "cloud"
        captured["model"] = model
        captured["max_tokens"] = max_tokens
        return iter([("c", None)])

    monkeypatch.setattr(b.providers, "cloud_chat_stream", fake_cloud)
    spec = b.providers.ModelSpec("cloud/openai/kimi/kimi-k3", "cloud",
                                 "openai/kimi/kimi-k3", "general")
    list(b.open_provider_stream({}, spec, [], num_predict=512))
    assert captured["kind"] == "cloud"
    assert captured["max_tokens"] == 512


if __name__ == "__main__":
    test_system_prompt_empty()
    test_system_prompt_with_memory()
    test_build_request_messages_caps_context()
    test_open_provider_stream_local(None)
    test_open_provider_stream_cloud(None)
    print("FIX2 OK (manual, no monkeypatch)")
