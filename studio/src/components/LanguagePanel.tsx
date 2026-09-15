import { LanguagesIcon, Loader2Icon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isLocaleCode, LOCALES, localeName } from "../../../src/locales";
import { Field, Select } from "./Sidebar";

/**
 * Languages: pick which one the strip shows, add or remove languages, and
 * fill untranslated copy with Claude. The list is saved to goldie.design.json
 * (it replaces the config's `locales`), so `goldie frame` renders every
 * language the studio lists. Untranslated copy falls back to the first
 * language, both here (dimmed) and in the export.
 */
export function LanguagePanel({
  locales,
  locale,
  onLocale,
  onLocales,
  missing,
  translating,
  translateError,
  onTranslate,
}: {
  locales: string[];
  locale: string;
  onLocale: (code: string) => void;
  onLocales: (codes: string[]) => void;
  /** Untranslated headlines and subheads per locale; the first locale is the source. */
  missing: (code: string) => number;
  /** The locale being translated right now, if any. */
  translating: string | null;
  translateError: string | null;
  onTranslate: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const source = locales[0];
  const add = (code: string) => {
    if (!locales.includes(code)) onLocales([...locales, code]);
    onLocale(code);
    setQuery("");
  };
  const remove = (code: string) => {
    const next = locales.filter((l) => l !== code);
    if (next.length === 0) return;
    onLocales(next);
    if (locale === code) onLocale(next[0]!);
  };
  const q = query.trim().toLowerCase();
  const candidates = LOCALES.filter(
    (l) =>
      !locales.includes(l.code) &&
      (!q ||
        l.code.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.native.toLowerCase().includes(q)),
  ).slice(0, 40);
  const customCode = query.trim();
  const canAddCustom =
    isLocaleCode(customCode) &&
    !locales.includes(customCode) &&
    !candidates.some((c) => c.code === customCode);
  const untranslated = locales.slice(1).filter((l) => missing(l) > 0);
  const current = missing(locale);

  return (
    <Field
      label="Language"
      hint={
        locale !== source && current > 0 ? `${current} not translated` : `${locales.length} total`
      }
    >
      <Select
        value={locale}
        onChange={onLocale}
        options={locales.map((l) => [
          l,
          `${localeName(l)} · ${l}${l !== source && missing(l) > 0 ? ` · ${missing(l)} missing` : ""}`,
        ])}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <LanguagesIcon className="size-3" aria-hidden />
              Manage languages
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-72 flex-col gap-3 p-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                In the store listing
              </span>
              {locales.map((l) => (
                <div
                  key={l}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col text-left"
                    onClick={() => onLocale(l)}
                  >
                    <span className="truncate text-xs">{localeName(l)}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {l}
                      {l === source
                        ? " · source"
                        : missing(l) > 0
                          ? ` · ${missing(l)} missing`
                          : " · translated"}
                    </span>
                  </button>
                  {l !== source && missing(l) > 0 ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Translate ${localeName(l)}`}
                      title="Translate missing copy with Claude"
                      disabled={translating !== null}
                      onClick={() => onTranslate([l])}
                    >
                      {translating === l ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <SparklesIcon />
                      )}
                    </Button>
                  ) : null}
                  {locales.length > 1 ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${localeName(l)}`}
                      onClick={() => remove(l)}
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Add a language</span>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search, or type a code like bn-BD"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (candidates[0]) add(candidates[0].code);
                  else if (canAddCustom) add(customCode);
                }}
              />
              <div className="flex max-h-44 flex-col overflow-y-auto">
                {canAddCustom ? (
                  <LanguageRow code={customCode} name="Custom code" onAdd={add} />
                ) : null}
                {candidates.map((l) => (
                  <LanguageRow
                    key={l.code}
                    code={l.code}
                    name={`${l.name} · ${l.native}`}
                    onAdd={add}
                  />
                ))}
              </div>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Untranslated copy shows the {source} text, dimmed. Click a tile's text to edit it, or
              translate with Claude. Capturing the app itself in each language needs{" "}
              <code>localizedCapture: true</code> in the config.
            </p>
          </PopoverContent>
        </Popover>
        {untranslated.length > 0 ? (
          <button
            type="button"
            disabled={translating !== null}
            onClick={() => onTranslate(untranslated)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {translating ? (
              <Loader2Icon className="size-3 animate-spin" aria-hidden />
            ) : (
              <SparklesIcon className="size-3" aria-hidden />
            )}
            {translating ? `Translating ${translating}…` : "Translate missing"}
          </button>
        ) : null}
      </div>
      {translateError ? (
        <p className="text-[11px] leading-snug text-destructive">{translateError}</p>
      ) : null}
    </Field>
  );
}

function LanguageRow({
  code,
  name,
  onAdd,
}: {
  code: string;
  name: string;
  onAdd: (code: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAdd(code)}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted"
    >
      <PlusIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
      <span className="text-[10px] text-muted-foreground">{code}</span>
    </button>
  );
}
