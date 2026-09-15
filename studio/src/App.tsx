import {
  CameraIcon,
  type LucideIcon,
  SmartphoneIcon,
  TabletIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "./components/EmptyState";
import { FeatureGraphic } from "./components/FeatureGraphic";
import { Sidebar } from "./components/Sidebar";
import { copyColors, Strip } from "./components/Strip";
import { useHistory } from "./lib/useHistory";
import {
  type BundledFont,
  DEVICE_TYPES,
  type Design,
  type DeviceEntry,
  type DeviceType,
  deviceTypeOf,
  FEATURE_GRAPHIC_ID,
  loadDesign,
  loadManifest,
  ManifestError,
  type SavedDesign,
  type SceneCopy,
  type StoreManifest,
  saveDesign,
  translateCopy,
  uploadFont,
} from "./manifest";

/** Sentinel for the config's own layout sequence, which the studio can show but not edit. */
export const CUSTOM_TEMPLATE = "__custom__";

/**
 * Shown when a device tab is selected but none of its devices is in the
 * config. The chip holds the ask to hand a coding agent, which knows the
 * config changes and capture steps from the goldie skill.
 */
const ENABLE_DEVICE_TYPE: Record<
  DeviceType,
  { icon: LucideIcon; title: string; body: string; command: string }
> = {
  iphone: {
    icon: SmartphoneIcon,
    title: "No App Store screenshots yet",
    body: "Ask your coding agent to set them up:",
    command: "create App Store screenshots using goldie",
  },
  android: {
    icon: SmartphoneIcon,
    title: "No Google Play screenshots yet",
    body: "Ask your coding agent to set them up:",
    command: "create Google Play screenshots using goldie",
  },
  "android-tablet": {
    icon: TabletIcon,
    title: "No Google Play tablet screenshots yet",
    body: "Add pixel-tablet to the config's devices, or ask your coding agent:",
    command: "create Google Play tablet screenshots using goldie",
  },
};

/** How long the design must sit still before it is written to disk. */
const SAVE_DEBOUNCE_MS = 500;

export function App() {
  const [loaded, setLoaded] = useState<{ manifest: StoreManifest; design: SavedDesign } | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    Promise.all([loadManifest(), loadDesign()])
      .then(([manifest, design]) => setLoaded({ manifest, design }))
      .catch((e: Error) => setError(e));
  }, []);

  if (error)
    return (
      <EmptyState
        icon={TriangleAlertIcon}
        title="The studio could not load"
        body={error.message}
        command={error instanceof ManifestError ? error.command : undefined}
      />
    );
  if (!loaded) return null;
  return <Loaded manifest={loaded.manifest} saved={loaded.design} />;
}

/**
 * All design state lives here as plain React state: the strip composites the
 * scenes in the browser, so a background or frame change repaints instantly.
 * The CLI only runs when the sidebar's Export button asks for the final files.
 *
 * Two things survive a reload. The design choices (background, frame, font,
 * layout and screen-only mode, per-scene layout overrides, copy edited in the
 * lightbox, the order tiles were dragged into)
 * are written to goldie.design.json next to the config, debounced, so the
 * CLI picks them up too. The view choices (platform, device, locale, dark) only matter
 * here and live in localStorage under the app's name. Either falls back to
 * the config when a stored value no longer applies (a device or frame
 * variant removed from the config, for instance).
 */
