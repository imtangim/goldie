---
name: goldie
description: >-
  Create App Store and Play Store screenshots and preview videos for an iOS
  or Android app. goldie explores the app on a simulator or emulator, writes
  argent flows, renders framed screenshots and a preview video, and opens a
  local studio with the finished store page. Use this skill when the user
  asks for store screenshots, store assets, a preview video, a Google Play
  feature graphic or banner, translated or localized store screenshots, or
  mentions goldie. Also use it to change assets goldie made before: new
  headlines, another language, a different background, bezel, font, template
  or banner layout, or a new screenshot order. Run it from the mobile app's
  repo.
---

# goldie: App Store assets for the app in this repo

goldie replays argent YAML flows on an iOS simulator, captures raw screenshots
and recordings, and turns them into upload-ready assets: screenshots get a
device bezel, a background, and marketing copy; the preview video is the raw
recordings joined as-is, since Apple requires app previews to be a plain
screen recording with no framing or captions. A React studio shows the
result as the real store page. Your job is everything goldie cannot do alone:
pick the screens worth marketing, author the flows that reach them, write the
copy, and drive the pipeline.

The end state: 4 or 5 framed screenshots and the raw clips for a preview video,
visible in the studio at http://localhost:4321, with the video rendering in
the background.

## Before anything: check for an existing goldie setup

goldie keeps the whole outcome in files the user can re-prompt against. If
the app repo already has a config, this is a follow-up, so read it first and
skip to "Iterating on an existing setup" below rather than starting over:

```bash
ls goldie/goldie.config.ts .argent/flows/ 2>/dev/null; echo "GOLDIE_CONFIG=$GOLDIE_CONFIG"
```

Read `goldie/goldie.config.ts` in full and the flows it names. Together they
are the source of truth for every visible choice: which screens, in what
order, the headlines and subheads, the background and copy colors, the bezel,
the store listing, and the preview story. Nothing lives only in your head or
in the studio, so a user who says "make it darker" or "swap the search
screenshot for settings" is asking for an edit to those files.

## Step 0: Settle which stores to target

Which stores are in play follows from what the repo can build, so look before
asking. Check for an iOS target (an `.xcodeproj` / `.xcworkspace`, a Swift
package with an app target, an `ios/` directory) and an Android target (a
`build.gradle[.kts]` with an application module, an `android/` directory).

- **Single-platform repo** — native Android only, or iOS/Swift only. There is
  one possible answer, so do not ask: target that store and say which one you
  picked and why in your first message.
- **Cross-platform repo** — React Native, Expo, Flutter, Kotlin Multiplatform,
  or anything else with both an iOS and an Android target. Always ask before
  doing anything else, even when the user already named one platform: a prompt
  that says "Play Store screenshots" often still means "and the App Store
  too", and the answer decides work that is expensive to redo. If an
  interactive question tool is available (such as AskUserQuestion in Claude
  Code), use it with multiple selections allowed, preselecting or leading with
  whatever the user named; otherwise ask in chat and let the user pick one or
  both.

The two options:

- **Apple App Store (iPhone)**: framed iPhone screenshots and an app preview
  video, captured on an iOS simulator.
- **Google Play Store (Android)**: Play phone screenshots captured on an
  Android emulator, plus a portrait preview video; the Play promo video is
  a YouTube link, so the user posts the video there themselves.

Both can be selected; scenes and flows are shared across stores. The answer
decides which device keys go in the config, which builds Step 1 must find
(iOS simulator build, Android APK, or both), and whether the Google Play
section below applies. On a follow-up to an existing setup, the config's
devices already answer this, so do not ask again.

## Step 0.5: Make sure goldie runs

goldie is a CLI that bundles the studio and a pinned argent driver. This
build (0.5+, with custom fonts, Android tablets, languages, translation and feature graphics) is
installed globally from the imtangim/goldie fork, so call the `goldie` binary
directly; `npx -y goldie@0` would fetch the older npm release instead:

```bash
goldie version   # 0.5.2 or newer
```

If `goldie` is missing or older, install it from the fork:
`git clone git@github-personal:imtangim/goldie.git && cd goldie && bun install && bun run build && npm pack && npm i -g ./goldie-*.tgz`.

