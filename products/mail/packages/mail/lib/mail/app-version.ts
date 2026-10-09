/**
 * The version of the app this is, when it is an app.
 *
 * Shown in settings so a bug report can say which build it came from. The
 * standalone build compiles it in from its `package.json`; a web host has
 * no version worth showing, so it reads empty and the line is
 * left off rather than showing a blank one.
 */

export const MAIL_APP_VERSION: string =
  process.env.NEXT_PUBLIC_MAIL_APP_VERSION?.trim() || "";
