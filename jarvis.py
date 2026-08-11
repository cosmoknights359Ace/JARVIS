import ollama
import os
import json
import pyttsx3

# Memory functions
def load_memory():
    try:
        with open("memory.json", "r") as f:
            return json.load(f)
    except:
        return {}

def save_memory(memory):
    with open("memory.json", "w") as f:
        json.dump(memory, f, indent=4)

memory = load_memory()
engine = pyttsx3.init()

def speak(text):
    engine.say(text)
    engine.runAndWait()
messages = []

print("Jarvis online. Type 'exit' to quit.\n")

while True:
    user_input = input("You: ")

    if user_input.lower() == "exit":
        print("Jarvis: Goodbye!")
        break

    # Memory commands
    if user_input.lower().startswith("remember "):
        info = user_input[9:]

        if "=" in info:
            key, value = info.split("=", 1)
            memory[key.strip()] = value.strip()
            save_memory(memory)

            print(f"Jarvis: Saved memory -> {key.strip()} = {value.strip()}")
        else:
            print("Jarvis: Use format: remember key=value")

        continue

    if user_input.lower().startswith("recall "):
        key = user_input[7:].strip()

        if key in memory:
            print(f"Jarvis: {key} = {memory[key]}")
        else:
            print("Jarvis: I don't know that yet.")
    if user_input.lower() == "show memory":
        if memory:

            print("\nJarvis Memory:")

            for key, value in memory.items():
                print(f"{key} = {value}")

            print()

        else:
            print("Jarvis: Memory is empty.")

        continue

    if user_input.lower().startswith("forget "):

        key = user_input[7:].strip()

        

    if key in memory:
        del memory[key]
        save_memory(memory)

        print(f"Jarvis: Forgot {key}.")
    else:
        print("Jarvis: I don't know that memory.")

    continue 

    # App commands
    if user_input.lower() == "open vscode":
        os.system("code")
        print("Jarvis: Opening VS Code...")
        speak("Opening VS Code")
        continue

    if user_input.lower() == "open chrome":
        os.system("start chrome")
        print("Jarvis: Opening Chrome...")
        speak("Opening Chrome")
        continue

    if user_input.lower() == "open downloads":
        os.system("explorer %USERPROFILE%\\Downloads")
        print("Jarvis: Opening Downloads...")
        speak("Opening Downloads:")
        continue

    # Normal AI chat
    messages.append({
        "role": "user",
        "content": user_input
    })
    memory_text = "\n".join(
        [f"{key}: {value}" for key, value in memory.items()]
    )

    system_message = {
        "role": "system",
        "content": f"""
You are Jarvis, Vaishnav's personal AI assistant.

Known information:
{memory_text}

Use this information when answering questions.
"""
    }

    response = ollama.chat(
        model="qwen2.5-coder:7b",
        messages=[system_message] + messages
    )

    reply = response["message"]["content"]

    messages.append({
        "role": "assistant",
        "content": reply
    })

    print(f"\nJarvis: {reply}\n")
    speak(reply)
