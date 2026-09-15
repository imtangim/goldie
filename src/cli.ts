#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNER_KEYS, BANNER_LAYOUTS } from "./banner.ts";
import { capture } from "./capture.ts";
import {
  applyDesign,
  FEATURE_GRAPHIC_ID,
  type FrameVariant,
  type LoadedConfig,
  loadConfig,
  readDesign,
  resolvedFeatureGraphic,
  validateLayouts,
  writeDesign,
} from "./config.ts";
import * as device from "./device.ts";
import { doctor } from "./doctor.ts";
import { FONT_KEYS, fontStack } from "./fonts.ts";
import { LAYOUT_KEYS, LAYOUTS, type LayoutKey, TEMPLATE_KEYS, TEMPLATES } from "./layouts.ts";
import { isLocaleCode, LOCALES, localeName } from "./locales.ts";
import { writeManifest } from "./manifest.ts";
import {
  renderFeatureGraphic,
  renderPreview,
  renderScreenshots,
  verify,
  verifyFeatureGraphic,
} from "./render.ts";
import { FlowFailure, repairBrief } from "./repair.ts";
import { DEVICE_KEYS, DEVICES, type DeviceKey } from "./specs.ts";
import { openInBrowser, serveStudio, studioPaths } from "./studio-server.ts";
import { collectCopy, mergeTranslations, translateTexts } from "./translate.ts";

