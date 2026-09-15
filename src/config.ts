import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BANNER_KEYS, type BannerLayout, bannerLayoutProblem, isBannerKey } from "./banner.ts";
import { ANDROID_FRAME, ANDROID_TABLET_FRAME, FRAME } from "./frame.ts";
import {
  type FrameGeometry,
  isLayoutKey,
  isTemplateKey,
  LAYOUT_KEYS,
  type LayoutKey,
  needsSecondCapture,
  resolveScenes,
  TEMPLATE_KEYS,
  type TemplateChoice,
} from "./layouts.ts";
import { DEVICES, type DeviceKey } from "./specs.ts";

/** Bezel art bundled in goldie's own assets/, one PNG per variant. */
export const FRAME_VARIANTS = ["17-pro-silver", "17-pro-blue", "17-pro-orange"] as const;
export type FrameVariant = (typeof FRAME_VARIANTS)[number];

export type Locale = string;

/** One still screenshot: a flow that navigates somewhere, plus the marketing copy around it. */
export type ScreenshotScene = {
  kind: "screenshot";
  id: string;
  /** Flow in the app's `.argent/flows`: a name ("home") or a path under it ("goldie/home.yaml"). Its final step captures the screenshot. */
  flow: string;
  /**
   * Per-locale replacements for `flow`, used by localized captures. A flow
   * that taps by visible text ("Settings") cannot find it once the app runs
   * in another language; point those locales at their own flow.
   */
  localeFlows?: Record<Locale, string>;
  /** Headline per locale. */
  headline: Record<Locale, string>;
  subhead?: Record<Locale, string>;
  /** Overrides the theme background for this scene. */
  background?: string;
  /** Overrides theme.layout for this scene; a key from src/layouts.ts. */
  layout?: LayoutKey;
  /**
   * Id of another screenshot scene whose capture fills the second device in
   * the duo and panorama-duo layouts. Defaults to the next scene.
   */
  secondScene?: string;
  /** Badge and image layers drawn over the background, under the device, in addition to theme.decorations. */
  decorations?: Decoration[];
};

/**
 * A layer drawn over the background and under the device. A badge is a text
 * pill in a corner; an image is any PNG placed by fractions of the tile.
 */
export type Decoration =
  | {
      kind: "badge";
      text: Record<Locale, string>;
      position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
      /** Pill fill and text color; default to the headline color on a translucent white. */
      background?: string;
      color?: string;
    }
  | {
      kind: "image";
      /** PNG relative to the config file. */
      src: string;
      /** Left and top as fractions of the tile width and height. */
      x: number;
      y: number;
      /** Width as a fraction of the tile width; the height keeps the image's aspect. */
      width: number;
      /** Degrees, clockwise, around the image centre. */
      rotate?: number;
    };

/**
 * The app preview video, built from short segments.
 *
 * Apple requires a preview to be a plain recording of the device screen, so
 * the segments are joined as captured: no bezel, background or captions.
 * Each segment is its own flow recorded into its own clip, which keeps a
 * single broken step from forcing a re-record of the whole story.
 */
export type PreviewScene = {
  kind: "preview";
  id: string;
  segments: Array<{
    id: string;
    /** Flow in the app's `.argent/flows`, same forms as a screenshot scene's. */
    flow: string;
    /** Per-locale replacements for `flow`, as on a screenshot scene. */
    localeFlows?: Record<Locale, string>;
    /** Hold the last frame this long after the flow ends, in seconds. */
    holdSeconds?: number;
  }>;
  /** Optional audio bed relative to the config file. A silent AAC track is written when absent. */
  audio?: string;
};

export type Scene = ScreenshotScene | PreviewScene;

