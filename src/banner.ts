/**
 * The Google Play feature graphic: the 1024 x 500 banner shown at the top of
 * a store listing (Play requires one). Like layouts.ts this is pure, with no
 * node imports: the CLI renderer and the studio both call composeBanner()
 * with the same inputs, so the preview and the export match.
 *
 * A banner layout places a copy block and up to three devices by fractions
 * of the banner. The built-ins below cover the common shapes; a config can
 * pass its own spec of the same shape (`featureGraphic.layout: { copy,
 * devices }`) for a custom banner template.
 */
import { FRAME } from "./frame.ts";
import type { FrameGeometry } from "./layouts.ts";

/** Play's feature graphic size: JPEG or 24-bit PNG, no alpha. */
export const FEATURE_GRAPHIC = { width: 1024, height: 500 } as const;

export const BANNER_KEYS = [
  "split",
  "split-right",
  "tilt",
  "duo",
  "trio",
  "showcase",
  "centered",
] as const;
export type BannerKey = (typeof BANNER_KEYS)[number];

export type BannerCopy = {
  /** Anchor x as a fraction of the width: the left edge, centre or right edge per `align`. */
  x: number;
  /** Vertical centre of the copy block as a fraction of the height. */
  y: number;
  /** Wrap width as a fraction of the banner width. */
  width: number;
  align: "left" | "center" | "right";
  /** Headline and subhead sizes as fractions of the banner height. Defaults 0.11 and 0.05. */
  headlineSize?: number;
  subheadSize?: number;
};

export type BannerDevice = {
  /** Device centre as fractions of the banner width and height. */
  x: number;
  y: number;
  /** Bezel height as a fraction of the banner height; above 1 bleeds off an edge. */
  height: number;
  /** Degrees, clockwise, around the device centre. */
  rotate?: number;
  /** Which of the banner's scenes fills this screen: 0 is the first. */
  capture?: number;
};

/** The shape of a banner template: built in, or a config's custom one. */
export type BannerLayout = {
  /** null draws no copy (an image-only banner). */
  copy: BannerCopy | null;
  /** Back to front. */
  devices: BannerDevice[];
};

export type BannerSpec = BannerLayout & { key: BannerKey; label: string; description: string };

export const BANNER_LAYOUTS: Record<BannerKey, BannerSpec> = {
  split: {
    key: "split",
    label: "Split",
    description: "Copy on the left, one phone rising from the bottom right.",
    copy: { x: 0.07, y: 0.5, width: 0.5, align: "left" },
    devices: [{ x: 0.78, y: 0.64, height: 1.2 }],
  },
  "split-right": {
    key: "split-right",
    label: "Split right",
    description: "One phone on the left, copy on the right.",
    copy: { x: 0.93, y: 0.5, width: 0.5, align: "right" },
    devices: [{ x: 0.22, y: 0.64, height: 1.2 }],
  },
  tilt: {
    key: "tilt",
    label: "Tilt",
    description: "Copy on the left, a large tilted phone bleeding off the right.",
    copy: { x: 0.07, y: 0.5, width: 0.48, align: "left" },
    devices: [{ x: 0.8, y: 0.6, height: 1.35, rotate: -14 }],
  },
  duo: {
    key: "duo",
    label: "Duo",
    description: "Copy on the left, two phones leaning apart on the right.",
    copy: { x: 0.06, y: 0.5, width: 0.44, align: "left" },
    devices: [
      { x: 0.66, y: 0.66, height: 1.1, rotate: -8, capture: 1 },
      { x: 0.86, y: 0.58, height: 1.18, rotate: 6, capture: 0 },
    ],
  },
  trio: {
    key: "trio",
    label: "Trio",
    description: "Copy on the left, three phones fanned out on the right.",
    copy: { x: 0.06, y: 0.5, width: 0.38, align: "left", headlineSize: 0.1 },
    devices: [
      { x: 0.6, y: 0.7, height: 0.98, rotate: -10, capture: 1 },
      { x: 0.88, y: 0.7, height: 0.98, rotate: 10, capture: 2 },
      { x: 0.74, y: 0.62, height: 1.12, rotate: 0, capture: 0 },
    ],
  },
  showcase: {
    key: "showcase",
    label: "Showcase",
    description: "Centred copy on top, three phones peeking up from the bottom edge.",
    copy: { x: 0.5, y: 0.2, width: 0.84, align: "center", headlineSize: 0.1, subheadSize: 0.045 },
    devices: [
      { x: 0.24, y: 1.02, height: 1.15, rotate: -8, capture: 1 },
      { x: 0.76, y: 1.02, height: 1.15, rotate: 8, capture: 2 },
      { x: 0.5, y: 0.96, height: 1.15, rotate: 0, capture: 0 },
    ],
  },
  centered: {
    key: "centered",
    label: "Centered",
    description: "Just the copy, large and centred on the background.",
    copy: { x: 0.5, y: 0.5, width: 0.8, align: "center", headlineSize: 0.14, subheadSize: 0.06 },
    devices: [],
  },
};

