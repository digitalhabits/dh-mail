/**
 * Dictation, using whatever speech recognition the browser has.
 *
 * `SpeechRecognition` is not a standard: Chrome and Safari ship it under a
 * vendor prefix, and Firefox does not ship it at all. Everything here is
 * written so a browser without it reports that dictation is unavailable,
 * rather than throwing on a name that is not there.
 */

import * as React from "react";
import { mailSay } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};
function getSpeechRecognitionCtor():
  | (new () => BrowserSpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
/** Free browser dictation into a controlled text field (Chrome/Edge best). */
export function useSpeechDictation(
  value: string,
  onChange: (next: string) => void
): { listening: boolean; supported: boolean; toggle: () => void; stop: () => void } {
  const [listening, setListening] = React.useState(false);
  const [supported, setSupported] = React.useState(false);
  const recognitionRef = React.useRef<BrowserSpeechRecognition | null>(null);
  // Text committed before the current interim phrase (value at start + finals).
  const baseRef = React.useRef(value);

  React.useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionCtor()));
  }, []);

  const stop = React.useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    setListening(false);
    onChange(baseRef.current.replace(/\s+$/, ""));
  }, [onChange]);

  const toggle = React.useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error(mailSay("dictationUnsupported"));
      return;
    }
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    baseRef.current = value.trimEnd() ? `${value.trimEnd()} ` : "";

    rec.onresult = (event) => {
      let interim = "";
      let finals = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) finals += piece;
        else interim += piece;
      }
      if (finals) {
        const chunk = finals.replace(/\s+/g, " ").trim();
        if (chunk) {
          baseRef.current = `${baseRef.current}${chunk} `;
        }
      }
      onChange(`${baseRef.current}${interim}`);
    };
    rec.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      toast.error(
        event.error === "not-allowed"
          ? "Microphone permission denied"
          : `Dictation error: ${event.error}`
      );
      stop();
    };
    rec.onend = () => {
      // Chrome sometimes ends mid-session; only clear if we still own this instance.
      if (recognitionRef.current === rec) {
        recognitionRef.current = null;
        setListening(false);
        onChange(baseRef.current.replace(/\s+$/, ""));
      }
    };

    try {
      rec.start();
      setListening(true);
    } catch {
      toast.error(mailSay("couldNotStartDictation"));
      recognitionRef.current = null;
      setListening(false);
    }
  }, [listening, onChange, stop, value]);

  React.useEffect(() => () => stop(), [stop]);

  return { listening, supported, toggle, stop };
}