export type Theme = {
  background: string;
  headlineColor: string;
  subheadColor: string;
  fontFamily: string;
  /**
   * CSS font stacks per locale, replacing `fontFamily` for that locale's
   * copy. For scripts the main typeface cannot draw (Bengali, Arabic, Thai,
   * Devanagari...): the exporter's canvas never falls back to system fonts,
   * so those locales need a typeface that has the glyphs, usually one of
   * the config's custom `fonts`. Example: { "bn-BD": '"Noto Sans Bengali", sans-serif' }.
   */
  localeFonts?: Record<Locale, string>;
  /** Fraction of the screenshot height reserved for copy above the device. */
  copyHeightRatio: number;
  /** Fraction of the screenshot width the device bezel occupies. */
  deviceWidthRatio: number;
  /**
   * The strip's rhythm: a built-in template key from src/layouts.ts, or a
   * custom sequence of layout keys applied to the scenes in order (repeating
   * when shorter). Scenes with their own `layout` are left alone.
   */
  template?: TemplateChoice;
  /** Layout for scenes the template does not cover; a key from src/layouts.ts. Defaults to "classic". */
  layout?: LayoutKey;
  /** Drop the bezel and show the bare screen with a soft shadow. */
  screenOnly?: boolean;
  /** Decoration layers added to every screenshot scene. */
  decorations?: Decoration[];
};

/**
 * How the app presents itself on the App Store. Used by the studio to
 * render a realistic product page around the generated assets - it is the
 * surrounding chrome that tells you whether a headline still reads at
 * gallery size.
 */
export type StoreListing = {
  name: string;
  subtitle: Record<Locale, string>;
  developer: string;
  category: string;
  /** Shown in the ratings row; purely cosmetic. */
  rating: number;
  ratingCount: string;
  ageRating: string;
  price: string;
  description: Record<Locale, string>;
};

/**
 * A typeface shipped with the app's config rather than with goldie: font
 * files (TTF, OTF, WOFF2 for the studio only) relative to the config file,
 * keyed by weight. The renderer registers them with the canvas and the
 * studio declares them via @font-face, so they render identically in both.
 * Headlines use weight 700 and subheads 400; a missing weight falls back to
 * the nearest cut.
 */
export type CustomFont = {
  /** CSS family name to use in `theme.fontFamily` / `theme.localeFonts`. */
  family: string;
  /** Font files relative to the config file, keyed by weight (400, 700...). */
  files: Record<number, string>;
  /** Generic fallbacks appended after the family in the font picker. Default "sans-serif". */
  fallback?: string;
};

/**
 * The Google Play feature graphic (1024 x 500), rendered per locale into
 * out/feature-graphic/<locale>/feature-graphic.png. On by default whenever
 * `devices` has an android device; set `enabled: false` to skip it.
 */
export type FeatureGraphic = {
  enabled?: boolean;
  /** A banner template key from src/banner.ts, or a custom { copy, devices } spec. Default "split". */
  layout?: string | BannerLayout;
  /** Headline per locale; defaults to the store name. */
  headline?: Record<Locale, string>;
  /** Subhead per locale; defaults to the store subtitle. */
  subhead?: Record<Locale, string>;
  /** Overrides the theme background for the banner. */
  background?: string;
  /** Screenshot scene ids whose captures fill the banner's devices, in order; defaults to the first scenes. */
  scenes?: string[];
  /** Device whose captures and bezel the banner shows; defaults to the first android device, else the first device. */
  device?: DeviceKey;
};

