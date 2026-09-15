import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as argent from "./argent.ts";
import { canvasFontFiles, flowPath, isScreenshot, type LoadedConfig } from "./config.ts";
import * as device from "./device.ts";
import { exec } from "./exec.ts";
import { DEVICES } from "./specs.ts";

const FFMPEG_INSTALL =
  process.platform === "darwin"
    ? "brew install ffmpeg"
    : process.platform === "win32"
      ? "winget install ffmpeg   (or choco install ffmpeg), then reopen the terminal"
      : "sudo apt install ffmpeg   (or your distro's package)";

type Check = { name: string; ok: boolean; detail: string; fix?: string; warnOnly?: boolean };

async function onPath(bin: string, args: string[] = ["--version"]): Promise<boolean> {
  return (await exec(bin, args, { quiet: true })).code === 0;
}

export async function doctor(cfg: LoadedConfig): Promise<boolean> {
  const checks: Check[] = [];
  const platforms = new Set(cfg.devices.map((key) => DEVICES[key].platform));

  if (platforms.has("ios")) {
    // iOS simulators exist only on macOS; say so before xcrun reports missing.
    const mac = process.platform === "darwin";
    checks.push({
      name: "macOS host",
      ok: mac,
      detail: mac ? process.platform : `${process.platform}: iOS simulators run only on macOS`,
      fix: "Run goldie on a Mac, or keep only android devices (pixel-10-pro, pixel-tablet) in `devices`",
    });
    checks.push({
      name: "xcrun",
      ok: mac && (await onPath("xcrun", ["simctl", "help"])),
      detail: "iOS simulator control",
      fix: "Install Xcode and run: xcode-select --install",
    });
  }
  if (platforms.has("android")) {
    checks.push({
      name: "adb",
      ok: await onPath("adb", ["version"]),
      detail: "Android emulator control",
      fix: "Install Android platform-tools and put adb on the PATH (Android Studio > SDK Manager)",
    });
  }
  checks.push({
    name: "ffmpeg",
    ok: await onPath("ffmpeg", ["-version"]),
    detail: "recording and pixel-format conversion",
    fix: FFMPEG_INSTALL,
  });
  checks.push({
    name: "ffprobe",
    ok: await onPath("ffprobe", ["-version"]),
    detail: "output verification",
    fix: FFMPEG_INSTALL,
  });
  checks.push({
    name: "argent",
    ok: await argent.available(),
    detail: "device driver",
    fix: "npm i -g @swmansion/argent   (or set GOLDIE_ARGENT_BIN)",
  });

  // The watermark flag is ON by default and would brand every preview.
  const watermarkOff = await argent.watermarkDisabled().catch(() => false);
  checks.push({
    name: "video-watermark",
    ok: watermarkOff,
    detail: watermarkOff ? "disabled" : "ENABLED - previews would carry the argent watermark",
    fix: "argent disable video-watermark",
  });

  // A host-wide screenshot scale would silently downscale every capture.
  const scale = process.env.ARGENT_SCREENSHOT_SCALE;
  checks.push({
    name: "ARGENT_SCREENSHOT_SCALE",
    ok: scale === undefined || Number(scale) === 1,
    detail: scale ? `set to ${scale}` : "unset (captures pass scale=1.0 explicitly)",
    fix: "unset ARGENT_SCREENSHOT_SCALE",
  });

  if (platforms.has("ios")) {
    const appPath = resolve(cfg.root, cfg.appPath);
    checks.push({
      name: "app build",
      ok: existsSync(appPath),
      detail: appPath,
      fix: `Build it: (cd ${cfg.appRoot} && npx expo run:ios --configuration Release)`,
    });

    // A Debug build needs Metro running and paints LogBox banners over the UI -
    // both end up in the captures.
    const isDebug = /Debug-iphonesimulator/.test(appPath);
    checks.push({
      name: "release build",
      ok: !isDebug,
      warnOnly: true,
      detail: isDebug
        ? "app is a Debug build: it requires Metro and paints dev warning banners into captures"
        : "release build",
      fix: `(cd ${cfg.appRoot} && npx expo run:ios --configuration Release) then point appPath at the Release-iphonesimulator .app`,
    });
  }

  if (platforms.has("android")) {
    const apk = cfg.android ? resolve(cfg.root, cfg.android.appPath) : null;
    checks.push({
      name: "android app build",
      ok: Boolean(apk?.endsWith(".apk") && existsSync(apk)),
      detail: apk ?? "config has no android block",
      fix: apk
        ? "Build the .apk and point android.appPath at it"
        : 'Add android: { appPath: "<path to .apk>", applicationId: "<id>" } to the config',
    });

    // A debuggable build paints StrictMode flashes and dev overlays into captures.
    const isDebugApk = apk !== null && /debug/i.test(apk);
    checks.push({
      name: "android release build",
      ok: !isDebugApk,
      warnOnly: true,
      detail: isDebugApk
        ? 'apk path contains "debug": debuggable builds paint StrictMode and dev overlays into captures'
        : "release build",
      fix: `(cd ${cfg.appRoot} && npx expo run:android --variant release) then point android.appPath at the release .apk`,
    });
  }

  for (const key of cfg.devices) {
    const spec = DEVICES[key];
    if (spec.platform === "android") {
      // Doctor only reports; capture is what boots an emulator when needed.
      const serial = await device.resolveUdid(key, { autoBoot: false }).catch(() => null);
      const avds = serial ? [] : await device.matchingAvds(key).catch(() => []);
      checks.push({
        name: `emulator ${key}`,
        ok: Boolean(serial) || avds.length > 0,
        detail:
          serial ??
          (avds.length > 0
            ? `not running; capture will boot AVD "${avds[0]}"`
            : `no AVD with the ${spec.avdDeviceNames?.map((p) => `"${p}"`).join(" or ")} hardware profile`),
        fix: `avdmanager create avd --device ${spec.avdDeviceNames?.[0]} --name <name>   (or Android Studio > Device Manager)`,
      });
    } else {
      const udid = await device.resolveUdid(key).catch(() => null);
      checks.push({
        name: `simulator ${spec.simulatorName}`,
        ok: Boolean(udid),
        detail: udid ?? "not installed",
        fix: `xcrun simctl create "${spec.simulatorName}" "${spec.simulatorName}"`,
      });
    }
  }

  checks.push({
    name: "flows dir",
    ok: existsSync(cfg.flowsDir),
    detail: cfg.flowsDir,
    fix: `Create ${cfg.flowsDir}   (or set flowsDir in goldie.config.ts)`,
  });

  for (const scene of cfg.scenes) {
    const items = scene.kind === "preview" ? scene.segments : [scene];
    const flows = new Set(
      items.flatMap((item) => [item.flow, ...Object.values(item.localeFlows ?? {})]),
    );
    for (const f of flows) {
      const path = flowPath(cfg, f);
      checks.push({
        name: `flow ${f}`,
        ok: existsSync(path),
        detail: path,
        fix: "Record or author it under the flows dir, or fix the name in goldie.config.ts",
      });
    }
  }

  // Every locale needs its copy; frame would otherwise stop at the first gap.
  const missing: string[] = [];
  for (const scene of cfg.scenes.filter(isScreenshot)) {
    for (const locale of cfg.locales) {
      if (scene.headline[locale] === undefined) missing.push(`${scene.id} headline [${locale}]`);
      if (scene.subhead && scene.subhead[locale] === undefined)
        missing.push(`${scene.id} subhead [${locale}]`);
      for (const d of [...(cfg.theme.decorations ?? []), ...(scene.decorations ?? [])]) {
        if (d.kind === "badge" && d.text[locale] === undefined)
          missing.push(`${scene.id} badge "${Object.values(d.text)[0]}" [${locale}]`);
      }
    }
  }
  checks.push({
    name: "translations",
    ok: missing.length === 0,
    // Untranslated copy renders in the first locale, so this warns rather than fails.
    warnOnly: true,
    detail:
      missing.length === 0
        ? `${cfg.locales.length} locale(s): ${cfg.locales.join(", ")}`
        : `missing ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`,
    fix: "goldie translate (Claude Code CLI), add the entries to goldie.config.ts, or edit them in goldie studio",
  });

  for (const font of canvasFontFiles(cfg)) {
    checks.push({
      name: `font ${font.family}`,
      ok: font.files.length > 0,
      detail: font.files.length > 0 ? `${font.files.length} file(s)` : "no TTF or OTF file",
      fix: "The exporter's canvas reads TTF/OTF only; add one next to any WOFF2",
    });
  }

  // Copy in a script none of the stack's fonts cover exports as tofu boxes.
  for (const locale of cfg.locales) {
    const script = nonLatinScript(locale);
    if (!script) continue;
    const stack = cfg.theme.localeFonts?.[locale] ?? "";
    const covered = stack !== "" || (cfg.fonts ?? []).length > 0 || script === "CJK";
    checks.push({
      name: `font for ${locale}`,
      ok: covered,
      warnOnly: true,
      detail: covered
        ? stack || "custom fonts act as glyph fallbacks"
        : `${script} copy with no custom font; the export may draw empty boxes`,
      fix: `Add a ${script} typeface to \`fonts\` and set theme.localeFonts["${locale}"] (e.g. a Noto Sans ${script} TTF)`,
    });
  }

  if (cfg.localizedCapture && cfg.locales.length > 1) {
    checks.push({
      name: "localized capture",
      ok: true,
      detail: `captures run once per locale (${cfg.locales.length}x capture time)`,
    });
  }

  let allOk = true;
  for (const c of checks) {
    if (!c.ok && !c.warnOnly) allOk = false;
    const label = c.ok ? "  ok  " : c.warnOnly ? "  warn" : "  FAIL";
    console.log(`${label} ${c.name.padEnd(30)} ${c.detail}`);
    if (!c.ok && c.fix) console.log(`       fix: ${c.fix}`);
  }
  return allOk;
}

/** The script a locale writes in when the bundled latin faces cannot draw it, else null. */
function nonLatinScript(locale: string): string | null {
  const language = locale.toLowerCase().split(/[-_]/)[0]!;
  const scripts: Record<string, string> = {
    bn: "Bengali",
    as: "Bengali",
    hi: "Devanagari",
    mr: "Devanagari",
    ne: "Devanagari",
    ar: "Arabic",
    fa: "Arabic",
    ur: "Arabic",
    he: "Hebrew",
    th: "Thai",
    ta: "Tamil",
    te: "Telugu",
    kn: "Kannada",
    ml: "Malayalam",
    gu: "Gujarati",
    pa: "Gurmukhi",
    si: "Sinhala",
    km: "Khmer",
    lo: "Lao",
    my: "Myanmar",
    ka: "Georgian",
    hy: "Armenian",
    am: "Ethiopic",
    zh: "CJK",
    ja: "CJK",
    ko: "Korean",
  };
  return scripts[language] ?? null;
}