const USAGE = `
goldie - App Store screenshots and previews, driven by argent

  goldie doctor     Check the toolchain, simulators, flags and flows
  goldie capture    Replay every scene flow and save raw captures
  goldie frame      Composite raw screenshots into framed, captioned PNGs (and the feature graphic)
  goldie banner     Render only the Google Play feature graphic (1024x500) per locale
  goldie preview    Join the raw clips into the preview video (App Store upload; YouTube for Play)
  goldie verify     Check finished assets against the store spec tables
  goldie manifest   Write out/store.json for the studio app
  goldie studio     Serve the studio at http://localhost:4321 (--port <n>, --no-open)
  goldie all        capture -> frame -> preview -> manifest -> verify
  goldie locales    List the languages; "locales add <code...>" / "locales remove <code...>" edit them
  goldie translate  Fill missing copy for --locale <code> (or every locale) with the Claude Code CLI
                    (--from <code> source, default the first locale; --force overwrites existing copy)
  goldie list       Every device, layout, template, banner layout, font and language code (--json)
  goldie version    Print the installed goldie version (-v, --version)

Options
  --config <path>   Config file (default ./goldie.config.ts)
  --device <key>    Only this device key (default: every device in the config)
  --locale <code>   Only this locale (default: every locale in the config)
  --background <css>  Override theme.background for this run (also clears per-scene backgrounds); "transparent" keeps alpha
  --frame <variant>   Override the screenshot bezel variant for this run (17-pro-silver | 17-pro-blue | 17-pro-orange)
  --font <key>        Override theme.fontFamily for this run (system | ${FONT_KEYS.join(" | ")} | a custom font from the config's fonts)
  --template <key>    Override theme.template for this run (${TEMPLATE_KEYS.join(" | ")}; "none" for one layout)
  --layout <key>      Override theme.layout for this run (${LAYOUT_KEYS.join(" | ")})
  --screen-only       Render bare screens with no bezel for this run
  --banner <key>      Override featureGraphic.layout for this run (${BANNER_KEYS.join(" | ")})
`;

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const opt = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };

  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return 0;
  }

  if (command === "version" || command === "-v" || command === "--version") {
    console.log(packageVersion());
    return 0;
  }

  if (command === "list") return list(argv.includes("--json"));

  const cfg = await loadConfig(opt("config") ? resolve(process.cwd(), opt("config")!) : undefined);

  // Language management edits goldie.design.json, so it runs before the
  // --locale check below (an added code is not in the config yet).
  if (command === "locales") return manageLocales(cfg, argv.slice(1));

  // One-run overrides on top of the config and goldie.design.json (the
  // studio's saved choices). Copy a value into the config to keep it.
  const font = opt("font");
  applyDesign(cfg, {
    background: opt("background"),
    frame: opt("frame") as FrameVariant | undefined,
    fontFamily: font ? fontStack(font, cfg.fonts) : undefined, // throws on an unknown key
    template: opt("template") === "none" ? "" : opt("template"),
    layout: opt("layout") as LayoutKey | undefined,
    screenOnly: argv.includes("--screen-only") ? true : undefined,
    featureGraphic: opt("banner") ? { layout: opt("banner") } : undefined,
  });
  validateLayouts(cfg);

  const devices = (opt("device") ? [opt("device") as DeviceKey] : cfg.devices) as DeviceKey[];
  for (const d of devices) {
    if (!DEVICE_KEYS.includes(d)) {
      throw new Error(`Unknown device "${d}". Available: ${DEVICE_KEYS.join(", ")}`);
    }
  }
  const locales = opt("locale") ? [opt("locale")!] : cfg.locales;
  for (const l of locales) {
    if (!cfg.locales.includes(l)) {
      throw new Error(`Locale "${l}" is not in the config's locales (${cfg.locales.join(", ")}).`);
    }
  }

  switch (command) {
    case "doctor":
      return (await doctor(cfg)) ? 0 : 1;

    case "capture":
      await runCapture(cfg, devices, locales);
      return 0;

    case "frame":
      for (const d of devices) for (const l of locales) await renderScreenshots(cfg, d, l);
      if (!opt("device")) for (const l of locales) await renderFeatureGraphic(cfg, l);
      return 0;

    case "banner": {
      if (!resolvedFeatureGraphic(cfg)) {
        console.log(
          "The feature graphic is off: add an android device, or set featureGraphic.enabled: true.",
        );
        return 1;
      }
      for (const l of locales) console.log(await renderFeatureGraphic(cfg, l));
      return 0;
    }

    case "translate":
      return translate(cfg, opt("locale") ? [opt("locale")!] : cfg.locales.slice(1), {
        from: opt("from") ?? cfg.locales[0]!,
        force: argv.includes("--force"),
      });

    case "preview":
      for (const d of devices) for (const l of locales) await renderPreview(cfg, d, l);
      return 0;

    case "verify":
      return (await verifyAll(cfg, devices, locales)) ? 0 : 1;

    case "manifest":
      console.log(await writeManifest(cfg));
      return 0;

    case "studio": {
      await writeManifest(cfg);
      const url = await serveStudio(
        {
          paths: studioPaths(cfg.configPath),
          cli: [process.execPath, fileURLToPath(import.meta.url)],
        },
        opt("port") ? Number(opt("port")) : 4321,
      );
      console.log(`studio  ${url}`);
      if (!argv.includes("--no-open")) await openInBrowser(url);
      return new Promise<number>(() => {}); // serve until killed
    }

    case "all": {
      if (!(await doctor(cfg))) return 1;
      await runCapture(cfg, devices, locales);
      for (const d of devices) {
        for (const l of locales) {
          await renderScreenshots(cfg, d, l);
          await renderPreview(cfg, d, l);
        }
      }
      for (const l of locales) await renderFeatureGraphic(cfg, l);
      await writeManifest(cfg);
      console.log("\nverify");
      return (await verifyAll(cfg, devices, locales)) ? 0 : 1;
    }

    default:
      console.error(`Unknown command "${command}"\n${USAGE}`);
      return 1;
  }
}

// Works from both src/cli.ts and the bundled dist/cli.js: package.json is one
// directory up from either.
function packageVersion(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(pkg, "utf8")).version;
}

async function runCapture(cfg: LoadedConfig, devices: DeviceKey[], locales: string[]) {
  for (const d of devices) {
    const udid = await device.resolveUdid(d);
    try {
      await capture(cfg, d, locales);
    } finally {
      // Leave the device as it was found; a pinned status bar is sticky.
      await device.clearStatusBar(d, udid);
    }
  }
}

async function verifyAll(cfg: LoadedConfig, devices: DeviceKey[], locales: string[]) {
  let ok = true;
  for (const d of devices) for (const l of locales) ok = (await verify(cfg, d, l)) && ok;
  for (const l of locales) ok = (await verifyFeatureGraphic(cfg, l)) && ok;
  return ok;
}