function Loaded({ manifest, saved }: { manifest: StoreManifest; saved: SavedDesign }) {
  const design = manifest.design;
  const view = loadView(manifest.app.name);
  // Every device tab renders even when its devices are not configured, so
  // the tab is view state of its own: an unconfigured tab has no device key
  // to derive it from. Views saved before tablets stored a platform instead.
  const savedType = view.deviceType ?? (view.platform === "ios" ? "iphone" : view.platform);
  const viewDevice = manifest.devices.find((d) => d.key === view.device);
  const initialType: DeviceType = DEVICE_TYPES.includes(savedType as DeviceType)
    ? (savedType as DeviceType)
    : viewDevice
      ? deviceTypeOf(viewDevice)
      : manifest.devices[0]
        ? deviceTypeOf(manifest.devices[0])
        : "iphone";
  const [deviceType, setDeviceType] = useState(initialType);
  const [device, setDevice] = useState(() => {
    const devices = manifest.devices.filter((d) => deviceTypeOf(d) === initialType);
    return devices.some((d) => d.key === view.device)
      ? (view.device as string)
      : (devices[0]?.key ?? manifest.devices[0]?.key ?? "");
  });
  const selectDeviceType = (t: DeviceType) => {
    setDeviceType(t);
    const devices = manifest.devices.filter((d) => deviceTypeOf(d) === t);
    if (devices.length > 0 && !devices.some((d) => d.key === device)) setDevice(devices[0]!.key);
  };
  const initialLocales = saved.locales?.length ? saved.locales : manifest.locales;
  const [locale, setLocale] = useState(
    view.locale && initialLocales.includes(view.locale) ? view.locale : (initialLocales[0] ?? ""),
  );
  const [dark, setDark] = useState(
    new URLSearchParams(window.location.search).get("dark") === "1" || view.dark === true,
  );
  const knownLayout = (key: string | undefined) =>
    key && design.layouts.some((l) => l.key === key) ? key : undefined;
  const { state, set } = useHistory<DesignState>(() => ({
    background: saved.background ?? design.theme.background,
    frame:
      saved.frame && design.frameVariants.includes(saved.frame)
        ? saved.frame
        : (design.frameVariant ?? ""),
    fontFamily: saved.fontFamily ?? design.theme.fontFamily,
    localeFonts: { ...design.theme.localeFonts, ...saved.localeFonts },
    copy: saved.copy ?? {},
    layout: knownLayout(saved.layout) ?? design.layout,
    template: initialTemplate(design, saved),
    screenOnly: saved.screenOnly ?? design.screenOnly,
    sceneLayouts: initialSceneLayouts(design, saved, knownLayout),
    order: initialOrder(design, saved),
    locales: initialLocales,
    bannerLayout: saved.featureGraphic?.layout ?? design.featureGraphic?.layout ?? "split",
  }));
  const {
    background,
    frame,
    fontFamily,
    localeFonts,
    copy,
    layout,
    template,
    screenOnly,
    sceneLayouts,
    order,
    locales,
    bannerLayout,
  } = state;
  // Each setter names its field so a burst of edits to one control (a drag
  // on the gradient picker) collapses into a single undo step.
  const field =
    <K extends keyof DesignState>(key: K) =>
    (value: DesignState[K]) =>
      set(key, (prev) => ({ ...prev, [key]: value }));
  const setBackground = field("background");
  const setFrame = field("frame");
  const setFontFamily = field("fontFamily");
  // The current locale's font; "" follows the default font.
  const setLocaleFont = (stack: string) =>
    set(`localeFont:${locale}`, (prev) => ({
      ...prev,
      localeFonts: { ...prev.localeFonts, [locale]: stack },
    }));

  // Bundled and config fonts, plus any uploaded this session. Uploads are
  // saved server-side (goldie.design.json), not through the undo stack.
  const [fonts, setFonts] = useState<BundledFont[]>(design.fonts);
  const addFont = async (file: File, family: string, weight: number) => {
    const font = await uploadFont(file, family, weight);
    setFonts((prev) => [...prev.filter((f) => f.family !== font.family), font]);
    return font;
  };
  const setLayout = field("layout");
  const setLocales = field("locales");
  const setBannerLayout = field("bannerLayout");
  // Picking a template replaces the strip's layout sequence, so any per-scene
  // overrides made against the previous one are dropped with it.
  const setTemplate = (value: string) =>
    set("template", (prev) => ({ ...prev, template: value, sceneLayouts: {} }));
  const setScreenOnly = field("screenOnly");
  const setOrder = field("order");
  // Per-scene layout overrides; a scene absent there follows the default above.
  const setSceneLayout = (sceneId: string, key: string | undefined) =>
    set("sceneLayouts", (prev) => {
      const next = { ...prev.sceneLayouts };
      if (key) next[sceneId] = key;
      else delete next[sceneId];
      return { ...prev, sceneLayouts: next };
    });
  const setSceneCopy = (sceneId: string, fieldName: "headline" | "subhead", text: string) =>
    set(`copy:${sceneId}:${fieldName}`, (prev) => ({
      ...prev,
      copy: {
        ...prev.copy,
        [sceneId]: {
          ...prev.copy[sceneId],
          [fieldName]: { ...prev.copy[sceneId]?.[fieldName], [locale]: text },
        },
      },
    }));

  // Copy as shown: studio edits over the config's copy, per id and field.
  const textOf = (id: string, fieldName: "headline" | "subhead", code: string) => {
    const edited = copy[id]?.[fieldName]?.[code];
    if (edited !== undefined) return edited;
    if (id === FEATURE_GRAPHIC_ID) return design.featureGraphic?.[fieldName][code];
    return design.scenes.find((sc) => sc.id === id)?.[fieldName]?.[code];
  };
  const copyKeys = [
    ...design.scenes.flatMap((sc) => [
      [sc.id, "headline"] as const,
      ...(sc.subhead ? [[sc.id, "subhead"] as const] : []),
    ]),
    ...(design.featureGraphic
      ? [[FEATURE_GRAPHIC_ID, "headline"] as const, [FEATURE_GRAPHIC_ID, "subhead"] as const]
      : []),
  ];
  const sourceLocale = locales[0] ?? locale;
  const missingIn = (code: string) =>
    copyKeys.filter(([id, f]) => textOf(id, f, sourceLocale) && textOf(id, f, code) === undefined)
      .length;

  // Translations land as ordinary copy edits: undoable and saved with the design.
  const [translating, setTranslating] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const translate = async (codes: string[]) => {
    setTranslateError(null);
    for (const code of codes) {
      const texts: Record<string, string> = {};
      for (const [id, f] of copyKeys) {
        const text = textOf(id, f, sourceLocale);
        if (text && textOf(id, f, code) === undefined) texts[`${id}.${f}`] = text;
      }
      if (Object.keys(texts).length === 0) continue;
      setTranslating(code);
      try {
        const done = await translateCopy({
          from: sourceLocale,
          to: code,
          appName: manifest.app.name,
          texts,
        });
        set(`translate:${code}`, (prev) => {
          const next = { ...prev.copy };
          for (const [key, text] of Object.entries(done)) {
            const dot = key.lastIndexOf(".");
            const id = key.slice(0, dot);
            const f = key.slice(dot + 1) as "headline" | "subhead";
            next[id] = { ...next[id], [f]: { ...next[id]?.[f], [code]: text } };
          }
          return { ...prev, copy: next };
        });
      } catch (e) {
        setTranslateError(e instanceof Error ? e.message : String(e));
        break;
      } finally {
        setTranslating(null);
      }
    }
  };

  useEffect(() => {
    storeView(manifest.app.name, { deviceType, device, locale, dark });
  }, [manifest.app.name, deviceType, device, locale, dark]);

  // Write the design to disk once it has sat still for a moment; a drag on
  // the gradient picker fires many changes a second. Skips the initial mount
  // so opening the studio never creates the file by itself. An empty frame
  // means the config's custom bezel art, which has nothing to save.
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(() => {
      saveDesign({
        background,
        frame: frame || undefined,
        fontFamily,
        localeFonts: Object.keys(localeFonts).length > 0 ? localeFonts : undefined,
        copy: Object.keys(copy).length > 0 ? copy : undefined,
        order: order.length > 0 ? order : undefined,
        template: template === CUSTOM_TEMPLATE ? undefined : template,
        layout,
        screenOnly,
        sceneLayouts: Object.keys(sceneLayouts).length > 0 ? sceneLayouts : undefined,
        locales: sameList(locales, manifest.locales) ? undefined : locales,
        featureGraphic:
          design.featureGraphic && bannerLayout !== design.featureGraphic?.layout
            ? { layout: bannerLayout }
            : undefined,
      }).then(
        () => setSaveError(null),
        (e: Error) => setSaveError(e.message),
      );
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    background,
    frame,
    fontFamily,
    localeFonts,
    copy,
    order,
    template,
    layout,
    screenOnly,
    sceneLayouts,
    locales,
    bannerLayout,
    // Loaded once; listed so the comparisons above stay honest.
    manifest.locales,
    design.featureGraphic,
  ]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // The typefaces' @font-face rules (bundled, config and uploaded), in <head>.
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = fontFaces(fonts);
    document.head.append(style);
    return () => style.remove();
  }, [fonts]);

  // The exporter appends the custom fonts and the bundled CJK typeface as
  // per-glyph fallbacks, so the preview does the same; otherwise the browser
  // would silently substitute a system font for characters the chosen stack
  // cannot draw. Only the bare stacks are saved to goldie.design.json.
  const localeFont = localeFonts[locale] || "";
  const copyFont = localeFont || fontFamily;
  const fallbacks = [
    ...fonts.filter((f) => f.custom).map((f) => f.family),
    ...fonts.filter((f) => f.key === "noto-sans-sc").map((f) => f.family),
  ];
  const previewFontFamily = fallbacks.reduce(
    (stack, family) => (stack.includes(`"${family}"`) ? stack : `${stack}, "${family}"`),
    copyFont,
  );

  const typeDevices = manifest.devices.filter((d) => deviceTypeOf(d) === deviceType);
  const spec = typeDevices.find((d) => d.key === device) ?? typeDevices[0];
  // A localized capture shows the app in the chosen locale; otherwise every
  // locale shares one capture.
  const captures = spec
    ? (design.localeCaptures?.[spec.key]?.[locale] ?? design.captures[spec.key])
    : undefined;
  const frameUrl = frame
    ? `frames/${frame}.png`
    : (design.customFrameUrl ?? `frames/${design.frameVariants[0]}.png`);

  // The feature graphic belongs to Google Play, so it shows on the android tabs.
  const fg = design.featureGraphic;
  const showBanner = Boolean(fg) && deviceType !== "iphone";
  const bannerSpec = fg ? manifest.devices.find((d) => d.key === fg.device) : undefined;
  const bannerCaptures = fg
    ? (design.localeCaptures?.[fg.device]?.[locale] ?? design.captures[fg.device])
    : undefined;
  const bannerColors = copyColors(design.theme, fg?.background ?? background);

  return (
    <div className="flex h-full bg-stage p-3 text-foreground">
      <Sidebar
        manifest={manifest}
        deviceType={deviceType}
        device={device}
        locale={locale}
        locales={locales}
        onLocales={setLocales}
        missing={missingIn}
        translating={translating}
        translateError={translateError}
        onTranslate={translate}
        showBanner={showBanner}
        bannerLayout={bannerLayout}
        onBannerLayout={setBannerLayout}
        dark={dark}
        onDeviceType={selectDeviceType}
        onDevice={setDevice}
        onLocale={setLocale}
        onDark={setDark}
        background={background}
        frame={frame}
        fontFamily={fontFamily}
        fonts={fonts}
        localeFont={localeFont}
        template={template}
        layout={layout}
        screenOnly={screenOnly}
        onBackground={setBackground}
        onFrame={setFrame}
        onFontFamily={setFontFamily}
        onLocaleFont={setLocaleFont}
        onUploadFont={addFont}
        onTemplate={setTemplate}
        onLayout={setLayout}
        onScreenOnly={setScreenOnly}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative grid flex-1 place-items-center overflow-auto p-10">
          {spec && captures ? (
            <div className="flex w-full max-w-[1400px] flex-col gap-8">
              {showBanner ? (
                <div className="mx-auto w-full max-w-[720px]">
                  <FeatureGraphic
                    design={design}
                    layoutKey={bannerLayout}
                    locale={locale}
                    locales={locales}
                    captures={bannerCaptures}
                    spec={bannerSpec}
                    frameUrl={frameUrl}
                    background={background}
                    fontFamily={previewFontFamily}
                    headlineColor={bannerColors.headlineColor}
                    subheadColor={bannerColors.subheadColor}
                    screenOnly={screenOnly}
                    copy={copy}
                    onCopy={setSceneCopy}
                  />
                </div>
              ) : null}
              <Strip
                design={design}
                captures={captures}
                spec={spec}
                locale={locale}
                sourceLocale={sourceLocale}
                background={background}
                frameUrl={frameUrl}
                fontFamily={previewFontFamily}
                copy={copy}
                onCopy={setSceneCopy}
                order={order}
                onReorder={setOrder}
                template={
                  template === CUSTOM_TEMPLATE && Array.isArray(design.template)
                    ? design.template
                    : template
                }
                layout={layout}
                screenOnly={screenOnly}
                sceneLayouts={sceneLayouts}
                onSceneLayout={setSceneLayout}
              />
            </div>
          ) : spec ? (
            <EmptyState
              icon={CameraIcon}
              title={`No screenshots for the ${deviceLabel(spec)} yet`}
              body={`Ask your coding agent to capture the ${deviceLabel(spec)}, or run:`}
              command="goldie capture && goldie manifest"
            />
          ) : (
            <EmptyState {...ENABLE_DEVICE_TYPE[deviceType]} />
          )}
        </main>
      </div>

      {saveError ? <Toast message={`Could not save design: ${saveError}`} /> : null}
    </div>
  );
}