export type GoldieConfig = {
  /** Absolute path to the app repo. Holds `.argent/flows`; also used for messages and for locating the build. */
  appRoot: string;
  /**
   * Where the scene flows live. Defaults to `.argent/flows` inside `appRoot`,
   * so goldie and argent share one flow store: anything recorded with
   * `argent flow record` is replayable here by name, and vice versa. An
   * absolute path or a path relative to the config file overrides it.
   */
  flowsDir?: string;
  /** Simulator .app bundle to install. */
  appPath: string;
  bundleId: string;
  /** The .apk to install and its applicationId. Required when `devices` names an android key. */
  android?: {
    appPath: string;
    applicationId: string;
    /**
     * Bezel art for the android device, replacing the bundled Pixel 10 Pro
     * art, with its own geometry: the image (relative to the config), its
     * pixel size, the transparent screen cutout inside it, and the cutout's
     * corner radius. Android SDK emulator skins
     * (`$ANDROID_HOME/skins/<device>/`) carry exactly this: `back.webp` is the
     * frame and the `layout` file states the display rect and corner_radius;
     * punch the display rect transparent and point this at the result.
     */
    frame?: CustomFrame;
    /** Bezel art for the pixel-tablet device, replacing the bundled Pixel Tablet art; same shape as `frame`, portrait. */
    tabletFrame?: CustomFrame;
  };
  devices: DeviceKey[];
  locales: Locale[];
  /**
   * Capture the app once per locale, with the simulator or emulator switched
   * to that language, so every locale's screenshots show the app's own
   * translated UI. Off by default: a single capture in the first locale is
   * reused under each locale's headlines. Multiplies capture time by the
   * number of locales; see `localeFlows` for flows that tap by visible text.
   */
  localizedCapture?: boolean;
  /** Typefaces bundled with the config; see CustomFont. */
  fonts?: CustomFont[];
  /** The Google Play feature graphic; see FeatureGraphic. */
  featureGraphic?: FeatureGraphic;
  /** Simulator appearance for every capture. */
  appearance: "light" | "dark";
  /**
   * Device bezel art for the screenshots. Either a bundled variant from
   * assets/ (all variants share the cutout geometry in src/frame.ts) or a
   * custom PNG with a transparent screen cutout, relative to the config file.
   * Custom art means re-measuring the geometry in src/frame.ts.
   */
  frame: { variant: FrameVariant } | { image: string };
  theme: Theme;
  store: StoreListing;
  scenes: Scene[];
};

export type CustomFrame = {
  image: string;
  width: number;
  height: number;
  screen: { x: number; y: number; width: number; height: number };
  screenRadius: number;
};

export type LoadedConfig = GoldieConfig & {
  /** Directory the config file lives in; every relative path resolves against it. */
  root: string;
  /** Absolute path of the config file itself. */
  configPath: string;
  /** Absolute directory the scene flows resolve against. */
  flowsDir: string;
  outDir: string;
  /**
   * The studio's per-scene layout overrides (goldie.design.json). Kept apart
   * from the scenes so the manifest reports only the config's own layouts;
   * baked into `scene.layout` they would outrank every later template choice.
   */
  sceneLayouts?: Record<string, LayoutKey>;
  /** Feature graphic copy edited in the studio or translated, layered over its defaults. */
  featureGraphicCopy?: SceneCopy;
};

/**
 * Default config path: the GOLDIE_CONFIG env var when set, else
 * ./goldie.config.ts. The env var lets a config live in the app's own repo
 * while goldie and its studio run from this checkout.
 */
export function defaultConfigPath(): string {
  return process.env.GOLDIE_CONFIG
    ? resolve(process.env.GOLDIE_CONFIG)
    : resolve(process.cwd(), "goldie.config.ts");
}

/**
 * The config is TypeScript. Bun and Node >= 22.18 import it natively; older
 * Node lacks type stripping, so fall back to jiti, which transpiles on the fly.
 */
async function importConfig(path: string): Promise<any> {
  try {
    return await import(pathToFileURL(path).href);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (
      code !== "ERR_UNKNOWN_FILE_EXTENSION" &&
      code !== "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"
    )
      throw err;
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  }
}

export async function loadConfig(path = defaultConfigPath()): Promise<LoadedConfig> {
  if (!existsSync(path)) throw new Error(`No config at ${path}`);
  const mod = await importConfig(path);
  const cfg: GoldieConfig = mod.default ?? mod.config;
  if (!cfg) throw new Error(`${path} has no default export`);
  const root = dirname(path);
  const loaded: LoadedConfig = {
    ...cfg,
    root,
    configPath: path,
    flowsDir: cfg.flowsDir ? resolve(root, cfg.flowsDir) : resolve(cfg.appRoot, ".argent/flows"),
    outDir: resolve(root, "out"),
  };
  applyDesign(loaded, readDesign(path));
  framePath(loaded); // fail at load time on a bad variant or missing bezel PNG
  validateFonts(loaded);
  validateFeatureGraphic(loaded);
  validateLayouts(loaded);
  return loaded;
}

