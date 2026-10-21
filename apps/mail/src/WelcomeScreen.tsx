/**
 * The one-time welcome screen. Three short steps first show what other mail
 * apps do not have: stacked threads (Off and On side by side, to pick
 * one), mail on your own terms (pausing new mail and choosing when a
 * mailbox is shown, each with a picture of where it lives, in the theme's
 * light or dark), and the buttons that hide the list and show folders and
 * filters.
 * After them, on its own screen, "Private by design": To-Do's WelcomeScreen, with the
 * same markup and class names, so the two stay alike.
 * Shown until accepted (and on every launch of a dev build, via alwaysShow),
 * in the main window of both the public and the team build. Accepting is saved by
 * eula.ts, which also lets the usage count start; raising EULA_REVISION
 * there shows it to everyone again.
 */
import * as React from "react";
import { Folder, GalleryVerticalEnd, PanelLeft, Users } from "lucide-react";

import { useMailViewMode } from "@/components/mail/mail-list-state";
import { useMailLang, type MailLang } from "@/lib/mail/i18n";
import { useMailColorMode } from "@/lib/mail/theme";
import { openExternalUrl } from "@/lib/native-shell";

import { FetchTile, ShownTile } from "@/components/mail/hours-icons";

import pausePictureDarkUrl from "../docs/screenshots/welcome-pause.png";
import pausePictureLightUrl from "../docs/screenshots/welcome-pause-light.png";
import showPictureDarkUrl from "../docs/screenshots/welcome-show.png";
import showPictureLightUrl from "../docs/screenshots/welcome-show-light.png";
import aroundPictureDarkUrl from "../docs/screenshots/around.png";
import aroundPictureLightUrl from "../docs/screenshots/around-light.png";
import aroundSpots from "../docs/screenshots/around-spots.json";
import logoUrl from "./mail-logo.svg";
import { acceptEula, eulaAccepted } from "./eula";
import "./welcome-screen.css";

const PRIVACY_URL = "https://digitalhabits.org/privacy-policy#usage-count";
const EULA_URL = "https://digitalhabits.org/eula";
const SOURCE_URL = "https://github.com/digitalhabits/dh-mail";
/**
 * The tour: stacked threads, mail on your own terms, the way around.
 * Privacy and the EULA come after it, on a screen of their own.
 */
const TOUR_STEPS = 3;

