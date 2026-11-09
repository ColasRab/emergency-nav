"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { deviceHeading, smoothBearing } from "../geo/transform";
export function useCompass() {
  const [heading, setHeading] = useState<number | null>(null),
    [status, setStatus] = useState("Compass off"),
    reading = useRef<{ heading: number; at: number } | null>(null),
    handler = useRef<((e: Event) => void) | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((value: number) => {
    const smoothed = smoothBearing(reading.current?.heading ?? null, value);
    reading.current = { heading: smoothed, at: Date.now() };
    setHeading(smoothed);
    setStatus("Compass ready");
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const enable = useCallback(async () => {
    try {
      if (typeof DeviceOrientationEvent === "undefined")
        throw new Error("Compass unavailable. Use text directions.");
      const api = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
      if (
        api.requestPermission &&
        (await api.requestPermission()) !== "granted"
      )
        throw new Error("Compass permission denied. Use text directions.");
      if (handler.current) {
        window.removeEventListener("deviceorientation", handler.current);
        window.removeEventListener(
          "deviceorientationabsolute",
          handler.current,
        );
      }
      handler.current = (raw: Event) => {
        const value = deviceHeading(
          raw as DeviceOrientationEvent & { webkitCompassHeading?: number },
          screen.orientation?.angle ?? 0,
        );
        if (value !== null) update(value);
      };
      window.addEventListener("deviceorientation", handler.current);
      window.addEventListener("deviceorientationabsolute", handler.current);
      setStatus("Waiting for absolute compass…");
      timer.current = setTimeout(
        () =>
          setStatus(
            "Absolute heading unavailable. Use text directions or a manual heading.",
          ),
        5000,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Compass unavailable");
    }
  }, [update]);
  useEffect(
    () => () => {
      if (handler.current) {
        window.removeEventListener("deviceorientation", handler.current);
        window.removeEventListener(
          "deviceorientationabsolute",
          handler.current,
        );
      }
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { heading, status, reading, enable, update };
}
