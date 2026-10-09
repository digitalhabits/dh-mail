/**
 * The one-time welcome screen. Three short steps first show what other mail
 * apps do not have: stacked threads (Off and On side by side, to pick
 * one), new mail only when you choose (with the README's picture of the
 * pause menu, in the theme's light or dark), and the buttons that hide the
 * list and show folders and filters.
 * After them, on its own screen, "Private by design": To-Do's WelcomeScreen, with the
 * same markup and class names, so the two stay alike.
 * Shown until accepted (and on every launch of a dev build, via alwaysShow),
 * in the main window of both the public and the team build. Accepting is saved by
 * eula.ts, which also lets the usage count start; raising EULA_REVISION
 * there shows it to everyone again.
 */
import * as React from "react";
import { Folder, Funnel, PanelLeftClose } from "lucide-react";

import { useMailViewMode } from "@/components/mail/mail-list-state";
import { useMailLang, type MailLang } from "@/lib/mail/i18n";
import { useMailColorMode } from "@/lib/mail/theme";
import { openExternalUrl } from "@/lib/native-shell";

import pausePictureDarkUrl from "../docs/screenshots/pause.png";
import pausePictureLightUrl from "../docs/screenshots/pause-light.png";
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
      "When one sender has several threads in your inbox, Mail stacks them into one row. Three emails from your airline are one row, not three.",
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
    stacksLater: "You can change this later in Settings > Reading.",
    aroundTitle: "Find your way around",
    hideListTitle: "Hide the mail list",
    hideListBody:
      "Then you see only the email you read. Bring the pointer to the left edge, and the list comes back.",
    foldersTitle: "Folders",
    foldersBody: "Click to show the folders of all your mailboxes.",
    filterTitle: "Filter",
    filterBody: "Click to see only mail from specific people, e.g. from your personal contacts.",
    quietTitle: "Check mails on your own terms",
    pauseTitle: "Pause new mail",
    pauseBody:
      "Stop new emails for an hour, until tomorrow, or on a schedule. Use the menu next to Sync.",
    hideTitle: "Hide a mailbox on a schedule",
    hideBody: "For example, hide your work mailbox in the evening.",
    aroundPictureAlt:
      "The left of the Mail window: the folders, then the mail list with its buttons for folders and filter, and the button that hides the list",
    pausePictureAlt:
      "The pause menu next to Sync: pause for an hour, until tomorrow, until a time, or on a schedule, and friction to restart early",
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
      "Når én afsender har flere tråde i din indbakke, samler Mail dem i én række. Tre e-mails fra dit flyselskab er én række, ikke tre.",
    stacksTry: "Saml tråde fra samme afsender",
    stacksOnRecommended: "Til (anbefalet)",
    stacksOff: "Fra",
    stacksAirline: "Nordvind Air",
    stacksAirlineSubjects: "Dit boardingkort|Tjek ind til din flyrejse|Din booking er bekræftet",
    stacksThreadCount: "{count} tråde",
    stacksLibrary: "Biblioteket",
    stacksLibrarySubject: "Dine bøger skal afleveres",
    stacksLater: "Du kan ændre det senere under Indstillinger > Læsning.",
    aroundTitle: "Sådan finder du rundt",
    hideListTitle: "Skjul postlisten",
    hideListBody:
      "Så ser du kun den e-mail, du læser. Før markøren til venstre kant, så kommer listen frem igen.",
    foldersTitle: "Mapper",
    foldersBody: "Klik for at vise mapperne fra alle dine postkasser.",
    filterTitle: "Filter",
    filterBody: "Klik for kun at se post fra bestemte personer, f.eks. fra dine personlige kontakter.",
    quietTitle: "Tjek din post på dine egne præmisser",
    pauseTitle: "Sæt ny post på pause",
    pauseBody:
      "Stop nye e-mails i en time, til i morgen eller efter en tidsplan. Brug menuen ved siden af Synkroniser.",
    hideTitle: "Skjul en postkasse efter en tidsplan",
    hideBody: "Skjul for eksempel din arbejdspostkasse om aftenen.",
    aroundPictureAlt:
      "Venstre side af Mail-vinduet: mapperne, så postlisten med dens knapper til mapper og filter, og knappen der skjuler listen",
    pausePictureAlt:
      "Pausemenuen ved siden af Synkroniser: pause i en time, til i morgen, til et tidspunkt eller efter en tidsplan, og modstand mod at starte igen før tid",
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
  }[] = [
    {
      icon: PanelLeftClose,
      title: t.hideListTitle,
      body: t.hideListBody,
      spot: aroundSpots.hideList,
      bend: -12,
    },
    // Folders and Filter sit side by side: their arrows dip and come up from
    // below, so the one to Folders does not run over Filter.
    { icon: Funnel, title: t.filterTitle, body: t.filterBody, spot: aroundSpots.filter, bend: 30 },
    { icon: Folder, title: t.foldersTitle, body: t.foldersBody, spot: aroundSpots.folders, bend: 60 },
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
        const tx = sx - ((sx - fx) / len) * 16;
        const ty = sy - ((sy - fy) / len) * 16;
        const mx = (fx + tx) / 2;
        const my = (fy + ty) / 2 + item.bend;
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

type StackRow = { sender: string; initials: string; tone: "teal" | "amber"; time: string; subject: string; count?: string };

/** The times of the invented mail: the airline's three, newest first, then the library's. */
const STACK_TIMES = ["09:12", "08:40", "07:05"];
const LIBRARY_TIME = "06:30";

/** One side of the stacking choice: its name, a radio dot, and the list it gives. */
function StackOption({
  label,
  chosen,
  onChoose,
  rows,
}: {
  label: string;
  chosen: boolean;
  onChoose: () => void;
  rows: StackRow[];
}) {
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
        <span className="welcome-radio" aria-hidden="true" />
      </span>
      {/* Rows as the mail list draws them: initials, the sender, "3 threads"
          when stacked, the time, and the subject under them. */}
      {rows.map((row, i) => (
        <span key={i} className="welcome-stack-row" aria-hidden="true">
          <span className={"welcome-stack-avatar is-" + row.tone}>{row.initials}</span>
          <span className="welcome-stack-body">
            <span className="welcome-stack-line">
              <strong>{row.sender}</strong>
              {row.count ? <span className="welcome-stack-count">{row.count}</span> : null}
              <span className="welcome-stack-time">{row.time}</span>
            </span>
            <span className="welcome-stack-subject">{row.subject}</span>
          </span>
        </span>
      ))}
    </button>
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
              {step === 0 ? (
                <>
                  <h2 className="eula-privacy-title">{t.stacksTitle}</h2>
                  <p className="eula-privacy-lead">{t.stacksLead}</p>
                  {/* The real setting, Settings > Reading: pick one. */}
                  <div className="welcome-stack-choice" role="radiogroup" aria-label={t.stacksTry}>
                    <StackOption
                      label={t.stacksOff}
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
                      chosen={viewMode === "people"}
                      onChoose={() => setViewMode("people")}
                      rows={[
                        {
                          sender: t.stacksAirline,
                          initials: "NA",
                          tone: "teal",
                          count: t.stacksThreadCount.replace("{count}", String(t.stacksAirlineSubjects.split("|").length)),
                          time: STACK_TIMES[0],
                          subject: t.stacksAirlineSubjects.split("|")[0],
                        },
                        { sender: t.stacksLibrary, initials: "LI", tone: "amber", time: LIBRARY_TIME, subject: t.stacksLibrarySubject },
                      ]}
                    />
                  </div>
                  <p className="welcome-step-note">{t.stacksLater}</p>
                </>
              ) : step === 1 ? (
                <>
                  <h2 className="eula-privacy-title">{t.quietTitle}</h2>
                  <div className="welcome-two-columns">
                    <ul className="welcome-feature-list">
                      <li>
                        <strong>{t.pauseTitle}</strong>
                        <span>{t.pauseBody}</span>
                      </li>
                      <li>
                        <strong>{t.hideTitle}</strong>
                        <span>{t.hideBody}</span>
                      </li>
                    </ul>
                    {/* The README's picture: the pause menu, with friction to restart early.
                        Cropped to just before Sync on the left, and a little on the
                        right and at the foot (welcome-screen.css). */}
                    <div className="welcome-picture-crop">
                      <img
                        className="welcome-step-picture"
                        src={colorMode === "dark" ? pausePictureDarkUrl : pausePictureLightUrl}
                        alt={t.pausePictureAlt}
                      />
                    </div>
                  </div>
                </>
              ) : step === 2 ? (
                <>
                  <h2 className="eula-privacy-title">{t.aroundTitle}</h2>
                  <AroundStep
                    t={t}
                    pictureUrl={colorMode === "dark" ? aroundPictureDarkUrl : aroundPictureLightUrl}
                  />
                </>
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
