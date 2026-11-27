import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, TIMING_LIMITS, defaultSettings, normalizeSettings } from "../settings";

describe("timing settings", () => {
  it("defaults to standard timing without auto-update pausing", () => {
    expect(defaultSettings().timing).toEqual({ mode: "standard", pauseAutoUpdates: false });
  });

  it("migrates stored settings that predate the timing preference", () => {
    expect(normalizeSettings({ slippageBps: 250 }).timing).toEqual(DEFAULT_SETTINGS.timing);
  });

  it("accepts extended mode and falls back to standard for unknown presets", () => {
    expect(normalizeSettings({ timing: { mode: "extended", pauseAutoUpdates: true } }).timing).toEqual({
      mode: "extended",
      pauseAutoUpdates: true,
    });
    expect(normalizeSettings({ timing: { mode: "forever" } }).timing.mode).toBe("standard");
  });

  it("gives the extended window more time than standard", () => {
    expect(TIMING_LIMITS.extended.txTimeoutS).toBeGreaterThan(TIMING_LIMITS.standard.txTimeoutS);
  });
});