/** Everything the undo stack tracks: the design choices saved to goldie.design.json. */
type DesignState = {
  background: string;
  frame: string;
  fontFamily: string;
  /** Font stacks per locale; "" or absent follows fontFamily. */
  localeFonts: Record<string, string>;
  copy: Record<string, SceneCopy>;
  layout: string;
  /** A built-in template key, "" for none, or CUSTOM_TEMPLATE for the config's own sequence. */
  template: string;
  screenOnly: boolean;
  /** Per-scene layout overrides; a scene absent here follows `layout`. */
  sceneLayouts: Record<string, string>;
  /** Screenshot scene ids as arranged by dragging tiles; empty means the config's order. */
  order: string[];
  /** The store languages, first is the translation source; saved when it differs from the config. */
  locales: string[];
  /** The feature graphic's banner layout key, or "custom" for the config's spec. */
  bannerLayout: string;
};

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function initialTemplate(design: Design, saved: SavedDesign): string {
  if (saved.template !== undefined && design.templates.some((t) => t.key === saved.template))
    return saved.template;
  if (saved.template === "") return "";
  if (Array.isArray(design.template)) return CUSTOM_TEMPLATE;
  return design.template ?? "";
}

function initialSceneLayouts(
  design: Design,
  saved: SavedDesign,
  knownLayout: (key: string | undefined) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const scene of design.scenes) {
    const key = knownLayout(saved.sceneLayouts?.[scene.id]);
    if (key) out[scene.id] = key;
  }
  return out;
}