const COPY: Record<MailLang, Record<string, string>> = {
  en: {
    title: "Welcome to Digital Habits: Mail",
    subtitle:
      "Your email in one calm place, with focused inboxes and fewer interruptions.",
    privacyTitle: "Private by design",
    privacyLead: "We collect no personal data. We only count how many people use Mail.",
    howWeCount: "How we count",
    howWeCountBody:
      "At most once a day, on a day you use Mail, it sends one anonymous count with an ID that changes every month. You can turn it off in Settings.",
    privacyPolicy: "Privacy Policy",
    agree: "I agree to Centre for Digital Habits'",
    eula: "End User License Agreement",
    continue: "Continue",
    org: "Centre for Digital Habits",
    orgUrl: "https://digitalhabits.org",
    footer:
      "is a not-for-profit creating digital focus tools in collaboration with researchers at the universities of Oxford (UK), Copenhagen (DK), Maastricht (NL), and Santa Clara (US).",
    source: "View the source code on GitHub",
    next: "Next",
    back: "Back",
    step: "Step {n} of {total}",
    stacksTitle: "Less clutter in your inbox",
    stacksLead:
      "Emails from one sender stack into one row, even with different subjects. Click the stack to unfold it.",
    stacksTry: "Stack threads from the same sender",
    stacksOnRecommended: "On (recommended)",
    stacksOff: "Off",
    // Invented: no real airline.
    stacksAirline: "Nordvind Air",
    // Newest first, as the list shows them.
    stacksAirlineSubjects: "Your boarding pass|Check in for your flight|Your booking is confirmed",
    stacksThreadCount: "{count} threads",
    stacksLibrary: "Library",
    stacksLibrarySubject: "Your books are due",
    stacksLater: "You can change this later with the Stacks switch at the top.",
    stacksSwitchLabel: "Stacks",
    aroundTitle: "Find your way around",
    hideListTitle: "Hide the mail list",
    hideListBody:
      "Then you see only the email you read. Bring the pointer to the left edge, and the list comes back.",
    foldersTitle: "Folders",
    foldersBody: "Click to show the folders of all your mailboxes.",
    filterTitle: "Filters",
    filterBody: "Click In Contacts to see only mail from people in your contacts. With + you make a list of your own.",
    quietTitle: "Check mails on your own terms",
    pauseTitle: "Pause new mail",
    pauseBody:
      "For example, stop new emails for an hour when you need to focus. Or choose that new email never arrives after 10pm.",
    hideTitle: "Choose when a mailbox is shown",
    hideBody: "For example, show your work mailbox only on weekdays.",
    quietLater: "You can set pause/show hours for each account when you connect it.",
    aroundPictureAlt:
      "The left of the Mail window: the button that hides the list beside New email, the folders, and the mail list with its folders button and its tabs All, In Contacts and Other",
    pausePictureAlt:
      "An account's menu, opened from its tab, on New mail arrives: pause new mail for an hour, until tomorrow, or until a time, the words to type to get new mail early, and the hours when new mail arrives",
    showPictureAlt:
      "An account's menu, opened from its tab, on Shown in Mail: hide it for an hour, until tomorrow, or until you show it, the words to type to show it early, and the hours when it is shown",
  },
  da: {
    title: "Velkommen til Digital Habits: Mail",
    subtitle:
      "Din e-mail samlet ét roligt sted, med fokuserede indbakker og færre afbrydelser.",
    privacyTitle: "Privatliv som udgangspunkt",
    privacyLead: "Vi indsamler ingen persondata. Vi tæller kun, hvor mange der bruger Mail.",
    howWeCount: "Sådan tæller vi",
    howWeCountBody:
      "Højst én gang om dagen, på en dag hvor du bruger Mail, sender appen én anonym optælling med et ID, der skifter hver måned. Du kan slå det fra under Indstillinger.",
    privacyPolicy: "Privatlivspolitik",
    agree: "Jeg accepterer Center for Digitale Vaners",
    eula: "brugerbetingelser",
    continue: "Fortsæt",
    org: "Center for Digitale Vaner",
    orgUrl: "https://digitalevaner.dk",
    footer:
      "er en non-profit, der bygger digitale fokusværktøjer i samarbejde med forskere ved universiteterne i Oxford (UK), København (DK), Maastricht (NL) og Santa Clara (US).",
    source: "Se kildekoden på GitHub",
    next: "Næste",
    back: "Tilbage",
    step: "Trin {n} af {total}",
    stacksTitle: "Mindre rod i din indbakke",
    stacksLead:
      "E-mails fra én afsender samles i én række, også med forskellige emner. Klik på stakken for at folde den ud.",
    stacksTry: "Saml tråde fra samme afsender",
    stacksOnRecommended: "Til (anbefalet)",
    stacksOff: "Fra",
    stacksAirline: "Nordvind Air",
    stacksAirlineSubjects: "Dit boardingkort|Tjek ind til din flyrejse|Din booking er bekræftet",
    stacksThreadCount: "{count} tråde",
    stacksLibrary: "Biblioteket",
    stacksLibrarySubject: "Dine bøger skal afleveres",
    stacksLater: "Du kan ændre det senere med Stakke-kontakten øverst.",
    stacksSwitchLabel: "Stakke",
    aroundTitle: "Sådan finder du rundt",
    hideListTitle: "Skjul postlisten",
    hideListBody:
      "Så ser du kun den e-mail, du læser. Før markøren til venstre kant, så kommer listen frem igen.",
    foldersTitle: "Mapper",
    foldersBody: "Klik for at vise mapperne fra alle dine postkasser.",
    filterTitle: "Filtre",
    filterBody: "Klik på I Kontakter for kun at se post fra personer i dine kontakter. Med + laver du din egen liste.",
    quietTitle: "Tjek din post på dine egne præmisser",
    pauseTitle: "Sæt ny post på pause",
    pauseBody:
      "Stop for eksempel nye e-mails i en time, når du skal fokusere. Eller vælg, at ny e-mail aldrig kommer efter kl. 22.",
    hideTitle: "Vælg, hvornår en postkasse vises",
    hideBody: "Vis for eksempel kun din arbejdspostkasse på hverdage.",
    quietLater: "Du kan vælge tider for pause og visning for hver konto, når du forbinder den.",
    aroundPictureAlt:
      "Venstre side af Mail-vinduet: knappen der skjuler listen ved siden af Ny e-mail, mapperne, og postlisten med dens knap til mapper og dens faner Alle, I Kontakter og Andre",
    pausePictureAlt:
      "En kontos menu, åbnet fra dens fane, under Ny post kommer: sæt ny post på pause i en time, til i morgen eller til et tidspunkt, ordene du skal skrive for at hente ny post før tid, og tiderne hvor ny post kommer",
    showPictureAlt:
      "En kontos menu, åbnet fra dens fane, under Vises i Mail: skjul den i en time, til i morgen eller til du viser den, ordene du skal skrive for at vise den før tid, og tiderne hvor den vises",
  },
};

