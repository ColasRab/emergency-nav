import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { Speaker } from "../lib/voice/speaker";
class Utterance {
  lang = "";
  volume = 1;
  rate = 1;
  voice = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
let spoken: Utterance[] = [];
const cancel = vi.fn();
beforeEach(() => {
  spoken = [];
  cancel.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    cancel,
    speak: (u: Utterance) => spoken.push(u),
    getVoices: () => [],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const announcement = (
  text: string,
  priority: "info" | "maneuver" | "emergency" = "maneuver",
) => ({ id: text, text, priority, expiresAt: 100000 });
it("interrupts information with maneuvers and all speech with emergencies", () => {
  const caption = vi.fn(),
    speaker = new Speaker(caption);
  speaker.speak(announcement("info", "info"));
  speaker.speak(announcement("turn", "maneuver"));
  speaker.speak(announcement("hazard", "emergency"));
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(spoken.map((u) => u.text)).toEqual(["info", "turn", "hazard"]);
  expect(speaker.speak(announcement("landmark", "info"))).toBe(false);
});
it("suppresses repeated speech, caps the queue and drops stale items", () => {
  const speaker = new Speaker(() => {});
  speaker.speak(announcement("first"));
  expect(speaker.speak(announcement("first"))).toBe(false);
  speaker.speak(announcement("second"));
  speaker.speak(announcement("third"));
  speaker.speak(announcement("fourth"));
  spoken[0].onend?.();
  spoken[1].onend?.();
  spoken[2].onend?.();
  expect(spoken.map((u) => u.text)).toEqual(["first", "second", "third"]);
});
it("keeps captions available when muted and never starts audio", () => {
  const caption = vi.fn(),
    speaker = new Speaker(caption);
  speaker.configure({ muted: true });
  speaker.speak(announcement("caption"));
  expect(caption).toHaveBeenCalledWith("caption", "maneuver");
  expect(spoken).toHaveLength(0);
});
it("repeats immediately when explicitly requested by the user", () => {
  const speaker = new Speaker(() => {});
  speaker.speak(announcement("turn"));
  speaker.speak(announcement("turn"), true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(spoken.map((u) => u.text)).toEqual(["turn", "turn"]);
});