/** Ids no longer in the config are dropped, new ones follow the saved order. */
function initialOrder(design: Design, saved: SavedDesign): string[] {
  const ids = design.scenes.map((s) => s.id);
  if (!saved.order) return [];
  const kept = saved.order.filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

/** Bottom-center notice; the save retries on the next change, so it needs no dismiss. */
function Toast({ message }: { message: string }) {
  return (
    <output className="animate-in fade-in slide-in-from-bottom-2 fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-destructive/30 bg-popover px-3.5 py-2 text-xs text-destructive shadow-lg duration-200">
      {message}
    </output>
  );
}

type SavedView = {
  deviceType?: string;
  /** Written before tablets had a tab of their own; read as the device type. */
  platform?: string;
  device?: string;
  locale?: string;
  dark?: boolean;
};

const storageKey = (appName: string) => `goldie-studio:${appName}`;

function loadView(appName: string): SavedView {
  try {
    const raw = localStorage.getItem(storageKey(appName));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as SavedView) : {};
  } catch {
    return {};
  }
}

function storeView(appName: string, saved: SavedView): void {
  try {
    localStorage.setItem(storageKey(appName), JSON.stringify(saved));
  } catch {
    // Storage may be unavailable (private mode); the session still works.
  }
}

/** @font-face rules for the bundled typefaces the manifest lists. */
function fontFaces(fonts: BundledFont[]): string {
  return fonts
    .flatMap((font) =>
      font.faces.map((face) => {
        const ext = face.url.toLowerCase().split(".").pop();
        const format =
          ext === "otf"
            ? "opentype"
            : ext === "woff2"
              ? "woff2"
              : ext === "woff"
                ? "woff"
                : ext === "ttc"
                  ? "collection"
                  : "truetype";
        return `@font-face{font-family:"${font.family}";font-weight:${face.weight};font-style:normal;src:url("${face.url}") format("${format}")}`;
      }),
    )
    .join("\n");
}

/** iOS devices are sizes ("iPhone 6.9"), so they carry an inch mark, as in the sidebar. */
function deviceLabel(d: DeviceEntry): string {
  return d.platform === "ios" ? `${d.label}"` : d.label;
}