export function isBannerKey(key: string): key is BannerKey {
  return (BANNER_KEYS as readonly string[]).includes(key);
}

/** A banner layout choice resolved to its spec: a built-in key, else a custom spec, else split. */
export function bannerLayout(choice: string | BannerLayout | undefined): BannerLayout {
  if (choice && typeof choice === "object") return choice;
  return BANNER_LAYOUTS[choice && isBannerKey(choice) ? choice : "split"];
}

/** Checks a custom banner spec's shape; returns a problem description or null. */
export function bannerLayoutProblem(layout: unknown): string | null {
  if (!layout || typeof layout !== "object") return "must be an object with copy and devices";
  const l = layout as Partial<BannerLayout>;
  if (!Array.isArray(l.devices)) return "devices must be an array (empty for copy only)";
  if (l.devices.length > 3) return "at most 3 devices";
  for (const d of l.devices) {
    if (typeof d.x !== "number" || typeof d.y !== "number" || typeof d.height !== "number")
      return "each device needs numeric x, y and height";
  }
  if (l.copy !== null && l.copy !== undefined) {
    const c = l.copy;
    if (typeof c.x !== "number" || typeof c.y !== "number" || typeof c.width !== "number")
      return "copy needs numeric x, y and width (or copy: null)";
    if (!["left", "center", "right"].includes(c.align))
      return 'copy.align must be "left", "center" or "right"';
  }
  return null;
}

export const BANNER_TYPE = {
  headlineSize: 0.11,
  subheadSize: 0.05,
  headlineWeight: 700,
  subheadWeight: 400,
  headlineLineHeight: 1.08,
  subheadLineHeight: 1.3,
  /** Space between headline and subhead as a fraction of the height. */
  gap: 0.03,
} as const;

export type BannerComposition = {
  width: number;
  height: number;
  copy: {
    x: number;
    y: number;
    maxWidth: number;
    align: "left" | "center" | "right";
    headlineSize: number;
    subheadSize: number;
    gap: number;
  } | null;
  devices: Array<{
    frame: { left: number; top: number; width: number; height: number };
    screen: { left: number; top: number; width: number; height: number; radius: number };
    rotate: number;
    capture: number;
  }>;
};

/** Pixel geometry of a banner layout at the feature graphic size. */
export function composeBanner(
  layout: BannerLayout,
  opts: { screenOnly?: boolean; geom?: FrameGeometry } = {},
): BannerComposition {
  const { width: W, height: H } = FEATURE_GRAPHIC;
  const geom = opts.geom ?? FRAME;
  const art = opts.screenOnly
    ? { width: geom.screen.width, height: geom.screen.height, screen: { x: 0, y: 0 } }
    : { width: geom.width, height: geom.height, screen: geom.screen };
  const copy = layout.copy
    ? {
        x: W * layout.copy.x,
        y: H * layout.copy.y,
        maxWidth: W * layout.copy.width,
        align: layout.copy.align,
        headlineSize: H * (layout.copy.headlineSize ?? BANNER_TYPE.headlineSize),
        subheadSize: H * (layout.copy.subheadSize ?? BANNER_TYPE.subheadSize),
        gap: H * BANNER_TYPE.gap,
      }
    : null;
  const devices = layout.devices.map((d) => {
    const scale = (H * d.height) / art.height;
    const w = art.width * scale;
    const h = art.height * scale;
    const left = W * d.x - w / 2;
    const top = H * d.y - h / 2;
    return {
      frame: { left, top, width: w, height: h },
      screen: {
        left: left + art.screen.x * scale,
        top: top + art.screen.y * scale,
        width: geom.screen.width * scale,
        height: geom.screen.height * scale,
        radius: geom.screenRadius * scale,
      },
      rotate: d.rotate ?? 0,
      capture: d.capture ?? 0,
    };
  });
  return { width: W, height: H, copy, devices };
}
