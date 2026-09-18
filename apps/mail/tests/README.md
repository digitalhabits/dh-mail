# Mail suites

```bash
pnpm --dir apps/mail test            # all of them
pnpm --dir apps/mail test connect    # one, by name
```

Each suite bundles the real source with `esbuild`, using the alias list in
`../build-aliases.mjs` — the same list `vite.config.ts` builds the app from.
That sharing is the point: a test that resolves a module differently from the
build is checking a program that does not ship.

There is no framework. What is faked is the edge of the process and nothing
inside it:

| Faked | Real |
|-------|------|
| `window.__TAURI__.core.invoke` | the store client, the connect flow, the transport |
| `fetch` to Google and Microsoft | every request body and URL they are sent |
| `sonner` | — |

So a check like "the exchange proves the verifier and sends no secret" reads
the form body the app would really have posted.

The suites named `mounted-` are different. They render the real page in
happy-dom, so React is inside their bundle. They check what is on the page
after a click. They do not check pixels or scroll.

## Adding one

Name the file `<thing>.test.mjs`, import `check` and `suite` from
`./harness.mjs`, and end with nothing — `suite` reports and sets the exit code.

Write the check name as the claim it makes, with the reason it matters:
`"the rotated refresh token is written back, or the mailbox dies later"` says
more in a CI log than `"replaceToken called"`.

## What these cannot cover

Anything that needs a real window: the popout's transparency and always-on-top
behaviour, the drag regions, and whether a message actually arrives at Gmail.
Those are checked by a person, and saying so here is better than a suite that
pretends otherwise.