Every command below is `goldie <cmd>`. `goldie help` lists them all, and
`goldie list` (or `goldie list --json`) prints every valid device key, layout,
template, banner layout, font key and language code; check it rather than
guessing a key, since a wrong key fails the run.
It needs Node 20+ and `ffmpeg` on the PATH (`brew install ffmpeg` on macOS,
`winget install ffmpeg` on Windows, `apt install ffmpeg` on Linux). iOS
devices need a macOS host; on Linux and Windows only the Android device
(`pixel-10-pro`) can run, so leave the iOS keys out of `devices` there. If
`$GOLDIE_ROOT` is set, the user is working from a source checkout; run
`bun $GOLDIE_ROOT/src/cli.ts <cmd>` instead. All app-specific files live in
the app repo.

## Step 1: Gather app facts

What to look for depends on the stores chosen in Step 0.

- **App name and identifier.** iOS: the Xcode project, `app.json` /
  `app.config.*` (Expo), or `Info.plist`. Android: `applicationId` in
  `app/build.gradle[.kts]`, or the Expo config's `android.package`.
- **An iOS Release simulator build** (App Store only). Look for the newest
  `~/Library/Developer/Xcode/DerivedData/<App>-*/Build/Products/Release-iphonesimulator/<App>.app`.
  If only Debug exists, build Release: a Debug build needs Metro and paints
  LogBox banners into the captures, so it makes unusable marketing assets.
- **An Android APK** (Google Play only). A release APK is best; build it with
  the repo's own scripts or `./gradlew :app:assembleRelease`, and note that an
  unsigned release APK will not install. A debug APK is acceptable for a
  native Android app, which paints no debug overlay; for React Native, a debug
  APK needs Metro and shows the dev overlay, so build release there.

Use the repo's own build scripts whenever it has them.

## Step 2: Explore the app and choose the scenes

Use argent MCP tools to see the app before deciding anything. Boot the device
for the store you are targeting: an iPhone 16 Pro Max class simulator for the
App Store, a Pixel 10 Pro (or Pixel 9 Pro) AVD for Google Play. Install the
build, launch it, and walk the main screens with `describe` and `screenshot`.
Also check the app repo for existing recorded flows in `.argent/flows/`; they
are the best source of working selectors and coordinates. When both stores are
targeted, explore on one device and keep the selectors text- and id-based so
the same flows replay on the other.

Choose:

- **4 or 5 screenshot scenes.** Each is one screen that sells a feature: the
  main list, a detail view, search, a distinctive feature screen. Prefer
  screens with real-looking content.
- **A 3 or 4 segment preview story.** One short user journey told in order,
  for example: see the main screen, start a core action, complete it, see the
  result. Each segment becomes one clip. The clips are joined with no captions
  or framing, so each step must read on its own. For the App Store the total
  video must land between 15 and 30 seconds. Google Play takes a YouTube link
  instead of an upload, so the Android video is rendered for the user to post
  themselves and has no duration bounds; when both stores are targeted, aim
  for the Apple window.

While exploring, note the exact visible text labels and accessibility ids you
will need as selectors, and normalized coordinates for anything with no label
(icon-only tab bars are the usual case).

## Step 3: Author the config and flows

The flows are argent flows and belong in the app's own flow store, next to any
flow already recorded there. The config sits in a `goldie/` directory:

```
<app-repo>/
├── .argent/flows/
│   ├── store-01-<scene>.yaml ...        one per screenshot scene
│   └── store-preview-01-<segment>.yaml  one per preview segment
└── goldie/goldie.config.ts
```

A scene names its flow the way `argent flow run <name>` does: `flow:
"store-01-home"` runs `.argent/flows/store-01-home.yaml`. Prefix the marketing
flows so they read apart from the app's test flows, and reuse an existing flow
by name when one already reaches the screen. `flowsDir` in the config overrides
the location; the default is `.argent/flows` under `appRoot`.

