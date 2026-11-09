"use client";
import { useEffect, useRef, useState } from "react";
import { floorNumber, type BuildingConfig } from "@/lib/buildings";
import {
  instructionText,
  phrase,
  type Language,
  type NextInstruction,
  type PhraseKey,
} from "@/lib/voice/instructionBuilder";
import { InstructionScheduler, type Priority } from "@/lib/voice/scheduler";
import { Speaker } from "@/lib/voice/speaker";
export type VoiceEvent = {
  id: number;
  key: PhraseKey;
  priority: Priority;
  floor?: number;
};
export default function VoiceGuide({
  instruction,
  config,
  event,
  enabled,
  onStart,
}: {
  instruction: NextInstruction | null;
  config: BuildingConfig;
  event: VoiceEvent | null;
  enabled: boolean;
  onStart: () => void;
}) {
  const [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(1),
    [language, setLanguage] = useState<Language>("en"),
    [voiceURI, setVoiceURI] = useState(""),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]),
    [caption, setCaption] = useState(""),
    [priority, setPriority] = useState<Priority>("info");
  const speaker = useRef<Speaker | null>(null),
    scheduler = useRef(
      new InstructionScheduler(config.settings.voice.cooldownMs),
    ),
    last = useRef(""),
    lastEvent = useRef<number | null>(null),
    enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    speaker.current = new Speaker((text, p) => {
      last.current = text;
      setCaption(text);
      setPriority(p);
    }, config.settings.voice.cooldownMs);
    if (typeof speechSynthesis !== "undefined") {
      const refresh = () => setVoices(speechSynthesis.getVoices());
      refresh();
      speechSynthesis.addEventListener("voiceschanged", refresh);
      return () => {
        speechSynthesis.removeEventListener("voiceschanged", refresh);
        speaker.current?.cancel();
      };
    }
    return () => speaker.current?.cancel();
  }, [config.id]);
  useEffect(() => {
    speaker.current?.configure({
      muted,
      volume,
      language: language === "fil" ? "fil-PH" : "en-US",
      voiceURI,
    });
  }, [muted, volume, language, voiceURI, config.id]);
  useEffect(() => {
    if (!enabled) {
      speaker.current?.cancel();
      scheduler.current.reset();
      return;
    }
    if (!instruction) return;
    const v = config.settings.voice;
    const text = instructionText(instruction, language, config);
    const announcement = scheduler.current.trigger(
      instruction,
      text,
      Date.now(),
      v.advanceM,
      v.immediateM,
    );
    if (announcement) {
      speaker.current?.speak(announcement);
      if (instruction.distanceM <= v.immediateM && "vibrate" in navigator)
        navigator.vibrate(
          instruction.kind.includes("left")
            ? [150, 80, 150]
            : instruction.kind.includes("right")
              ? [300]
              : instruction.kind === "arrival"
                ? [100, 60, 100, 60, 300]
                : [],
        );
    }
  }, [instruction, language, config, enabled]);
  useEffect(() => {
    if (!event || lastEvent.current === event.id) return;
    lastEvent.current = event.id;
    if (!enabledRef.current) return;
    if (
      event.key === "reroute" ||
      event.key === "offroute" ||
      event.key === "blocked"
    )
      scheduler.current.reset();
    speaker.current?.speak({
      id: `event:${event.id}`,
      text: phrase(event.key, language, {
        floor: floorNumber(config, event.floor ?? 0),
      }),
      priority: event.priority,
      expiresAt: Date.now() + 5000,
    });
  }, [event, language]);
  return (
    <section className="voice-controls" aria-label="Voice guidance">
      <p className="caption">
        {caption || "Start navigation to enable spoken guidance."}
      </p>
      <span className="sr-only" aria-live="polite">
        {priority !== "emergency" ? caption : ""}
      </span>
      <span className="sr-only" aria-live="assertive">
        {priority === "emergency" ? caption : ""}
      </span>
      <div className="button-row">
        {!enabled && (
          <button
            onClick={() => {
              speaker.current?.unlock();
              scheduler.current.reset();
              onStart();
              speaker.current?.speak(
                {
                  id: "start",
                  text: phrase("start", language),
                  priority: "info",
                  expiresAt: Date.now() + 5000,
                },
                true,
              );
            }}
          >
            Start navigation
          </button>
        )}
        <button aria-pressed={muted} onClick={() => setMuted((v) => !v)}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          disabled={!last.current}
          onClick={() =>
            speaker.current?.speak(
              {
                id: "repeat",
                text: last.current,
                priority: "maneuver",
                expiresAt: Date.now() + 5000,
              },
              true,
            )
          }
        >
          Repeat instruction
        </button>
      </div>
      <details>
        <summary>Voice settings</summary>
        <label>
          Language
          <select
            value={language}
            onChange={(e) => {
              speaker.current?.cancel();
              scheduler.current.reset();
              setLanguage(e.target.value as Language);
              setVoiceURI("");
            }}
          >
            <option value="en">English</option>
            <option value="fil">Filipino</option>
          </select>
        </label>
        <label>
          Volume
          <input
            type="range"
            min="0"
            max="1"
            step=".1"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        <label>
          Voice
          <select
            value={voiceURI}
            onChange={(e) => setVoiceURI(e.target.value)}
          >
            <option value="">Device default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        {!voices.some((v) =>
          v.lang.toLowerCase().startsWith(language === "fil" ? "fil" : "en"),
        ) && (
          <p className="status-warning">
            This device has no matching voice. Captions remain available;
            install a matching system voice for speech.
          </p>
        )}
      </details>
    </section>
  );
}