/** A link that opens in the system browser: the webview ignores target=_blank. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="legal-onboarding-link"
      onClick={(e) => {
        e.preventDefault();
        void openExternalUrl(href);
      }}
    >
      {children}
    </a>
  );
}

/** A button's icon as the app draws it, so it can be found later. */
function ButtonIcon({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="welcome-button-icon" aria-hidden="true">
      <Icon className="h-4 w-4" />
    </span>
  );
}

type Spot = { x: number; y: number };
type Arrow = { d: string; head: string };

/**
 * Find your way around: the picture of the window's left on the left, the
 * three buttons on the right, and an arrow from each button's name to where
 * it is in the picture. around-spots.json, written with the picture by
 * scripts/mail-readme-screenshots.mjs, says where. The arrows are drawn
 * again when the step changes size.
 */
function AroundStep({ t, pictureUrl }: { t: Record<string, string>; pictureUrl: string }) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const pictureRef = React.useRef<HTMLImageElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const nameRefs = React.useRef<(HTMLElement | null)[]>([]);
  const [arrows, setArrows] = React.useState<Arrow[]>([]);
  const items: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    body: React.ReactNode;
    spot: Spot;
    /** How far the curve's middle moves down (up when below 0), in pixels. */
    bend: number;
    /** Comes straight down onto the button, for one with neighbours either side. */
    fromAbove?: boolean;
  }[] = [
    {
      icon: PanelLeft,
      title: t.hideListTitle,
      body: t.hideListBody,
      spot: aroundSpots.hideList,
      // Over the title bar and down onto the button, not across New email.
      bend: 0,
      fromAbove: true,
    },
    // In the order the buttons stand, top to bottom, so no arrow crosses
    // another: the folders before the tabs, the tabs under them.
    { icon: Folder, title: t.foldersTitle, body: t.foldersBody, spot: aroundSpots.folders, bend: -10 },
    // No button of its own: the list's tabs. People, for what they filter by.
    // Arched over the rows rather than through them.
    { icon: Users, title: t.filterTitle, body: t.filterBody, spot: aroundSpots.filter, bend: -40 },
  ];

  const draw = React.useCallback(() => {
    const box = boxRef.current?.getBoundingClientRect();
    const picture = pictureRef.current?.getBoundingClientRect();
    const list = listRef.current?.getBoundingClientRect();
    if (!box || !picture || !list || picture.width === 0) return;
    setArrows(
      items.map((item, i) => {
        const name = nameRefs.current[i]?.getBoundingClientRect();
        if (!name) return { d: "", head: "" };
        // From the left edge of the words, level with the button's name, to
        // just short of the button: no arrow crosses the words.
        const fx = list.left - box.left - 6;
        const fy = name.top + name.height / 2 - box.top;
        const sx = picture.left - box.left + item.spot.x * picture.width;
        const sy = picture.top - box.top + item.spot.y * picture.height;
        const len = Math.hypot(sx - fx, sy - fy) || 1;
        const tx = item.fromAbove ? sx : sx - ((sx - fx) / len) * 16;
        const ty = item.fromAbove ? sy - 14 : sy - ((sy - fy) / len) * 16;
        // From above: the bend's point is over the button, so the curve
        // ends going straight down.
        const mx = item.fromAbove ? tx : (fx + tx) / 2;
        const my = item.fromAbove ? Math.min(fy, ty) - 40 : (fy + ty) / 2 + item.bend;
        const angle = Math.atan2(ty - my, tx - mx);
        const head = (turn: number) =>
          `${tx - 9 * Math.cos(angle + turn)},${ty - 9 * Math.sin(angle + turn)}`;
        return {
          d: `M${fx},${fy} Q${mx},${my} ${tx},${ty}`,
          head: `M${head(0.5)} L${tx},${ty} L${head(-0.5)}`,
        };
      })
    );
    // items is rebuilt each render from the same words and spots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  React.useLayoutEffect(() => {
    draw();
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div className="welcome-two-columns welcome-around" ref={boxRef}>
      <img
        ref={pictureRef}
        className="welcome-step-picture"
        src={pictureUrl}
        alt={t.aroundPictureAlt}
        onLoad={draw}
      />
      <ul className="welcome-feature-list has-icons" ref={listRef}>
        {items.map((item, i) => (
          <li key={item.title}>
            <ButtonIcon icon={item.icon} />
            <div>
              <strong
                ref={(el) => {
                  nameRefs.current[i] = el;
                }}
              >
                {item.title}
              </strong>
              <span>{item.body}</span>
            </div>
          </li>
        ))}
      </ul>
      <svg className="welcome-arrows" aria-hidden="true">
        {arrows.map((arrow, i) => (
          <g key={i}>
            <path d={arrow.d} />
            <path d={arrow.head} />
          </g>
        ))}
      </svg>
    </div>
  );
}

