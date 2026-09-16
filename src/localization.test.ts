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
import { compose, LAYOUTS, TYPE } from "./layouts.ts";
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
  test("spec is a landscape Play tablet within Play's size bounds", () => {
    const spec = DEVICES["pixel-tablet"];
    expect(spec.formFactor).toBe("tablet");
    const { width, height } = spec.screenshot;
    expect(width / height).toBeCloseTo(16 / 9, 3);
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(1080);
    expect(Math.max(width, height)).toBeLessThanOrEqual(7680);
    // Rotating the emulator breaks argent's tap coordinates, so captures stay
    // in the device's natural (landscape) orientation.
    expect(spec.userRotation ?? 0).toBe(0);
  });

  test("a landscape tile composes in its own aspect, not the phone column", () => {
    const tile = DEVICES["pixel-tablet"].screenshot;
    const c = compose(
      LAYOUTS.classic,
      tile,
      { copyHeightRatio: 0.24, deviceWidthRatio: 0.84 },
      {
        geom: ANDROID_TABLET_FRAME.geom,
      },
    );
    // No portrait reference column: the device uses the full wide tile.
    expect(c.devices[0]!.frame.width).toBeGreaterThan(tile.width * 0.5);
    // Type scales from the height, so the headline stays near a phone tile's
    // optical size instead of the 210px a 2560px-wide tile would give.
    const headline = c.designWidth * TYPE.headlineSize;
    expect(headline).toBeGreaterThan(80);
    expect(headline).toBeLessThan(130);
    // The copy block wraps at a readable measure, not the full 16:9 span.
    expect(c.copy!.maxWidth).toBeLessThan(tile.width * 0.7);
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

describe("feature graphic", () => {
  test("every built-in banner composes inside a 1024x500 canvas", async () => {
    const { BANNER_KEYS, BANNER_LAYOUTS, composeBanner } = await import("./banner.ts");
    for (const key of BANNER_KEYS) {
      const c = composeBanner(BANNER_LAYOUTS[key]);
      expect(c.width).toBe(1024);
      expect(c.height).toBe(500);
      for (const d of c.devices) {
        for (const v of Object.values({ ...d.frame, ...d.screen }))
          expect(Number.isFinite(v)).toBe(true);
        // A device may bleed off an edge but its centre stays on the banner.
        expect(d.frame.left + d.frame.width / 2).toBeGreaterThan(0);
        expect(d.frame.left + d.frame.width / 2).toBeLessThan(1024);
      }
      if (c.copy) expect(c.copy.maxWidth).toBeLessThanOrEqual(1024);
    }
  });

  test("custom banner specs are validated", async () => {
    const { bannerLayoutProblem } = await import("./banner.ts");
    expect(bannerLayoutProblem({ copy: null, devices: [] })).toBeNull();
    expect(
      bannerLayoutProblem({ copy: { x: 0, y: 0.5, width: 0.5, align: "middle" }, devices: [] }),
    ).toMatch(/align/);
    expect(bannerLayoutProblem({ copy: null, devices: [{ x: 1 }] })).toMatch(/height/);
  });

  test("defaults come from the store listing, edits layer over them", async () => {
    const { resolvedFeatureGraphic } = await import("./config.ts");
    const c = cfg({
      devices: ["pixel-10-pro"],
      store: { name: "Walley", subtitle: { "en-US": "Money, sorted", "bn-BD": "টাকা" } },
      scenes: [{ kind: "screenshot", id: "home", flow: "home", headline: {} }],
    } as unknown as Partial<LoadedConfig>);
    applyDesign(c, { copy: { "feature-graphic": { subhead: { "bn-BD": "হিসাব" } } } });
    const fg = resolvedFeatureGraphic(c)!;
    expect(fg.headline["en-US"]).toBe("Walley");
    expect(fg.subhead).toEqual({ "en-US": "Money, sorted", "bn-BD": "হিসাব" });
    expect(fg.scenes).toEqual(["home"]);
    expect(fg.device).toBe("pixel-10-pro");
  });

  test("off without an android device unless enabled", async () => {
    const { resolvedFeatureGraphic } = await import("./config.ts");
    const base = { devices: ["iphone-6.9"], store: { name: "A", subtitle: {} }, scenes: [] };
    expect(resolvedFeatureGraphic(cfg(base as unknown as Partial<LoadedConfig>))).toBeNull();
    const on = cfg({
      ...base,
      featureGraphic: { enabled: true },
    } as unknown as Partial<LoadedConfig>);
    expect(resolvedFeatureGraphic(on)?.device).toBe("iphone-6.9");
  });
});

describe("languages", () => {
  test("copy falls back to the source locale and reports it", async () => {
    const { copyFor } = await import("./config.ts");
    const missing: string[] = [];
    expect(copyFor({ "en-US": "Hi" }, "de-DE", ["en-US", "de-DE"], missing, "home headline")).toBe(
      "Hi",
    );
    expect(missing).toEqual(["home headline"]);
    expect(copyFor({ "en-US": "Hi", "de-DE": "Hallo" }, "de-DE", ["en-US"])).toBe("Hallo");
  });

  test("design locales replace the config's list", () => {
    const c = cfg();
    applyDesign(c, { locales: ["en-US", "ja", "ja"] });
    expect(c.locales).toEqual(["en-US", "ja"]);
  });

  test("translations merge into the design copy by key", async () => {
    const { mergeTranslations, parseCopyKey } = await import("./translate.ts");
    expect(parseCopyKey("feature-graphic.subhead")).toEqual({
      id: "feature-graphic",
      field: "subhead",
    });
    expect(parseCopyKey("home.title")).toBeNull();
    const d = mergeTranslations({ copy: { home: { headline: { "en-US": "Hi" } } } }, "de-DE", {
      "home.headline": "Hallo",
      "stats.subhead": "Mehr",
    });
    expect(d.copy).toEqual({
      home: { headline: { "en-US": "Hi", "de-DE": "Hallo" } },
      stats: { subhead: { "de-DE": "Mehr" } },
    });
  });

  test("language codes", async () => {
    const { isLocaleCode, localeName } = await import("./locales.ts");
    for (const ok of ["bn", "bn-BD", "zh-Hans", "zh-Hant-TW", "es-419"])
      expect(isLocaleCode(ok)).toBe(true);
    for (const bad of ["english", "BN-bd", "bn_BD", ""]) expect(isLocaleCode(bad)).toBe(false);
    expect(localeName("bn-BD")).toBe("Bengali (Bangladesh)");
  });
});
