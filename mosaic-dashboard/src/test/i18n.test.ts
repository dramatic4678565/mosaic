import { describe, expect, it } from "vitest";

import { BRAND } from "@mosaic/brand";

import { getLocale, setLocale, t, translationKeys } from "@/lib/i18n";

describe("i18n", () => {
  it("returns the English string for a known key", () => {
    expect(t("nav.allBoards")).toBe("All boards");
    expect(t("board.empty.title")).toBe("No boards yet");
  });

  it("falls back to the key itself when a translation is missing", () => {
    // Loud failure beats an empty label in the UI.
    expect(t("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("interpolates {name} placeholders", () => {
    expect(t("activity.stats", { count: 3, recent: 2 })).toBe(
      "3 edits · 2 this week",
    );
    expect(t("settings.usage", { boards: 5, folders: 2 })).toBe(
      "Using 5 boards and 2 folders",
    );
  });

  it("leaves unknown placeholders untouched rather than printing undefined", () => {
    expect(t("board.bulk.selected", { wrong: 1 })).toBe("{count} selected");
  });

  it("returns the template unchanged when no values are supplied", () => {
    expect(t("board.bulk.selected")).toBe("{count} selected");
  });

  it("setLocale ignores locales that have no dictionary", () => {
    setLocale("fr-FR");
    expect(getLocale()).toBe("en");
    expect(t("nav.allBoards")).toBe("All boards");
  });
});

describe("brand constants", () => {
  /**
   * The dashboard must render Mosaic, never the upstream product name. Asserting
   * it here means a future brand edit that flips the name fails fast in unit
   * tests rather than showing up as a screenshot.
   */
  it("BRAND.name is Mosaic", () => {
    expect(BRAND.name).toBe("Mosaic");
    expect(BRAND.slug).toBe("mosaic");
    expect(BRAND.title).toContain("Mosaic");
  });

  it("every dashboard string is Mosaic-branded, not Excalidraw", () => {
    // `.excalidraw` is a real on-disk format that boards can still be exported
    // to, so those two menu labels legitimately name it. Everything else must be
    // Mosaic-branded.
    const ALLOWED = new Set([
      "board.download.excalidraw",
      "board.download.mosaic",
    ]);

    const offenders = translationKeys().filter(
      (key) => !ALLOWED.has(key) && /excalidraw/i.test(t(key)),
    );
    expect(offenders).toEqual([]);
  });
});
