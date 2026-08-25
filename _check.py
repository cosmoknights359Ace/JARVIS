import re, collections
src = open(r"C:\projects\jarvis\jarvis_gui.py", encoding="utf-8").read()

defs = re.findall(r"(?m)^def ([A-Za-z_]\w*)\(", src)
dupes = [n for n, c in collections.Counter(defs).items() if c > 1]
print("duplicate defs:", dupes or "NONE")

for pat in ["_stream_insert", "entry.get()", "entry.delete(0", "entry.insert(0",
            "concise personal AI assistant", "Answer concisely"]:
    print(repr(pat).ljust(45), "occurrences:", src.count(pat))

print("---")
for name in ["_history_tail", "_render_markup", "append_user_message",
             "append_assistant_message", "_set_entry", "_clear_entry",
             "save_chat_txt", "_write_chat_export", "_build_system_message",
             "_ts", "_vision_busy"]:
    ndef = len(re.findall(r"(?m)^def " + name + r"\(", src))
    nuse = len(re.findall(r"\b" + name + r"\b", src))
    print(name.ljust(25), "defs=", ndef, "refs=", nuse)

# tk usage sanity
print("---")
print("import tkinter as tk present:", "import tkinter as tk" in src)
print("tk. usages:", len(re.findall(r"\btk\.", src)))