Read `references/config.md` for the config schema, an annotated example, and
copywriting guidance. Read `references/flows.md` for the flow YAML vocabulary
and the conventions that keep flows replayable. Write the headlines and
subheads yourself in the app's voice; they are the marketing layer, so make
them benefit-led and short.

Everything renders relative to the config file: output lands in
`<app-repo>/goldie/out/`. Add `goldie/out/` to the app's `.gitignore`, and
commit `goldie.config.ts` and the flows.

Because they are plain argent flows, each one is runnable on its own with
`argent flow run store-01-home` from the app repo, which is the fastest way to
check a flow before a full capture.

## Step 4: Doctor, then capture

Every goldie command reads the config path from the `GOLDIE_CONFIG` env var.
Shell state does not persist between your Bash calls, so prefix every goldie
command with it:

```bash
GOLDIE_CONFIG=<app-repo>/goldie/goldie.config.ts goldie doctor
```

Fix everything doctor flags before capturing. The usual findings and their
fixes are in the Gotchas section of goldie's README; the common ones are the
argent video watermark flag, a screenshot scale override, and a Debug build.

Then capture and render the stills (skip the video for now, it takes minutes):

```bash
GOLDIE_CONFIG=... goldie capture
GOLDIE_CONFIG=... goldie frame
GOLDIE_CONFIG=... goldie manifest
```

`capture` replays every flow, including the preview segments, so the raw clips
exist for the lazy video render later.

### When a flow breaks

Flows replay with no LLM, so a wrong selector fails loudly. goldie prints the
failed step and argent's reason. Fix it over argent MCP: `describe` the live
screen to find the real label or id, correct the YAML, and re-run capture.
Prefer `text:` and `id:` selectors; when only a coordinate works, add an
`echo:` step above it explaining what it points at, so the next repair knows
what to re-resolve.

## Step 5: Open the studio, render the video lazily

Start the studio in the background. It needs `GOLDIE_CONFIG` too, so it
serves the app repo's `out/`:

```bash
GOLDIE_CONFIG=... goldie studio --no-open   # background task; serves http://localhost:4321
```

Tell the user it is up at http://localhost:4321. Then, also in the background,
render the preview video so it appears on reload once done:

```bash
GOLDIE_CONFIG=... goldie preview && GOLDIE_CONFIG=... goldie manifest
```

If `preview` refuses because the total is outside 15 to 30 seconds, adjust
segment pacing (`wait:` steps and `holdSeconds`) and re-capture only what
changed.

Finish with `GOLDIE_CONFIG=... goldie verify` and report the result: which
assets exist, where they are, and whether they pass Apple's rules. The
studio's sidebar shows the same checks; a red row is a rule violation. The
Design panel lets the user restyle backgrounds, layouts, bezels and fonts
without you, and Export downloads an upload-ready zip.

## Google Play

The `pixel-10-pro` device key renders Play phone screenshots (1080 x 1920)
from the same scenes: scenes and flows are shared across devices, and argent
flows replay on Android when their selectors match. Add the config's
`android: { appPath: "<apk>", applicationId: "<id>" }` block, make sure an
AVD with the Pixel 10 Pro or Pixel 9 Pro hardware profile exists (same
screen; goldie reuses a running emulator or boots the AVD itself), then run
the same capture/frame commands. Android tiles are framed with the bundled
Pixel 10 Pro bezel instead of the config's `frame` variant (iPhone art);
`android.frame` replaces it with your own art. Play takes no video uploads
(the promo video is a YouTube link), so `preview` renders a 1080x2400
portrait video for the user to post on YouTube themselves; no duration
bounds apply to it.

The `pixel-tablet` device key renders Play tablet screenshots (2560 x 1440,
**landscape**) from the same scenes, framed with the bundled Pixel Tablet
bezel (`android.tabletFrame` overrides it). It needs an AVD with the
`pixel_tablet` hardware profile.

Tablet captures stay landscape on purpose: argent reports element positions
in the unrotated display space, so an emulator pinned to portrait makes every
tap miss and flows fail on their first step. Do not add a rotation pin to work
around a layout you dislike. What this means for flows: they replay against
the app's landscape tablet layout, which often places controls differently
from the phone. Explore the tablet with argent before reusing phone flows, and
give a scene its own flow (or `localeFlows`-style variant) when a selector or
coordinate only exists in the phone layout. Verify a rendered tablet tile by
eye before reporting done.

