"use client";

import * as React from "react";
import { Plus, Smile } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys",
    emojis: [
      "😀", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂",
      "😉", "😊", "😇", "🥰", "😍", "😘", "😜", "🤪",
      "🤔", "🤨", "😐", "🙄", "😏", "😬", "🫠", "🙃",
      "😮", "😱", "😴", "🥱", "🥳", "😎", "🤓", "🫡",
      "😢", "😭", "😤", "😳", "🤯", "😷", "🤞", "🤗",
    ],
  },
  {
    label: "Gestures",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤝", "🙏", "👏", "🙌",
      "💪", "🤷", "🤦", "👋", "✍️", "🫶", "👀", "🤌",
    ],
  },
  {
    label: "Hearts & celebration",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💕",
      "🎉", "🎊", "✨", "🔥", "⭐", "🌟", "🎂", "🥂",
    ],
  },
  {
    label: "Work & practical",
    emojis: [
      "✅", "❌", "⚠️", "❗", "❓", "💡", "📌", "📎",
      "📅", "⏰", "☕", "🚀", "🎯", "💬", "📣", "🧠",
      "📚", "✏️", "🔍", "🧩", "🛠️", "📈", "📉", "🗓️",
    ],
  },
  {
    label: "Nature & travel",
    emojis: [
      "☀️", "🌈", "🌧️", "❄️", "🌞", "🌙", "🌊", "🌸",
      "🐶", "🐱", "🦆", "🚲", "🚆", "✈️", "🏡", "🇩🇰",
    ],
  },
];

/** Gmail's quick-reaction six. */
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "🙏"];

/** Best-effort search keywords for the curated set. */
const EMOJI_KEYWORDS: Record<string, string> = {
  "😀": "grinning happy smile",
  "😄": "smile happy grin",
  "😁": "beaming grin teeth",
  "😆": "laughing squint haha",
  "😅": "sweat smile phew",
  "😂": "joy laughing tears haha funny",
  "🤣": "rofl rolling laughing funny",
  "🙂": "slight smile ok",
  "😉": "wink",
  "😊": "blush smiling happy",
  "😇": "halo innocent angel",
  "🥰": "love hearts adore smiling",
  "😍": "heart eyes love",
  "😘": "kiss love",
  "😜": "wink tongue silly",
  "🤪": "zany crazy silly",
  "🤔": "thinking hmm",
  "🤨": "raised eyebrow skeptical",
  "😐": "neutral meh",
  "🙄": "eye roll",
  "😏": "smirk",
  "😬": "grimace awkward yikes",
  "🫠": "melting",
  "🙃": "upside down",
  "😮": "wow surprised open mouth",
  "😱": "scream shocked",
  "😴": "sleeping zzz tired",
  "🥱": "yawn tired bored",
  "🥳": "party celebrate birthday",
  "😎": "cool sunglasses",
  "🤓": "nerd glasses",
  "🫡": "salute yes sir",
  "😢": "sad tear cry",
  "😭": "sob crying loud",
  "😤": "huff frustrated steam",
  "😳": "flushed embarrassed",
  "🤯": "mind blown exploding head",
  "😷": "mask sick ill",
  "🤞": "fingers crossed luck hope",
  "🤗": "hug hands",
  "👍": "thumbs up yes ok like approve",
  "👎": "thumbs down no dislike",
  "👌": "ok perfect fine",
  "✌️": "peace victory",
  "🤝": "handshake deal agree",
  "🙏": "thanks please pray gratitude",
  "👏": "clap applause bravo",
  "🙌": "raised hands celebrate hooray",
  "💪": "strong muscle flex",
  "🤷": "shrug dunno",
  "🤦": "facepalm doh",
  "👋": "wave hello goodbye hi bye",
  "✍️": "writing hand",
  "🫶": "heart hands love",
  "👀": "eyes looking watch",
  "🤌": "pinched fingers chef kiss",
  "❤️": "red heart love",
  "🧡": "orange heart",
  "💛": "yellow heart",
  "💚": "green heart",
  "💙": "blue heart",
  "💜": "purple heart",
  "🖤": "black heart",
  "💕": "two hearts love",
  "🎉": "party popper tada celebrate congrats",
  "🎊": "confetti celebrate",
  "✨": "sparkles magic",
  "🔥": "fire hot lit",
  "⭐": "star",
  "🌟": "glowing star",
  "🎂": "birthday cake",
  "🥂": "cheers champagne toast celebrate",
  "✅": "check done yes complete",
  "❌": "cross no wrong",
  "⚠️": "warning caution",
  "❗": "exclamation important",
  "❓": "question",
  "💡": "idea lightbulb",
  "📌": "pin",
  "📎": "paperclip attach",
  "📅": "calendar date",
  "⏰": "alarm clock time",
  "☕": "coffee tea break",
  "🚀": "rocket launch ship",
  "🎯": "target dart goal",
  "💬": "speech chat message",
  "📣": "megaphone announce",
  "🧠": "brain smart",
  "📚": "books reading",
  "✏️": "pencil write",
  "🔍": "search magnifier find",
  "🧩": "puzzle piece",
  "🛠️": "tools hammer wrench fix",
  "📈": "chart up growth increase",
  "📉": "chart down decrease",
  "🗓️": "calendar schedule",
  "☀️": "sun sunny",
  "🌈": "rainbow",
  "🌧️": "rain cloud",
  "❄️": "snow cold winter",
  "🌞": "sun face",
  "🌙": "moon night",
  "🌊": "wave sea ocean",
  "🌸": "blossom flower spring",
  "🐶": "dog puppy",
  "🐱": "cat kitten",
  "🦆": "duck",
  "🚲": "bike bicycle",
  "🚆": "train",
  "✈️": "plane travel flight",
  "🏡": "house home",
  "🇩🇰": "denmark danish flag",
};

