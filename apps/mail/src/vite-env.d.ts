/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google refuses a desktop client without this, whatever PKCE does. It is
   * not confidential, and it ships inside the app. See `oauth-config.ts`.
   */
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
  /** "1" draws the phone layout in a browser. See `host-form.ts`. */
  readonly VITE_MAIL_MOBILE?: string;
  /** "mac" or "windows", set only by the Build workflow and scripts/build-win-store.ps1 (never a .env file). See `usage-ping.ts`. */
  readonly VITE_MAIL_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
