import { bannerLayout, composeBanner, FEATURE_GRAPHIC } from "../../../src/banner";
import {
  type Design,
  type DeviceCaptures,
  type DeviceEntry,
  FEATURE_GRAPHIC_ID,
  isRtl,
  type SceneCopy,
} from "../manifest";
import { CHECKERBOARD, TRANSPARENT } from "./DesignPanel";
import { cq, DeviceView, editableProps } from "./Strip";

/**
 * Browser twin of renderFeatureGraphic in src/render.ts: the Google Play
 * feature graphic (1024 x 500) composed with the same composeBanner()
 * geometry, in container-query units. The headline and subhead are editable
 * in place for the current locale, saved like screenshot copy under the
 * "feature-graphic" id.
 */
export function FeatureGraphic({
  design,
  layoutKey,
  locale,
  locales,
  captures,
  spec,
  frameUrl,
  background,
  fontFamily,
  headlineColor,
  subheadColor,
  screenOnly,
  copy,
  onCopy,
}: {
  design: Design;
  /** A built-in banner key, or "custom" for the config's spec. */
  layoutKey: string;
  locale: string;
  locales: string[];
  captures: DeviceCaptures | undefined;
  spec: DeviceEntry | undefined;
  frameUrl: string;
  background: string;
  fontFamily: string;
  headlineColor: string;
  subheadColor: string;
  screenOnly: boolean;
  copy: Record<string, SceneCopy>;
  onCopy: (sceneId: string, field: "headline" | "subhead", text: string) => void;
}) {
  const fg = design.featureGraphic;
  if (!fg) return null;
  const layout = bannerLayout(layoutKey === "custom" && fg.custom ? fg.custom : layoutKey);
  const geom = spec?.frame?.geom;
  const c = composeBanner(layout, { screenOnly, geom });
  const tile = FEATURE_GRAPHIC;
  const { w, h } = cq(tile);
  const edited = copy[FEATURE_GRAPHIC_ID];
  // A locale without its own copy shows the first locale's, as the export does.
  const pickText = (field: "headline" | "subhead") => {
    const own = edited?.[field]?.[locale] ?? fg[field][locale];
    if (own !== undefined) return { text: own, fallback: false };
    for (const l of locales) {
      const text = edited?.[field]?.[l] ?? fg[field][l];
      if (text !== undefined) return { text, fallback: true };
    }
    return { text: "", fallback: false };
  };
  const headline = pickText("headline");
  const subhead = pickText("subhead");
  const bg = fg.background ?? background;
  const deviceFrameUrl = spec?.frame?.url ?? frameUrl;
  const shots = captures?.screenshots ?? [];
  const captureFor = (index: number) => {
    const sceneId = fg.scenes[index % Math.max(fg.scenes.length, 1)];
    return shots.find((s) => s.sceneId === sceneId) ?? shots[index % Math.max(shots.length, 1)];
  };
  const dir = isRtl(locale) ? "rtl" : undefined;

  return (
    <figure className="m-0 flex w-full flex-col gap-2">
      <div
        className="relative w-full overflow-hidden rounded-xl shadow-md"
        style={{ aspectRatio: `${tile.width} / ${tile.height}`, containerType: "size", fontFamily }}
      >
        <div
          className="absolute inset-0"
          style={{ background: bg === TRANSPARENT ? CHECKERBOARD : bg }}
        >
          {c.devices.map((device, i) => (
            <DeviceView
              // biome-ignore lint/suspicious/noArrayIndexKey: devices come from a static layout
              key={i}
              device={{ ...device, capture: "primary" }}
              tile={tile}
              frameUrl={screenOnly ? null : deviceFrameUrl}
              captureUrl={captureFor(device.capture)?.url}
              missing={fg.scenes[device.capture] ?? "a capture"}
            />
          ))}
          {c.copy ? (
            <div
              style={{
                position: "absolute",
                top: h(c.copy.y),
                transform: "translateY(-50%)",
                width: w(c.copy.maxWidth),
                ...(c.copy.align === "left"
                  ? { left: w(c.copy.x) }
                  : c.copy.align === "right"
                    ? { left: w(c.copy.x - c.copy.maxWidth) }
                    : { left: w(c.copy.x - c.copy.maxWidth / 2) }),
                textAlign: c.copy.align,
                display: "flex",
                flexDirection: "column",
                gap: h(c.copy.gap),
              }}
            >
              <h2
                dir={dir}
                style={{
                  margin: 0,
                  color: headlineColor,
                  fontSize: h(c.copy.headlineSize),
                  lineHeight: 1.08,
                  fontWeight: 700,
                  opacity: headline.fallback ? 0.55 : 1,
                }}
                {...editableProps(
                  (text) => onCopy(FEATURE_GRAPHIC_ID, "headline", text),
                  headline.text,
                  "Banner headline",
                )}
              >
                {headline.text}
              </h2>
              <p
                dir={dir}
                style={{
                  margin: 0,
                  color: subheadColor,
                  fontSize: h(c.copy.subheadSize),
                  lineHeight: 1.3,
                  fontWeight: 400,
                  opacity: subhead.fallback ? 0.55 : 1,
                }}
                {...editableProps(
                  (text) => onCopy(FEATURE_GRAPHIC_ID, "subhead", text),
                  subhead.text,
                  "Banner subhead",
                )}
              >
                {subhead.text}
              </p>
            </div>
          ) : null}
        </div>
      </div>
      <figcaption className="flex justify-between text-[11px] text-muted-foreground">
        <span>Feature graphic · Google Play · click the text to edit</span>
        <span>
          {headline.fallback || subhead.fallback ? `not translated to ${locale} · ` : ""}
          {tile.width}x{tile.height}
        </span>
      </figcaption>
    </figure>
  );
}