/**
 * Gmail-style quick emoji reply: a pill with the six standard reactions and a
 * "+" that expands into a searchable grid. Picking calls `onPick` and closes.
 */
export function EmojiReactionButton({
  onPick,
  disabled,
  className,
  side = "top",
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  /** For a compact trigger — a hover rail beside a message, say. */
  className?: string;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const pick = (emoji: string) => {
    setOpen(false);
    onPick(emoji);
  };

  const q = query.trim().toLowerCase();
  const allEmojis = EMOJI_GROUPS.flatMap((g) => g.emojis);
  const shown = q
    ? allEmojis.filter((e) => (EMOJI_KEYWORDS[e] ?? "").includes(q))
    : allEmojis;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setExpanded(false);
          setQuery("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="React with an emoji"
          aria-label="React with an emoji"
          className={
            className ??
            "inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white p-2.5 text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          }
        >
          <Smile className={className ? "h-4 w-4" : "h-5 w-5"} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className={cn(
          "shadow-lg",
          expanded ? "w-[360px] rounded-2xl p-3" : "w-auto rounded-full px-3 py-1.5"
        )}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-0.5">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-lg p-1.5 text-2xl leading-none hover:bg-stone-100"
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-stone-200" />
          <button
            type="button"
            title="More emoji"
            aria-label="More emoji"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100",
              expanded && "bg-stone-100"
            )}
            onClick={() => {
              setExpanded((v) => !v);
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {expanded ? (
          <>
            <input
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji"
              className="mt-2 w-full rounded-full border border-stone-200 px-3.5 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-300"
            />
            <div className="mt-2 grid max-h-72 grid-cols-7 overflow-y-auto">
              {shown.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="flex h-11 items-center justify-center rounded-lg text-[26px] leading-none hover:bg-stone-100"
                  onClick={() => pick(emoji)}
                >
                  {emoji}
                </button>
              ))}
              {!shown.length ? (
                <p className="col-span-7 py-4 text-center text-sm text-stone-400">
                  No matches
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Toolbar button that opens a small emoji grid; picking one calls `onPick`
 * and closes the popover.
 */
export function EmojiPickerButton({
  onPick,
  className,
}: {
  onPick: (emoji: string) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Insert emoji"
          aria-label="Insert emoji"
          className={
            className ??
            "flex h-7 w-7 items-center justify-center rounded text-stone-500 hover:text-stone-800"
          }
        >
          <Smile className="h-5 w-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[360px] p-2.5"
        // Keep the caret in the editor after picking, instead of Radix
        // returning focus to the trigger button.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-80 overflow-y-auto">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-1 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 first:pt-0.5">
                {group.label}
              </p>
              <div className="grid grid-cols-7">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="flex h-11 items-center justify-center rounded-lg text-[26px] leading-none hover:bg-stone-100"
                    onClick={() => {
                      onPick(emoji);
                      setOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