type StackRow = {
  sender: string;
  initials: string;
  tone: "teal" | "amber";
  time: string;
  subject: string;
  count?: string;
  /** A stack's threads, newest first: what a click on it unfolds. */
  threads?: { subject: string; time: string }[];
};

/** The times of the invented mail: the airline's three, newest first, then the library's. */
const STACK_TIMES = ["09:12", "08:40", "07:05"];
const LIBRARY_TIME = "06:30";

/**
 * One side of the stacking choice: its name, the Stacks switch as it
 * stands for this side, and the list it gives.
 *
 * The switch, not a radio dot: it is the control the title bar has, so
 * the reader meets it here first and knows it there.
 */
function StackOption({
  label,
  chosen,
  onChoose,
  rows,
  switchOn,
  switchLabel,
}: {
  label: string;
  chosen: boolean;
  onChoose: () => void;
  rows: StackRow[];
  /** The switch's name in the title bar: "Stacks". */
  switchLabel: string;
  /** Which way the title bar's Stacks switch stands for this side. */
  switchOn: boolean;
}) {
  // A stack here unfolds as it does in the list: try it before choosing.
  const [unfolded, setUnfolded] = React.useState(false);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      className={"welcome-stack-option" + (chosen ? " is-chosen" : "")}
      onClick={onChoose}
    >
      <span className="welcome-stack-option-head">
        <span>{label}</span>
        {/* The switch with its icon and name, as the title bar has it, so
            the reader knows it there. */}
        <span className="welcome-switch-control" aria-hidden="true">
          <GalleryVerticalEnd className="welcome-switch-icon" />
          {switchLabel}
          <span className={"welcome-switch" + (switchOn ? " is-on" : "")}>
            <span className="welcome-switch-knob" />
          </span>
        </span>
      </span>
      {/* Rows as the mail list draws them: initials, the sender, "3 threads"
          when stacked, the time, and the subject under them. */}
      {rows.map((row, i) => (
        // A stack as the list draws it: a row, with "3 threads" and a
        // chevron by the name.
        <React.Fragment key={i}>
          <span
            className={"welcome-stack-row" + (row.threads ? " is-stack" : "")}
            aria-hidden="true"
            // The click goes on to the option too: trying the stack chooses it.
            onClick={row.threads ? () => setUnfolded((v) => !v) : undefined}
          >
            <span className={"welcome-stack-avatar is-" + row.tone}>{row.initials}</span>
            <span className="welcome-stack-body">
              <span className="welcome-stack-line">
                <strong>{row.sender}</strong>
                {row.count ? (
                  <span className="welcome-stack-count">
                    {row.count} {row.threads && unfolded ? "⌄" : "›"}
                  </span>
                ) : null}
                <span className="welcome-stack-time">{row.time}</span>
              </span>
              <span className="welcome-stack-subject">{row.subject}</span>
            </span>
          </span>
          {row.threads && unfolded ? (
            <span className="welcome-stack-threads" aria-hidden="true">
              {row.threads.map((th, j) => (
                <span key={j} className={"welcome-stack-thread" + (j === 0 ? " is-open" : "")}>
                  <span className="welcome-stack-thread-subject">{th.subject}</span>
                  <span className="welcome-stack-time">{th.time}</span>
                </span>
              ))}
            </span>
          ) : null}
        </React.Fragment>
      ))}
    </button>
  );
}