### The feature graphic (banner)

Google Play requires a 1024 x 500 feature graphic. goldie renders one per
locale into `out/feature-graphic/<locale>/feature-graphic.png` whenever the
config has an android device (`featureGraphic.enabled: false` turns it off,
`true` forces it for an iOS-only config). `goldie frame` and `goldie all`
include it; `goldie banner` renders only the banner. By default the headline
is the store name, the subhead the store subtitle, and the devices show the
first screenshot scenes' captures on the first android device. Set a real
headline: the banner is the first thing a Play visitor sees.

```ts
featureGraphic: {
  layout: "duo",                                   // goldie list: split, split-right, tilt, duo, trio, showcase, centered
  headline: { "en-US": "Budgets that keep up" },
  subhead: { "en-US": "Track every taka in seconds" },
  scenes: ["home", "stats"],                       // captures for device 0, 1, 2
  // background: "#0F172A",                        // else theme.background
  // device: "pixel-10-pro",                       // whose captures and bezel
},
```

A custom banner template replaces the key with a spec, every value a fraction
of the banner (x and y are centres; device `height` above 1 bleeds off the
edge; devices are listed back to front, at most three):

```ts
featureGraphic: {
  layout: {
    copy: { x: 0.06, y: 0.5, width: 0.45, align: "left", headlineSize: 0.12 },  // copy: null for no text
    devices: [
      { x: 0.72, y: 0.7, height: 1.1, rotate: -6, capture: 1 },
      { x: 0.86, y: 0.6, height: 1.25, rotate: 4, capture: 0 },
    ],
  },
  headline: { "en-US": "..." },
},
```

Check a banner by rendering it and looking at the PNG before reporting back.

## Languages and localization

The config's `locales` lists the store languages; the first is the source
the others translate from. Every copy record (`headline`, `subhead`, badge
`text`, `featureGraphic.headline` / `subhead`, `store.subtitle` /
`description`) takes one entry per locale. A locale without an entry renders
the source locale's copy and `frame` prints a `!` warning naming what is
untranslated, so a new language never blocks a render.

When the user asks for a language (or several):

1. `goldie locales add bn-BD de-DE` (codes from `goldie list`). This saves
   the list to `goldie.design.json`, the same place the studio's Language
   picker writes; `goldie locales` prints it and `goldie locales remove <code>`
   drops one. Editing `locales` in the config works too.
2. Translate the copy. You are the better translator here: you know the app
   and its voice, so write the translations straight into each copy record in
   `goldie.config.ts` (short, natural, same length as the source; keep brand
   names). `goldie translate --locale <code>` is the non-agent route: it
   fills only missing copy into `goldie.design.json` using the local `claude`
   CLI, which must be signed in; `--force` retranslates everything.
3. Check fonts: for Bengali, Arabic, Thai, Devanagari and other non-latin
   scripts, `goldie doctor` warns when no custom font covers the script (see
   below). CJK is covered by the bundled Noto Sans SC (not Korean).
4. `goldie frame && goldie manifest`, then look at one rendered tile per new
   language before reporting.

In the studio the user does the same without you: Language > Manage
languages adds or removes a language, "Translate missing" calls Claude, and
clicking any headline, subhead or banner text edits it for the chosen
language. Studio edits live in `goldie.design.json` under `copy`, keyed by
scene id (and `feature-graphic`), then field, then locale; they override the
config's copy, so read that file too before editing copy the user says they
changed.

By default one capture in `locales[0]` is reused under every locale's copy. Set `localizedCapture: true` to capture each locale with
the device switched to it (simulator language on iOS; per-app locale on
Android 13+), into `out/raw/<device>/<locale>/`. Flows that select by visible
text break in other languages: prefer ids or coordinates, or add
`localeFlows: { "<locale>": "<flow>" }` on the scene or segment. Re-capture
one locale with `goldie capture --locale <code>`.

