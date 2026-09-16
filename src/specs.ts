/**
 * Store asset specifications.
 * iOS: App Store Connect, developer.apple.com/help/app-store-connect/reference/
 *   screenshot-specifications | app-preview-specifications. Verified 2026-08-24.
 * Android: Play Console help, "Add preview assets". Phone screenshots are
 *   PNG/JPEG, 16:9 or 9:16, each side 320-3840px for promotional eligibility.
 *   Play accepts no video uploads: the promo video is a YouTube link, so the
 *   android preview renders at a YouTube-friendly size for the user to post
 *   themselves, with no store constraints enforced.
 */

export type DeviceKey = "iphone-6.9" | "pixel-10-pro" | "pixel-tablet";

export const DEVICE_KEYS = ["iphone-6.9", "pixel-10-pro", "pixel-tablet"] as const;

export type DeviceSpec = {
  /**
   * Display label for the studio and logs. Output paths use the DeviceKey,
   * so raw/, screenshots/ and previews/ all share one naming scheme.
   */
  label: string;
  platform: "ios" | "android";
  /** Phone or tablet; the studio groups devices into its tabs by platform and form factor. */
  formFactor: "phone" | "tablet";
  /**
   * Android only: the display rotation to pin before capturing (the
   * `user_rotation` setting: 0 natural, 1 = 90°, 2 = 180°, 3 = 270°), with
   * auto-rotate turned off so the sensor cannot change it mid-flow.
   *
   * Only 0 is safe today: argent reports element positions in the unrotated
   * display space, so on a rotated emulator every tap lands somewhere else
   * and flows fail on their first step. A device that wants a non-natural
   * orientation needs argent to map taps through the rotation first.
   */
  userRotation?: 0;
  /**
   * `xcrun simctl` device type name; the toolkit picks the newest runtime that
   * has it. iOS only - android resolves a running emulator's adb serial instead.
   */
  simulatorName?: string;
  /**
   * Accepted AVD hardware profiles (`hw.device.name` in the AVD's config.ini),
   * in boot-preference order. Android only - a running emulator qualifies only
   * when its profile is listed, so captures always come from the intended
   * screen geometry. Every profile in the list must share that geometry.
   */
  avdDeviceNames?: string[];
  /**
   * Native capture resolution, portrait. null accepts the device's native
   * capture size as-is (Android emulators vary).
   */
  native: { width: number; height: number } | null;
  /** Required screenshot upload size, portrait. */
  screenshot: { width: number; height: number };
  /**
   * Preview video render size, portrait. On iOS this is the upload size Apple
   * requires; on android it is the size of the YouTube video the user posts
   * themselves (Play takes no video uploads). null: no preview pipeline.
   */
  preview: { width: number; height: number } | null;
  /** Render bare screens with the drop shadow instead of a bezel. */
  screenOnly?: true;
};

export const DEVICES: Record<DeviceKey, DeviceSpec> = {
  "iphone-6.9": {
    label: "6.9",
    platform: "ios",
    formFactor: "phone",
    simulatorName: "iPhone 17 Pro Max",
    native: { width: 1320, height: 2868 },
    screenshot: { width: 1320, height: 2868 },
    preview: { width: 886, height: 1920 },
  },
  // Framed with the bundled Pixel 10 Pro art (src/frame.ts), not the config's
  // frame variant, which is iPhone art with iPhone geometry. The Pixel 9 Pro
  // shares the 1280x2856 screen, so its emulator captures compose identically.
  "pixel-10-pro": {
    label: "Play phone",
    platform: "android",
    formFactor: "phone",
    avdDeviceNames: ["pixel_10_pro", "pixel_9_pro"],
    native: null,
    screenshot: { width: 1080, height: 1920 },
    // Near the 1280x2856 Pixel screen's aspect, so the cover-crop trims only a
    // sliver; YouTube accepts any portrait size.
    preview: { width: 1080, height: 2400 },
  },
  // Play's tablet screenshots (7- and 10-inch slots): 16:9 or 9:16, each side
  // 1080-7680px. Landscape, which is how the Pixel Tablet emulator runs
  // natively (2560x1600) and how tablet apps are usually shown: the rotation
  // pin that would make portrait tiles breaks argent's tap coordinates (see
  // userRotation), so the tile follows the device instead of the reverse.
  // The 16:10 capture cover-crops to 16:9, trimming a sliver top and bottom.
  "pixel-tablet": {
    label: "Play tablet",
    platform: "android",
    formFactor: "tablet",
    avdDeviceNames: ["pixel_tablet"],
    userRotation: 0,
    native: null,
    screenshot: { width: 2560, height: 1440 },
    // Landscape 1080p: what YouTube expects for the Play promo video.
    preview: { width: 1920, height: 1080 },
  },
};

/**
 * Preview constraints Apple enforces at upload time. Both platforms encode
 * with these settings; the duration and file-size bounds apply on iOS only
 * (the android video goes to YouTube, which imposes none that matter here).
 */
export const PREVIEW = {
  fps: 30,
  minSeconds: 15,
  maxSeconds: 30,
  /** Apple asks for 10-12 Mbps VBR on H.264. */
  videoBitrate: "11M",
  audioBitrate: "256k",
  audioSampleRate: 48000,
  maxBytes: 500 * 1024 * 1024,
} as const;

/** Screenshots may not carry an alpha channel. */
export const SCREENSHOT_PIXEL_FORMAT = "rgb24";
