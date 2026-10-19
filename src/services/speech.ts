/**
 * Speech synthesis & recognition service for J.A.R.V.I.S
 */

export function stripMarkdownForSpeech(text: string): string {
  // Strip code blocks
  let cleaned = text.replace(/```[\s\S]*?```/g, " (code block omitted) ");
  // Strip inline code and markdown symbols
  cleaned = cleaned.replace(/[*_`#]/g, "");
  // Strip URLs
  cleaned = cleaned.replace(/https?:\/\/\S+/g, "link");
  // Limit speech length so it stays concise (up to 400 chars)
  if (cleaned.length > 400) {
    cleaned = cleaned.slice(0, 400) + "... and more.";
  }
  return cleaned.trim();
}

export class SpeechService {
  private static synth: SpeechSynthesis | null =
    typeof window !== "undefined" && "speechSynthesis" in window
      ? window.speechSynthesis
      : null;

  public static getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return this.synth.getVoices();
  }

  public static speak(
    text: string,
    options: {
      voiceName?: string;
      rate?: number;
      pitch?: number;
      onEnd?: () => void;
      onError?: () => void;
    } = {}
  ): void {
    if (!this.synth) return;
    this.stop();

    const cleanText = stripMarkdownForSpeech(text);
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 0.95;

    const voices = this.synth.getVoices();
    if (options.voiceName) {
      const selected = voices.find((v) => v.name === options.voiceName);
      if (selected) utterance.voice = selected;
    } else {
      // Pick an English or robotic-sounding voice if available
      const preferred = voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          (v.name.includes("Natural") ||
            v.name.includes("Google") ||
            v.name.includes("Daniel") ||
            v.name.includes("David"))
      );
      if (preferred) utterance.voice = preferred;
    }

    if (options.onEnd) utterance.onend = options.onEnd;
    if (options.onError) utterance.onerror = options.onError;

    this.synth.speak(utterance);
  }

  public static stop(): void {
    if (!this.synth) return;
    try {
      this.synth.cancel();
    } catch {
      // ignore
    }
  }

  public static isSpeaking(): boolean {
    return Boolean(this.synth && this.synth.speaking);
  }
}

// Browser SpeechRecognition interface
export interface SpeechRecognitionResultListener {
  (transcript: string, isFinal: boolean): void;
}

export class DictationService {
  private static recognition: any = null;
  private static isListening: boolean = false;

  public static isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  public static start(
    onResult: SpeechRecognitionResultListener,
    onStatusChange: (listening: boolean) => void,
    onError: (err: any) => void
  ): boolean {
    if (!this.isSupported()) return false;
    this.stop();

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    try {
      this.recognition = new SpeechRecognitionClass();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = "en-US";

      this.recognition.onstart = () => {
        this.isListening = true;
        onStatusChange(true);
      };

      this.recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          onResult(finalTranscript, true);
        } else if (interimTranscript) {
          onResult(interimTranscript, false);
        }
      };

      this.recognition.onerror = (event: any) => {
        this.isListening = false;
        onStatusChange(false);
        onError(event.error);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        onStatusChange(false);
      };

      this.recognition.start();
      return true;
    } catch (e) {
      onError(e);
      return false;
    }
  }

  public static stop(): void {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.isListening = false;
  }
}