/**
 * Design choices made in the studio, kept next to the config as
 * goldie.design.json so they survive a reload and apply to CLI runs too.
 * Every field is optional; a missing one leaves the config's value alone.
 */
export type DesignOverrides = {
  background?: string;
  frame?: FrameVariant;
  /** A full CSS font stack, as the studio's font picker produces. */
  fontFamily?: string;
  /** Font stacks per locale; merged over theme.localeFonts. An empty string clears a locale's override. */
  localeFonts?: Record<string, string>;
  /** The locale list as arranged in the studio (added or removed languages); replaces `locales`. */
  locales?: string[];
  /** Feature graphic choices made in the studio. */
  featureGraphic?: { layout?: string; enabled?: boolean; background?: string };
  /** Fonts uploaded in the studio, stored next to the config; appended to the config's `fonts`. */
  fonts?: CustomFont[];
  /** Copy edited in the studio, per screenshot scene id, then locale. */
  copy?: Record<string, SceneCopy>;
  /** Screenshot scene ids in the order the studio arranged them. */
  order?: string[];
  /** A built-in template key; "" means none (the layout below applies to every scene). */
  template?: string;
  /** Default layout for scenes the template does not cover. */
  layout?: LayoutKey;
  screenOnly?: boolean;
  /** Layout overrides per screenshot scene id. */
  sceneLayouts?: Record<string, LayoutKey>;
};

export type SceneCopy = {
  headline?: Record<string, string>;
  subhead?: Record<string, string>;
};

/** Path of the design sidecar for a config file. */
export function designPath(configPath: string): string {
  return resolve(dirname(configPath), "goldie.design.json");
}

