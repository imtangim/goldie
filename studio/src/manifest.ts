/** Mirrors the StoreManifest that `goldie manifest` writes to out/store.json. */

export type Theme = {
  background: string;
  headlineColor: string;
  subheadColor: string;
  fontFamily: string;
  /** Font stacks per locale, replacing fontFamily for that locale's copy. */
  localeFonts?: Record<string, string>;
  /** Fraction of the frame height reserved for copy above the device. */
  copyHeightRatio: number;
  /** Fraction of the frame width the device bezel occupies. */
  deviceWidthRatio: number;
};

/** Mirrors Decoration in src/config.ts; image `src` values are urls under out/web. */
export type Decoration =
  | {
      kind: "badge";
      text: Record<string, string>;
      position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
      background?: string;
      color?: string;
    }
  | { kind: "image"; src: string; x: number; y: number; width: number; rotate?: number };

export type LayoutEntry = { key: string; label: string; description: string; span: number };
export type TemplateEntry = { key: string; label: string; description: string; sequence: string[] };

/** Mirrors FrameGeometry in src/layouts.ts: a bezel image's box and the screen cutout inside it. */
export type FrameGeometry = {
  width: number;
  height: number;
  screen: { x: number; y: number; width: number; height: number };
  screenRadius: number;
};

export type DeviceEntry = {
  key: string;
  label: string;
  platform: "ios" | "android";
  formFactor: "phone" | "tablet";
  simulatorName: string | null;
  screenshot: { width: number; height: number };
  preview: { width: number; height: number } | null;
  /** Bezel art fixed to this device (android), null when the frame picker applies. */
  frame: { url: string; geom: FrameGeometry } | null;
};

/** The sidebar's device tabs that can hold devices: a platform and a form factor. */
export type DeviceType = "iphone" | "android" | "android-tablet";

export const DEVICE_TYPES: DeviceType[] = ["iphone", "android", "android-tablet"];

export function deviceTypeOf(d: Pick<DeviceEntry, "platform" | "formFactor">): DeviceType {
  if (d.platform === "ios") return "iphone";
  return d.formFactor === "tablet" ? "android-tablet" : "android";
}

export type DesignScene = {
  id: string;
  headline: Record<string, string>;
  subhead?: Record<string, string>;
  layout?: string;
  secondScene?: string;
  decorations?: Decoration[];
};

export type BundledFont = {
  key: string;
  family: string;
  fallback: string;
  faces: Array<{ weight: number; url: string }>;
  /** From the config's `fonts` or uploaded in the studio, not bundled with goldie. */
  custom?: boolean;
};

export type DeviceCaptures = {
  screenshots: Array<{ sceneId: string; url: string }>;
  clips: Array<{ segmentId: string; url: string; durationSeconds: number }> | null;
};

export type Design = {
  theme: Theme;
  /** null when the config points at custom bezel art. */
  frameVariant: string | null;
  frameVariants: string[];
  customFrameUrl: string | null;
  /** Bundled typefaces with the @font-face sources to declare. */
  fonts: BundledFont[];
  layouts: LayoutEntry[];
  templates: TemplateEntry[];
  /** The theme's template: a built-in key, null for none, or the config's custom sequence. */
  template: string | string[] | null;
  /** The theme's default layout key. */
  layout: string;
  screenOnly: boolean;
  decorations: Decoration[];
  scenes: DesignScene[];
  preview: {
    sceneId: string;
    segments: Array<{ id: string }>;
  } | null;
  /** Raw capture urls per device key; a device is absent until `goldie capture` ran. */
  captures: Record<string, DeviceCaptures>;
  /** Localized captures per device key, then locale; absent without localizedCapture. */
  localeCaptures?: Record<string, Record<string, DeviceCaptures>>;
};

export type StoreManifest = {
  generatedAt: string;
  app: {
    name: string;
    subtitle: Record<string, string>;
    developer: string;
    category: string;
    rating: number;
    ratingCount: string;
    ageRating: string;
    price: string;
    description: Record<string, string>;
  };
  devices: DeviceEntry[];
  locales: string[];
  design: Design;
};

/** A load failure with the CLI command that fixes it, for the empty state. */
export class ManifestError extends Error {
  constructor(
    message: string,
    readonly command: string,
  ) {
    super(message);
  }
}

export async function loadManifest(): Promise<StoreManifest> {
  const res = await fetch("/store.json", { cache: "no-store" });
  if (!res.ok) {
    throw new ManifestError(
      "There is no out/store.json yet. Generate the assets first.",
      "goldie all",
    );
  }
  const manifest: StoreManifest = await res.json();
  if (!manifest.design?.fonts || !manifest.design.layouts) {
    throw new ManifestError(
      "out/store.json predates browser-side composition. Regenerate it.",
      "goldie manifest",
    );
  }

  // Raw captures keep their names across a re-capture, so the manifest's
  // timestamp becomes a cache-buster - a capture followed by a manifest
  // reload shows new pixels.
  const v = `?v=${Date.parse(manifest.generatedAt) || 0}`;
  const all = [
    ...Object.values(manifest.design.captures),
    ...Object.values(manifest.design.localeCaptures ?? {}).flatMap((l) => Object.values(l)),
  ];
  // A localized device's shared entry can be the same object as a locale's;
  // bust each url once.
  for (const captures of new Set(all)) {
    for (const shot of captures.screenshots) shot.url += v;
    for (const clip of captures.clips ?? []) clip.url += v;
  }
  return manifest;
}

/** The design choices saved on disk next to the config; see src/studio-server.ts. */
export type SavedDesign = {
  background?: string;
  frame?: string;
  fontFamily?: string;
  /** Font stacks per locale; "" clears the config's override for that locale. */
  localeFonts?: Record<string, string>;
  /** Copy edited in the lightbox, per screenshot scene id, then locale. */
  copy?: Record<string, SceneCopy>;
  /** Screenshot scene ids in the order the tiles were dragged into. */
  order?: string[];
  /** A built-in template key, or "" for none. */
  template?: string;
  /** Default layout key for scenes the template does not cover. */
  layout?: string;
  screenOnly?: boolean;
  /** Layout overrides per screenshot scene id. */
  sceneLayouts?: Record<string, string>;
};

export type SceneCopy = {
  headline?: Record<string, string>;
  subhead?: Record<string, string>;
};

export async function loadDesign(): Promise<SavedDesign> {
  try {
    const res = await fetch("/api/design", { cache: "no-store" });
    if (!res.ok) return {};
    const parsed = await res.json();
    return parsed && typeof parsed === "object" ? (parsed as SavedDesign) : {};
  } catch {
    return {}; // a static build has no API; the config's values stand
  }
}

/** Uploads one font file; resolves with the family's font entry to declare. */
export async function uploadFont(file: File, family: string, weight: number): Promise<BundledFont> {
  const res = await fetch("/api/fonts", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Font-Family": encodeURIComponent(family),
      "X-Font-Weight": String(weight),
      "X-Font-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Scripts written right to left; mirrors isRtl in src/render.ts. */
export function isRtl(locale: string): boolean {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  return ["ar", "he", "iw", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"].includes(language);
}

export async function saveDesign(design: SavedDesign): Promise<void> {
  const res = await fetch("/api/design", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(design),
  });
  if (!res.ok) throw new Error(`Saving goldie.design.json failed: ${await res.text()}`);
}