/** `goldie locales [add|remove] <code...>`: the language list, kept in goldie.design.json. */
function manageLocales(cfg: LoadedConfig, args: string[]): number {
  const [action, ...codes] = args.filter((a) => !a.startsWith("--"));
  if (!action) {
    for (const code of cfg.locales) console.log(`${code.padEnd(10)} ${localeName(code)}`);
    return 0;
  }
  if ((action !== "add" && action !== "remove") || codes.length === 0) {
    console.error(
      "Usage: goldie locales [add|remove] <code...>   e.g. goldie locales add bn-BD de-DE",
    );
    return 1;
  }
  const bad = codes.filter((c) => !isLocaleCode(c));
  if (bad.length) {
    console.error(
      `Not a language code: ${bad.join(", ")}. Use BCP 47, like bn-BD or zh-Hans (goldie list).`,
    );
    return 1;
  }
  let next = [...cfg.locales];
  if (action === "add") next = [...new Set([...next, ...codes])];
  else next = next.filter((c) => !codes.includes(c));
  if (next.length === 0) {
    console.error("At least one locale must remain.");
    return 1;
  }
  writeDesign(cfg.configPath, { ...readDesign(cfg.configPath), locales: next });
  console.log(`locales: ${next.join(", ")}  (saved to goldie.design.json)`);
  if (action === "add") {
    console.log(`Next: goldie translate --locale ${codes[0]}   then goldie frame`);
  }
  return 0;
}

/** `goldie translate`: fills each locale's missing copy from the source locale. */
async function translate(
  cfg: LoadedConfig,
  targets: string[],
  opts: { from: string; force: boolean },
): Promise<number> {
  const source = collectCopy(cfg, opts.from);
  if (Object.keys(source).length === 0) {
    console.error(`No copy in the source locale "${opts.from}".`);
    return 1;
  }
  let design = readDesign(cfg.configPath);
  for (const locale of targets.filter((l) => l !== opts.from)) {
    const existing = collectCopy(cfg, locale);
    const todo = Object.fromEntries(
      Object.entries(source).filter(([key]) => opts.force || !existing[key]),
    );
    if (Object.keys(todo).length === 0) {
      console.log(`  ${locale}: nothing missing`);
      continue;
    }
    console.log(`  ${locale}: translating ${Object.keys(todo).length} text(s) from ${opts.from}…`);
    const done = await translateTexts(todo, opts.from, locale, { appName: cfg.store.name });
    design = mergeTranslations(design, locale, done);
    writeDesign(cfg.configPath, design);
    for (const [key, text] of Object.entries(done)) console.log(`    ${key}: ${text}`);
  }
  console.log("Saved to goldie.design.json. Review in goldie studio, then goldie frame.");
  return 0;
}

/** `goldie list`: what a config can name, for people and agents alike. */
function list(json: boolean): number {
  const data = {
    devices: DEVICE_KEYS.map((key) => ({
      key,
      platform: DEVICES[key].platform,
      formFactor: DEVICES[key].formFactor,
      screenshot: DEVICES[key].screenshot,
    })),
    layouts: LAYOUT_KEYS.map((key) => ({ key, description: LAYOUTS[key].description })),
    templates: TEMPLATE_KEYS.map((key) => ({
      key,
      description: TEMPLATES[key].description,
      sequence: TEMPLATES[key].sequence,
    })),
    bannerLayouts: BANNER_KEYS.map((key) => ({
      key,
      description: BANNER_LAYOUTS[key].description,
    })),
    fonts: ["system", ...FONT_KEYS],
    locales: LOCALES,
    featureGraphicId: FEATURE_GRAPHIC_ID,
  };
  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return 0;
  }
  const section = (title: string, rows: string[]) =>
    console.log(`\n${title}\n${rows.map((r) => `  ${r}`).join("\n")}`);
  section(
    "devices",
    data.devices.map(
      (d) =>
        `${d.key.padEnd(14)} ${d.platform} ${d.formFactor} ${d.screenshot.width}x${d.screenshot.height}`,
    ),
  );
  section(
    "layouts (theme.layout, scenes[].layout)",
    data.layouts.map((l) => `${l.key.padEnd(14)} ${l.description}`),
  );
  section(
    "templates (theme.template)",
    data.templates.map((t) => `${t.key.padEnd(14)} ${t.description}`),
  );
  section(
    "banner layouts (featureGraphic.layout)",
    data.bannerLayouts.map((b) => `${b.key.padEnd(14)} ${b.description}`),
  );
  section("fonts (--font)", data.fonts);
  section(
    "language codes (locales)",
    data.locales.map((l) => `${l.code.padEnd(10)} ${l.name}`),
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof FlowFailure) {
      console.error(repairBrief(err));
      process.exit(2);
    }
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
