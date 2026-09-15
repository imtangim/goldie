import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import {
  type DesignOverrides,
  FEATURE_GRAPHIC_ID,
  isScreenshot,
  type LoadedConfig,
  resolvedFeatureGraphic,
} from "./config.ts";
import { localeName } from "./locales.ts";

/**
 * Marketing copy keyed "<id>.<field>": every screenshot scene's headline and
 * subhead, plus the feature graphic's. The same keys the studio sends to
 * /api/translate, and the shape translations come back in.
 */
export type CopyTexts = Record<string, string>;

type Field = "headline" | "subhead";

/** The copy in one locale, as the render would read it (config plus studio edits). */
export function collectCopy(cfg: LoadedConfig, locale: string): CopyTexts {
  const out: CopyTexts = {};
  for (const scene of cfg.scenes.filter(isScreenshot)) {
    if (scene.headline[locale]) out[`${scene.id}.headline`] = scene.headline[locale]!;
    if (scene.subhead?.[locale]) out[`${scene.id}.subhead`] = scene.subhead[locale]!;
  }
  const fg = resolvedFeatureGraphic(cfg);
  if (fg?.headline[locale]) out[`${FEATURE_GRAPHIC_ID}.headline`] = fg.headline[locale]!;
  if (fg?.subhead[locale]) out[`${FEATURE_GRAPHIC_ID}.subhead`] = fg.subhead[locale]!;
  return out;
}

/** Splits a copy key into its scene (or feature graphic) id and field. */
export function parseCopyKey(key: string): { id: string; field: Field } | null {
  const dot = key.lastIndexOf(".");
  const field = key.slice(dot + 1);
  if (dot <= 0 || (field !== "headline" && field !== "subhead")) return null;
  return { id: key.slice(0, dot), field };
}

/** Layers translations into a design sidecar's `copy`. */
export function mergeTranslations(
  design: DesignOverrides,
  locale: string,
  texts: CopyTexts,
): DesignOverrides {
  const copy = { ...design.copy };
  for (const [key, text] of Object.entries(texts)) {
    const parsed = parseCopyKey(key);
    if (!parsed || typeof text !== "string") continue;
    const entry = { ...copy[parsed.id] };
    entry[parsed.field] = { ...entry[parsed.field], [locale]: text };
    copy[parsed.id] = entry;
  }
  return { ...design, copy };
}

/**
 * Translates store copy with the local Claude Code CLI (`claude -p`), which
 * the studio and `goldie translate` both use: no API key to configure on a
 * machine that already runs Claude Code. GOLDIE_TRANSLATE_CMD swaps in any
 * other command that reads the prompt on stdin and prints the JSON object.
 */
export async function translateTexts(
  texts: CopyTexts,
  from: string,
  to: string,
  context: { appName: string },
): Promise<CopyTexts> {
  const keys = Object.keys(texts);
  if (keys.length === 0) return {};
  const prompt = [
    `Translate this app store marketing copy for the app "${context.appName}" from ${localeName(from)} (${from}) to ${localeName(to)} (${to}).`,
    "They are screenshot headlines and subheads, so keep them short, natural and punchy for a native speaker, about the same length as the source. Do not translate the app name or other brand names.",
    "Reply with only a JSON object with exactly the same keys and the translated strings as values. No markdown, no commentary.",
    "",
    JSON.stringify(texts, null, 2),
  ].join("\n");

  const custom = process.env.GOLDIE_TRANSLATE_CMD;
  const [cmd, args] = custom
    ? ["sh", ["-c", custom]]
    : ["claude", ["-p", "--output-format", "text"]];
  const output = await run(cmd, args as string[], prompt).catch((err: Error) => {
    if ((err as { code?: string }).code === "ENOENT") {
      throw new Error(
        "Translation needs the Claude Code CLI (`claude`) on the PATH, or GOLDIE_TRANSLATE_CMD. " +
          "Alternatively write the translations into the config's copy records yourself.",
      );
    }
    throw err;
  });
  const json = output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`The translator did not return JSON:\n${output.slice(0, 400)}`);
  }
  const out: CopyTexts = {};
  for (const key of keys) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

function run(cmd: string, args: string[], stdin: string): Promise<string> {
  return new Promise((done, fail) => {
    // A neutral cwd keeps the translator from loading the app repo's context.
    // Launched from inside a Claude Code session (an agent running goldie),
    // the inherited session variables would bind the child to that session's
    // auth; the translator should use the CLI's own login.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^CLAUDE(CODE|_CODE_|_AGENT_SDK|_PID|_EFFORT)/.test(key),
      ),
    );
    const child = spawn(cmd, args, { cwd: tmpdir(), env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error("Translation timed out after 180s."));
    }, 180_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done(stdout);
      else {
        const detail = (stderr.trim() || stdout.trim()).slice(0, 400);
        const hint = /authenticate|log ?in|OAuth/i.test(detail)
          ? " Sign in to Claude Code in a terminal (run `claude`, then /login) and retry."
          : "";
        fail(new Error(`${cmd} exited with ${code}: ${detail}.${hint}`));
      }
    });
    child.stdin.end(stdin);
  });
}