For a script the bundled fonts cannot draw, add the typeface to `fonts`
(`{ family, files: { 400: "path.ttf", 700: "path.ttf" } }`, paths relative to
the config) and point `theme.localeFonts["<locale>"]` at it. Never download a
font for the user without asking; ask them for the files or the family they
want.

## Iterating on an existing setup

A follow-up prompt maps onto a small change in the config or a flow, then
the cheapest stage that reflects it. Do not re-explore the app or rewrite
scenes the user did not mention. Report which file and field you changed so
the next prompt can build on it.

| The user asks for | Edit | Then run |
|---|---|---|
| Different headline, subhead or store copy | `scenes[].headline` / `subhead`, `store.*` | `frame`, `manifest` |
| A new look: background, text colors, font, sizing | `theme.*`, or `scenes[].background` for one tile | `frame`, `manifest` |
| A different bezel, or no bezel | `frame.variant`, `theme.screenOnly` | `frame`, `manifest` |
| A varied strip: panorama opener, hero, tilted tiles, a breather | `theme.template`: a built-in key (`editorial`, `showcase`, `magazine`, `storyboard`, `dynamic`, `bold`, `clean`, `playful`, `gallery`) or a sequence of layout keys (see `references/config.md`) | `frame`, `manifest` |
| A different layout for every tile, or one | `theme.layout`, or `scenes[].layout` for one tile | `frame`, `manifest` |
| Two screens in one tile, or a two-tile panorama | `scenes[].layout: "duo"` / `"panorama-duo"` plus `secondScene`, or `"panorama"` | `frame`, `manifest` |
| A badge, sticker or logo on the tiles | `theme.decorations` (all) or `scenes[].decorations` (one) | `frame`, `manifest` |
| Dark mode captures | `appearance: "dark"` (and text colors to match) | `capture`, `frame`, `manifest` |
| Reorder, drop or add a screenshot | `scenes[]`; a new scene needs a new flow in `.argent/flows` | `capture` (new flows), `frame`, `manifest` |
| Show a different state on one screen | the scene's flow YAML | `capture`, `frame`, `manifest` |
| Change the preview story or its pacing | preview `segments[]`, `holdSeconds`, flow `wait:` steps | `capture`, `preview`, `manifest` |
| Another language | `goldie locales add <code>`, then translations in every copy record | `frame`, `manifest` (add `capture` with `localizedCapture`) |
| Translate into a language already listed | a `<locale>` entry in every copy record (or `goldie translate --locale <code>`) | `frame`, `manifest` |
| A Google Play feature graphic / banner | `featureGraphic` (headline, subhead, layout) | `banner`, `manifest` |
| A different or custom banner layout | `featureGraphic.layout`: a key from `goldie list`, or a `{ copy, devices }` spec | `banner`, `manifest` |
| The app's own UI translated in each locale | `localizedCapture: true`, `localeFlows` for text-selector flows | `capture`, `frame`, `manifest` |
| A custom font, or one per language | `fonts` plus `theme.fontFamily` / `theme.localeFonts` | `frame`, `manifest` |
| Android tablet screenshots (landscape) | add `pixel-tablet` to `devices`; check flows against the tablet's landscape layout | `capture --device pixel-tablet`, `frame`, `manifest` |

`capture` replays every flow; to re-capture only what changed, keep the
other scenes as they are and accept the extra minute, or delete only the
stale files under `out/raw/` before running it. `frame` and `manifest` take
seconds, so run them freely. The studio at http://localhost:4321 picks up
changes on reload; start it again with `GOLDIE_CONFIG` if it is not running.

The studio's Design panel writes to `goldie.design.json` next to the config
(design choices, copy edits, the language list, uploaded fonts, the banner
layout), and the CLI's `--background` / `--frame` / `--font` / `--template` /
`--layout` / `--screen-only` / `--banner` flags are one-run overrides; neither
touches the config. If the user tried something there and wants to keep it, copy the
value into `theme.background`, `frame.variant`, `theme.fontFamily`,
`theme.template`, `theme.layout` or `scenes[].layout` so the next re-prompt
starts from what they see. The
current on-disk values are also in `goldie/out/web/store.json` under `design`,
which is the fastest way to confirm what the studio is showing right now.