export function readDesign(configPath: string): DesignOverrides {
  const file = designPath(configPath);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as DesignOverrides) : {};
  } catch (err) {
    throw new Error(`Unreadable ${file}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Writes the design sidecar atomically, the way the studio server does. */
export function writeDesign(configPath: string, design: DesignOverrides): void {
  const file = designPath(configPath);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(design, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Layers design overrides (the sidecar, or CLI flags) onto a loaded config. */
export function applyDesign(cfg: LoadedConfig, design: DesignOverrides): void {
  if (design.background) {
    cfg.theme.background = design.background;
    for (const scene of cfg.scenes) if (isScreenshot(scene)) scene.background = undefined;
    // The config's copy colors assume its own background; a dark override
    // would render near-black headlines on a near-black gradient, and a
    // light override under light copy colors is just as unreadable.
    const lum = backgroundLuminance(design.background);
    if (lum !== null && lum < 0.5) {
      cfg.theme.headlineColor = "#FFFFFF";
      cfg.theme.subheadColor = "#D9E1EA";
    } else if (lum !== null) {
      if ((backgroundLuminance(cfg.theme.headlineColor) ?? 0) > 0.5) {
        cfg.theme.headlineColor = "#0E1B2A";
      }
      if ((backgroundLuminance(cfg.theme.subheadColor) ?? 0) > 0.5) {
        cfg.theme.subheadColor = "#5A6A7D";
      }
    }
  }
  if (design.frame) {
    cfg.frame = { variant: design.frame };
    framePath(cfg); // throws on an unknown variant
  }
  if (design.fontFamily) cfg.theme.fontFamily = design.fontFamily;
  if (design.localeFonts) {
    const merged = { ...cfg.theme.localeFonts, ...design.localeFonts };
    for (const [locale, stack] of Object.entries(merged)) if (!stack) delete merged[locale];
    cfg.theme.localeFonts = merged;
  }
  if (design.fonts?.length) {
    const known = new Set((cfg.fonts ?? []).map((f) => f.family));
    cfg.fonts = [...(cfg.fonts ?? []), ...design.fonts.filter((f) => !known.has(f.family))];
  }
  if (design.locales?.length) cfg.locales = [...new Set(design.locales)];
  if (design.featureGraphic) {
    const fg = { ...cfg.featureGraphic };
    if (design.featureGraphic.layout) fg.layout = design.featureGraphic.layout;
    if (design.featureGraphic.enabled !== undefined) fg.enabled = design.featureGraphic.enabled;
    if (design.featureGraphic.background) fg.background = design.featureGraphic.background;
    cfg.featureGraphic = fg;
  }
  // Kept apart from featureGraphic so its defaults (the store name and
  // subtitle) still fill the locales the edits do not cover.
  const bannerCopy = design.copy?.[FEATURE_GRAPHIC_ID];
  if (bannerCopy) {
    const prev = cfg.featureGraphicCopy ?? {};
    cfg.featureGraphicCopy = {
      headline: { ...prev.headline, ...bannerCopy.headline },
      subhead: { ...prev.subhead, ...bannerCopy.subhead },
    };
  }
  if (design.copy) {
    for (const scene of cfg.scenes) {
      const copy = design.copy[scene.id];
      if (!isScreenshot(scene) || !copy) continue;
      if (copy.headline) scene.headline = { ...scene.headline, ...copy.headline };
      if (copy.subhead) scene.subhead = { ...scene.subhead, ...copy.subhead };
    }
  }
  if (design.order) cfg.scenes = reorderScenes(cfg.scenes, design.order);
  if (design.template !== undefined) {
    cfg.theme.template = design.template ? checkedTemplate(design.template) : undefined;
  }
  if (design.layout) cfg.theme.layout = checkedLayout(design.layout);
  if (design.screenOnly !== undefined) cfg.theme.screenOnly = design.screenOnly;
  if (design.sceneLayouts) {
    const overrides: Record<string, LayoutKey> = {};
    for (const scene of cfg.scenes) {
      const key = design.sceneLayouts[scene.id];
      if (isScreenshot(scene) && key) overrides[scene.id] = checkedLayout(key);
    }
    cfg.sceneLayouts = { ...cfg.sceneLayouts, ...overrides };
  }
}

function checkedLayout(key: string): LayoutKey {
  if (!isLayoutKey(key)) {
    throw new Error(`Unknown layout "${key}". Available: ${LAYOUT_KEYS.join(", ")}`);
  }
  return key;
}

function checkedTemplate(key: string): TemplateChoice {
  if (!isTemplateKey(key)) {
    throw new Error(`Unknown template "${key}". Available: ${TEMPLATE_KEYS.join(", ")}`);
  }
  return key;
}

/** The id feature graphic copy is stored under in goldie.design.json's `copy`. */
export const FEATURE_GRAPHIC_ID = "feature-graphic";

/** The feature graphic with its defaults filled in, or null when it is off. */
export function resolvedFeatureGraphic(cfg: LoadedConfig): {
  layout: string | BannerLayout;
  headline: Record<Locale, string>;
  subhead: Record<Locale, string>;
  background: string;
  scenes: string[];
  device: DeviceKey;
} | null {
  const fg = cfg.featureGraphic ?? {};
  const android = cfg.devices.find((d) => DEVICES[d].platform === "android");
  if (fg.enabled === false || (fg.enabled === undefined && !android)) return null;
  const device = fg.device ?? android ?? cfg.devices[0];
  if (!device) return null;
  const shots = cfg.scenes.filter(isScreenshot).map((s) => s.id);
  const name = Object.fromEntries(cfg.locales.map((l) => [l, cfg.store.name]));
  return {
    layout: fg.layout ?? "split",
    headline: { ...name, ...fg.headline, ...cfg.featureGraphicCopy?.headline },
    subhead: {
      ...(fg.subhead ?? cfg.store.subtitle ?? {}),
      ...cfg.featureGraphicCopy?.subhead,
    },
    background: fg.background ?? cfg.theme.background,
    scenes: fg.scenes?.length ? fg.scenes : shots.slice(0, 3),
    device,
  };
}

/** Fails early on a banner layout key that does not exist or a malformed custom spec. */
export function validateFeatureGraphic(cfg: LoadedConfig): void {
  const layout = cfg.featureGraphic?.layout;
  if (typeof layout === "string" && !isBannerKey(layout)) {
    throw new Error(
      `Unknown feature graphic layout "${layout}". Available: ${BANNER_KEYS.join(", ")}, or a custom { copy, devices } spec`,
    );
  }
  if (layout && typeof layout === "object") {
    const problem = bannerLayoutProblem(layout);
    if (problem) throw new Error(`featureGraphic.layout: ${problem}`);
  }
  const device = cfg.featureGraphic?.device;
  if (device && !cfg.devices.includes(device)) {
    throw new Error(
      `featureGraphic.device "${device}" is not in devices (${cfg.devices.join(", ")}).`,
    );
  }
}

/**
 * Copy for a locale, falling back to the first locale that has it, so a
 * newly added language renders before it is translated. `missing` collects
 * what fell back, for one warning per run.
 */
export function copyFor(
  map: Record<string, string> | undefined,
  locale: string,
  locales: string[],
  missing?: string[],
  label?: string,
): string | undefined {
  if (!map) return undefined;
  if (map[locale] !== undefined) return map[locale];
  const source = [...locales, ...Object.keys(map)].find((l) => map[l] !== undefined);
  if (source === undefined) return undefined;
  if (missing && label) missing.push(label);
  return map[source];
}

/** Where a device's raw captures live: shared, or one locale's when captured localized. */
export function rawDir(cfg: LoadedConfig, deviceKey: DeviceKey, locale?: string): string {
  return locale
    ? resolve(cfg.outDir, "raw", deviceKey, locale)
    : resolve(cfg.outDir, "raw", deviceKey);
}

/** Absolute TTF/OTF files of the custom fonts, per family, for the canvas (it cannot read WOFF/WOFF2). */
export function canvasFontFiles(cfg: LoadedConfig): Array<{ family: string; files: string[] }> {
  return (cfg.fonts ?? []).map((font) => ({
    family: font.family,
    files: Object.values(font.files)
      .filter((file) => /\.(ttf|otf|ttc)$/i.test(file))
      .map((file) => resolve(cfg.root, file)),
  }));
}

/** The font stack a locale's copy renders with. */
export function fontFamilyFor(theme: Theme, locale: string): string {
  return theme.localeFonts?.[locale] || theme.fontFamily;
}

/** Fails at load time on a custom font whose file is missing. */
export function validateFonts(cfg: LoadedConfig): void {
  for (const font of cfg.fonts ?? []) {
    if (!font.family || !font.files || Object.keys(font.files).length === 0) {
      throw new Error(
        `A custom font needs a family and at least one file: ${JSON.stringify(font)}`,
      );
    }
    for (const file of Object.values(font.files)) {
      const path = resolve(cfg.root, file);
      if (!existsSync(path)) throw new Error(`Font "${font.family}": file not found: ${path}`);
    }
  }
}

/** The locales a capture runs in: every requested one when localizedCapture is on, else just the first. */
export function captureLocales(cfg: LoadedConfig, requested: Locale[]): Locale[] {
  if (cfg.localizedCapture) return requested;
  return [cfg.locales[0]!];
}

/** The flow a scene or segment replays in a locale: its localeFlows entry, else its flow. */
export function flowFor(
  item: { flow: string; localeFlows?: Record<Locale, string> },
  locale: string,
): string {
  return item.localeFlows?.[locale] ?? item.flow;
}

/** Every screenshot scene with the layout and second capture it renders with, in strip order. */
export function resolvedScenes(cfg: LoadedConfig) {
  return resolveScenes(cfg.scenes.filter(isScreenshot), {
    template: cfg.theme.template,
    layout: cfg.theme.layout,
    sceneLayouts: cfg.sceneLayouts,
  });
}

/**
 * Fails early on a layout or template key the config misspelt, or a
 * two-device layout whose scene has no usable second capture.
 */
export function validateLayouts(cfg: LoadedConfig): void {
  if (cfg.theme.layout) checkedLayout(cfg.theme.layout);
  const template = cfg.theme.template;
  if (Array.isArray(template)) for (const key of template) checkedLayout(key);
  else if (template) checkedTemplate(template);
  const shots = cfg.scenes.filter(isScreenshot);
  for (const { scene, layout, secondScene } of resolvedScenes(cfg)) {
    if (scene.layout) checkedLayout(scene.layout);
    if (!needsSecondCapture(layout)) continue;
    if (!secondScene) {
      throw new Error(
        `Scene "${scene.id}" uses the "${layout.key}" layout, which shows two screens, but there is no other scene to borrow from.`,
      );
    }
    if (secondScene === scene.id || !shots.some((s) => s.id === secondScene)) {
      throw new Error(
        `Scene "${scene.id}": secondScene "${secondScene}" is not another screenshot scene.`,
      );
    }
  }
}

/**
 * Puts the screenshot scenes in the saved order. Ids missing from the order
 * (scenes added to the config since) keep their config position relative to
 * each other and follow the ordered ones; unknown ids are ignored. Other
 * scenes (the preview) stay where they are.
 */
export function reorderScenes(scenes: Scene[], order: string[]): Scene[] {
  const shots = scenes.filter(isScreenshot);
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...shots].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
    return ra === rb ? shots.indexOf(a) - shots.indexOf(b) : ra - rb;
  });
  let i = 0;
  return scenes.map((s) => (isScreenshot(s) ? sorted[i++]! : s));
}

/**
 * Mean relative luminance of the value's six-digit hex colors, or null when
 * it has none (keep the config's copy colors then).
 */
export function backgroundLuminance(css: string): number | null {
  const hexes = css.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length === 0) return null;
  const luminance = (hex: string) => {
    const channel = (offset: number) => {
      const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  return hexes.reduce((sum, hex) => sum + luminance(hex), 0) / hexes.length;
}

const GOLDIE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Absolute path to a bundled bezel variant's PNG. */
export function variantFramePath(variant: FrameVariant): string {
  return resolve(GOLDIE_ROOT, "assets", `${variant}.png`);
}

/** Absolute path to the bezel PNG the config selects. */
export function framePath(cfg: LoadedConfig): string {
  let file: string;
  if ("variant" in cfg.frame) {
    if (!FRAME_VARIANTS.includes(cfg.frame.variant)) {
      throw new Error(
        `Unknown frame variant "${cfg.frame.variant}". Available: ${FRAME_VARIANTS.join(", ")}`,
      );
    }
    file = variantFramePath(cfg.frame.variant);
  } else {
    file = resolve(cfg.root, cfg.frame.image);
  }
  if (!existsSync(file)) throw new Error(`Frame image not found: ${file}`);
  return file;
}

/**
 * Bezel art a device renders with: the config's `frame` on iOS, and on
 * android the bundled Pixel 10 Pro art unless the config supplies its own
 * `android.frame`. The geometry travels with the image, since the android art
 * has a different image box and cutout than the iOS variants.
 */
export function deviceFrame(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
): { image: string; geom: FrameGeometry } {
  const spec = DEVICES[deviceKey];
  if (spec.platform !== "android") return { image: framePath(cfg), geom: FRAME };
  const tablet = spec.formFactor === "tablet";
  const custom = tablet ? cfg.android?.tabletFrame : cfg.android?.frame;
  if (custom) {
    const image = resolve(cfg.root, custom.image);
    if (!existsSync(image)) throw new Error(`Frame image not found: ${image}`);
    return { image, geom: custom };
  }
  const bundled = tablet ? ANDROID_TABLET_FRAME : ANDROID_FRAME;
  return { image: resolve(GOLDIE_ROOT, "assets", bundled.file), geom: bundled.geom };
}

/**
 * Absolute path to a scene's flow YAML. A name or a relative path resolves
 * against `flowsDir`; `.yaml` is added when the value has no extension.
 */
export function flowPath(cfg: LoadedConfig, flow: string): string {
  const file = flow.endsWith(".yaml") || flow.endsWith(".yml") ? flow : `${flow}.yaml`;
  return resolve(cfg.flowsDir, file);
}

export const isPreview = (s: Scene): s is PreviewScene => s.kind === "preview";
export const isScreenshot = (s: Scene): s is ScreenshotScene => s.kind === "screenshot";
