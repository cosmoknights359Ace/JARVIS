lines = open(r"C:\projects\jarvis\jarvis_gui.py", encoding="utf-8").read().splitlines()
idx = [i for i, l in enumerate(lines, 1) if "def open_settings" in l]
print("open_settings at:", idx)
if idx:
    s = idx[0]
    for n in range(s, min(s + 100, len(lines) + 1)):
        print(f"{n:5d}  {lines[n-1]}")
