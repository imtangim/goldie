import { describe, expect, test } from "bun:test";
import {
  applyDesign,
  captureLocales,
  flowFor,
  fontFamilyFor,
  type LoadedConfig,
} from "./config.ts";
import { customFontKey, fontStack, withGlyphFallback } from "./fonts.ts";
import { ANDROID_TABLET_FRAME } from "./frame.ts";
import { compose, LAYOUTS } from "./layouts.ts";
import { isRtl } from "./render.ts";
import { DEVICES } from "./specs.ts";

const cfg = (extra: Partial<LoadedConfig> = {}) =>
  ({
    locales: ["en-US", "bn-BD"],
    theme: { fontFamily: '"DM Sans", sans-serif', localeFonts: { "bn-BD": '"Noto Sans Bengali"' } },
    scenes: [],
    ...extra,
  }) as unknown as LoadedConfig;

describe("fonts", () => {
  test("custom fonts resolve by key or family", () => {
    const custom = [{ family: "Noto Sans Bengali" }];
    expect(customFontKey("Noto Sans Bengali")).toBe("noto-sans-bengali");
    expect(fontStack("noto-sans-bengali", custom)).toBe('"Noto Sans Bengali", sans-serif');
    expect(fontStack("Noto Sans Bengali", custom)).toBe('"Noto Sans Bengali", sans-serif');
    expect(() => fontStack("nope", custom)).toThrow(/noto-sans-bengali/);
  });

  test("glyph fallback appends custom families once, before the CJK face", () => {
    const stack = withGlyphFallback('"DM Sans", sans-serif', [{ family: "Noto Sans Bengali" }]);
    expect(stack).toBe('"DM Sans", sans-serif, "Noto Sans Bengali", "Noto Sans SC"');
    expect(withGlyphFallback(stack, [{ family: "Noto Sans Bengali" }])).toBe(stack);
  });

  test("a locale font replaces the default font for that locale only", () => {
    const c = cfg();
    expect(fontFamilyFor(c.theme, "bn-BD")).toBe('"Noto Sans Bengali"');
    expect(fontFamilyFor(c.theme, "en-US")).toBe('"DM Sans", sans-serif');
  });

  test("design overrides merge locale fonts and clear empty ones", () => {
    const c = cfg();
    applyDesign(c, { localeFonts: { "bn-BD": "", "ar-SA": '"Noto Sans Arabic"' } });
    expect(c.theme.localeFonts).toEqual({ "ar-SA": '"Noto Sans Arabic"' });
  });
});

describe("localization", () => {
  test("capture locales follow localizedCapture", () => {
    expect(captureLocales(cfg(), ["en-US", "bn-BD"])).toEqual(["en-US"]);
    expect(captureLocales(cfg({ localizedCapture: true }), ["bn-BD"])).toEqual(["bn-BD"]);
  });

  test("locale flows override the flow", () => {
    const scene = { flow: "home", localeFlows: { "bn-BD": "home-bn" } };
    expect(flowFor(scene, "bn-BD")).toBe("home-bn");
    expect(flowFor(scene, "en-US")).toBe("home");
  });

  test("right-to-left locales", () => {
    expect(isRtl("ar-SA")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("bn-BD")).toBe(false);
  });
});

describe("android tablet", () => {
  test("spec is a portrait Play tablet within Play's size bounds", () => {
    const spec = DEVICES["pixel-tablet"];
    expect(spec.formFactor).toBe("tablet");
    const { width, height } = spec.screenshot;
    expect(height / width).toBeCloseTo(16 / 9, 3);
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(1080);
  });

  test("the bezel composes inside the tile", () => {
    const tile = DEVICES["pixel-tablet"].screenshot;
    const c = compose(
      LAYOUTS.classic,
      tile,
      { copyHeightRatio: 0.24, deviceWidthRatio: 0.84 },
      {
        geom: ANDROID_TABLET_FRAME.geom,
      },
    );
    const { frame } = c.devices[0]!;
    expect(frame.left).toBeGreaterThanOrEqual(0);
    expect(frame.left + frame.width).toBeLessThanOrEqual(tile.width);
    expect(frame.top + frame.height).toBeLessThanOrEqual(tile.height);
  });
});
