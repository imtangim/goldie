/**
 * Geometry of the bezel PNGs in assets/ (the 17-pro-* variants): the bezel
 * image and the transparent screen cutout inside it, both in the source PNG's
 * own pixels. All bundled variants share this geometry. Measured from the
 * alpha channel; re-measure if custom bezel art is used instead. Layouts built on it live
 * in layouts.ts.
 */
export const FRAME = {
  width: 606,
  height: 1252,
  screen: { x: 24, y: 21, width: 557, height: 1210 },
  /**
   * Corner radius of the screen cutout. The bezel ring is thinner than this
   * radius, so square screen content would poke past the phone's outer corner;
   * the compositor clips the content with the scaled radius instead.
   */
  screenRadius: 82,
} as const;

/**
 * The android device's bundled bezel art and its geometry: the Pixel 10 Pro
 * emulator skin's `back.webp` from the Android SDK, with the display punched
 * transparent. The image box and screen cutout come from the skin's own
 * `layout` file (display 1280x2856 at 59,60); the cutout radius is measured
 * from the punched alpha. A config's `android.frame` overrides it.
 */
export const ANDROID_FRAME = {
  /** The art's file name in goldie's own assets/. */
  file: "pixel-10-pro.webp",
  geom: {
    width: 1410,
    height: 2968,
    screen: { x: 59, y: 60, width: 1280, height: 2856 },
    screenRadius: 178,
  },
} as const;

/**
 * The Pixel Tablet's bundled bezel art: the SDK's `pixel_tablet` skin
 * `back.webp` as it ships, landscape, with the display already transparent.
 * The image box and display rect come from the skin's own `layout` file
 * (2798x1837, display 2560x1600 at 119,117); the cutout radius is measured
 * from the alpha and matches the skin's `mask.webp`. Landscape because the
 * emulator captures that way: goldie cannot rotate it without breaking
 * argent's tap coordinates (see userRotation in src/specs.ts).
 */
export const ANDROID_TABLET_FRAME = {
  file: "pixel-tablet.webp",
  geom: {
    width: 2798,
    height: 1837,
    screen: { x: 119, y: 117, width: 2560, height: 1600 },
    screenRadius: 32,
  },
} as const;