/**
 * Check mails on your own terms: the two features on the left, each a
 * button, and on the right a picture of where the chosen one lives, with a
 * pointer on what to click: the menu next to Sync for pausing, the
 * mailbox's tab for when it is shown.
 */
function QuietStep({ t, dark }: { t: Record<string, string>; dark: boolean }) {
  const [shown, setShown] = React.useState<"pause" | "show">("pause");
  const features = [
    { id: "pause" as const, tile: <FetchTile />, title: t.pauseTitle, body: t.pauseBody },
    { id: "show" as const, tile: <ShownTile />, title: t.hideTitle, body: t.hideBody },
  ];
  return (
    <div className="welcome-two-columns">
      <div>
        <div className="welcome-feature-choices">
          {features.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={shown === f.id}
              className={"welcome-feature-choice" + (shown === f.id ? " is-chosen" : "")}
              onClick={() => setShown(f.id)}
            >
              {f.tile}
              <span>
                <strong>{f.title}</strong>
                <span>{f.body}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="welcome-step-note welcome-feature-note">{t.quietLater}</p>
      </div>
      <img
        className="welcome-step-picture welcome-quiet-picture"
        src={
          shown === "pause"
            ? dark ? pausePictureDarkUrl : pausePictureLightUrl
            : dark ? showPictureDarkUrl : showPictureLightUrl
        }
        alt={shown === "pause" ? t.pausePictureAlt : t.showPictureAlt}
      />
    </div>
  );
}

export function WelcomeScreen({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const [open, setOpen] = React.useState(() => alwaysShow || !eulaAccepted());
  const [agreed, setAgreed] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [viewMode, setViewMode] = useMailViewMode();
  const [lang] = useMailLang();
  const colorMode = useMailColorMode();

  if (!open) return null;
  const t = COPY[lang];

  return (
    // The wrapper only lends .mail-shell's tokens and theme; it draws no box.
    <div className="mail-shell mail-welcome" data-theme={colorMode}>
      <div
        id="eula-onboarding"
        className="onboarding-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eula-welcome-title"
      >
        <div className="eula-title-bar" data-tauri-drag-region="" />
        <div className="eula-onboarding-scroll">
          <div className={"eula-onboarding-inner" + (step < TOUR_STEPS ? " is-wide" : "")}>
            <header className="welcome-onboarding-header">
              <img className="welcome-app-logo" src={logoUrl} alt="" aria-hidden="true" />
              <div className="welcome-onboarding-title-text">
                <h1 id="eula-welcome-title">{t.title}</h1>
                <p className="welcome-onboarding-subtitle">{t.subtitle}</p>
              </div>
            </header>

            <div
              className={
                "onboarding-focus-card legal-onboarding-card welcome-onboarding-card" +
                (step < TOUR_STEPS ? " is-tour" : "")
              }
            >
              {/* The tour's steps lie on top of each other, the one shown on
                  top: the card is as tall as the tallest, so Back, the dots
                  and Next stay in one place from step to step. */}
              {step < TOUR_STEPS ? (
                <div className="welcome-tour-panes">
                  {[
                    <>
                      <h2 className="eula-privacy-title">{t.stacksTitle}</h2>
                      <p className="eula-privacy-lead">{t.stacksLead}</p>
                      {/* The real setting, the title bar's Stacks switch: pick one. */}
                      <div className="welcome-stack-choice" role="radiogroup" aria-label={t.stacksTry}>
                        <StackOption
                          label={t.stacksOff}
                          switchOn={false}
                          switchLabel={t.stacksSwitchLabel}
                          chosen={viewMode === "threads"}
                          onChoose={() => setViewMode("threads")}
                          rows={[
                            ...t.stacksAirlineSubjects.split("|").map((subject, i) => ({
                              sender: t.stacksAirline,
                              initials: "NA",
                              tone: "teal" as const,
                              time: STACK_TIMES[i],
                              subject,
                            })),
                            { sender: t.stacksLibrary, initials: "LI", tone: "amber", time: LIBRARY_TIME, subject: t.stacksLibrarySubject },
                          ]}
                        />
                        <StackOption
                          label={t.stacksOnRecommended}
                          switchOn
                          switchLabel={t.stacksSwitchLabel}
                          chosen={viewMode === "people"}
                          onChoose={() => setViewMode("people")}
                          rows={[
                            {
                              sender: t.stacksAirline,
                              initials: "NA",
                              tone: "teal",
                              count: t.stacksThreadCount.replace("{count}", String(t.stacksAirlineSubjects.split("|").length)),
                              threads: t.stacksAirlineSubjects.split("|").map((subject, i) => ({ subject, time: STACK_TIMES[i] })),
                              time: STACK_TIMES[0],
                              subject: t.stacksAirlineSubjects.split("|")[0],
                            },
                            { sender: t.stacksLibrary, initials: "LI", tone: "amber", time: LIBRARY_TIME, subject: t.stacksLibrarySubject },
                          ]}
                        />
                      </div>
                      <p className="welcome-step-note">{t.stacksLater}</p>
                    </>,
                    <>
                      <h2 className="eula-privacy-title">{t.quietTitle}</h2>
                      <QuietStep t={t} dark={colorMode === "dark"} />
                    </>,
                    <>
                      <h2 className="eula-privacy-title">{t.aroundTitle}</h2>
                      <AroundStep
                        t={t}
                        pictureUrl={colorMode === "dark" ? aroundPictureDarkUrl : aroundPictureLightUrl}
                      />
                    </>,
                  ].map((pane, i) => (
                    <div
                      key={i}
                      className={"welcome-tour-pane" + (i === step ? " is-current" : "")}
                      aria-hidden={i === step ? undefined : true}
                    >
                      {pane}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <h2 className="eula-privacy-title">{t.privacyTitle}</h2>
                  <p className="eula-privacy-lead">{t.privacyLead}</p>
                  <details className="eula-how-we-count">
                    <summary>{t.howWeCount}</summary>
                    <p>
                      {t.howWeCountBody}{" "}
                      <ExternalLink href={PRIVACY_URL}>{t.privacyPolicy}</ExternalLink>
                    </p>
                  </details>
                  <hr className="eula-privacy-divider" />
                  <label className="legal-onboarding-checkbox-row">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                    />
                    <span className="legal-onboarding-checkbox-text">
                      {t.agree} <ExternalLink href={EULA_URL}>{t.eula}</ExternalLink>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="modal-btn primary-btn onboarding-primary-btn"
                    disabled={!agreed}
                    onClick={() => {
                      acceptEula();
                      setOpen(false);
                    }}
                  >
                    {t.continue}
                  </button>
                  {/* Back to the tour's last step. */}
                  <div className="welcome-privacy-back">
                    <button type="button" className="welcome-back-btn" onClick={() => setStep(TOUR_STEPS - 1)}>
                      {t.back}
                    </button>
                  </div>
                </>
              )}
              {step < TOUR_STEPS ? (
                <div className="welcome-step-nav">
                  {step > 0 ? (
                    <button type="button" className="welcome-back-btn" onClick={() => setStep(step - 1)}>
                      {t.back}
                    </button>
                  ) : (
                    <span />
                  )}
                  <span
                    className="welcome-step-dots"
                    role="img"
                    aria-label={t.step.replace("{n}", String(step + 1)).replace("{total}", String(TOUR_STEPS))}
                  >
                    {Array.from({ length: TOUR_STEPS }, (_, i) => (
                      <span key={i} className={i === step ? "is-current" : undefined} />
                    ))}
                  </span>
                  <button type="button" className="welcome-next-btn" onClick={() => setStep(step + 1)}>
                    {t.next}
                  </button>
                </div>
              ) : null}
            </div>

            <footer className="welcome-onboarding-footer">
              <p className="welcome-footer-line">
                <ExternalLink href={t.orgUrl}>{t.org}</ExternalLink> {t.footer}
              </p>
              <p className="welcome-footer-line">
                <ExternalLink href={SOURCE_URL}>{t.source}</ExternalLink>.
              </p>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
