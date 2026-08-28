# Gate 1 — RM-06 Provisioning Runbook

> **TL;DR — create 5 external identities, generate 3 secrets, put all 10 values in `.env`, run one verify command, close [#7](https://github.com/pmgwee/real-ming/issues/7).** This unblocks **36 of the 37** remaining tickets. Budget ~45 minutes. Nothing here can be delegated to an agent — every step creates a real identity or handles secret material.

---

# 🎯 Decision & Why

1. **Why you and not the agent** — creating accounts, entering passwords, and handling credential values are things agents must never do. The repository is already built to *receive* these values without ever seeing them: code reads variable **names**, values live only in `.env` or your secret store.
2. **Why now** — RM-06 has no blockers of its own and gates almost everything else. Until it closes, the graph loop cannot start a single ticket.
3. **Why `.env` is safe** — `.env` and `.env.*` are gitignored, with `!.env.example` as the sole committed exception. A test in `npm run check` scans every tracked file for credential-shaped material and fails the build if any appears.

---

# 🧰 Prerequisites

- [ ] Telegram installed and signed in
- [ ] Access to the Notion workspace holding your task databases
- [ ] A Google account whose Calendar you actually use behind Notion Calendar
- [ ] Node available (`node --version` — the repo needs 24+)

> 💡 **Windows PowerShell:** use `curl.exe`, never bare `curl` (it aliases `Invoke-WebRequest` and breaks `-H` headers).

---

# 🖥️ Phase 1 — Create the identities

## Step A · Telegram bot + your numeric id

1. In Telegram open **@BotFather** → `/newbot` → give it a name and a username ending in `bot`.
2. Copy the token. It looks like `123456789:AAxx...` → this is `REAL_MING_TELEGRAM_BOT_TOKEN`.
3. Keep the bot **private**. Do not add it to any group.
4. Get your **numeric** user id — a username is not enough, the allowlist is numeric. Open **@userinfobot** in Telegram and press START. It replies with your `Id`. → `REAL_MING_TELEGRAM_CEO_ID`

✅ **Expected:** a token containing a `:` and a numeric id of 9–10 digits.

## Step B · Notion connection

> 📛 **Notion renamed this UI.** What older guides call an *integration* is now a **connection**, and *Internal* is now the **Access token** authentication method. Same thing.

1. Go to **notion.so/my-integrations** — it lands on **Developer tools → Connections**, listing any connections you already own.
2. Click **+ New connection**.
3. **Connection name:** `Real-Ming`
4. **Authentication method:** select **Access token** — workspace-scoped, static, one workspace.

   ❌ **Not OAuth.** OAuth is user-scoped for multi-workspace, Marketplace-eligible apps. Real-Ming needs a single workspace-scoped token.

5. **Create connection**, then copy the token → `REAL_MING_NOTION_TOKEN`
6. Confirm the connection's capabilities include **Read content**, **Update content**, and **Insert content**. Master Tasks is read/write, so all three are required.
7. Open the Notion page holding your **Master Tasks** database → `···` menu → **Connections** → **Connect to** → select `Real-Ming`.
8. Copy the database id from the URL. In `notion.so/<workspace>/<32-char-id>?v=...` the 32-character hex string is the id → `REAL_MING_NOTION_MASTER_TASKS_ID`

> ⚠️ **Create a new connection — do not reuse an existing one.** If you already have connections such as `MingCreatives` or `content-creation-workflow`, leave them alone. Each credential must be independently revocable; sharing one token means revoking Real-Ming would also break whatever else uses it.

> ⚠️ If Master Tasks does not exist yet, that is fine — RM-09 creates it. Share **one** existing task database now and update this value after RM-09.

## Step C · Google OAuth client for Calendar

> 📛 **Google renamed this UI too.** The old *APIs & Services → Credentials → OAuth consent screen* is now **Google Auth Platform** with its own left nav:
>
> | Old name | Now |
> | --- | --- |
> | Credentials | **Clients** |
> | OAuth consent screen | **Audience** (plus **Branding**) |
> | Scopes | **Data access** |

1. **console.cloud.google.com** → create or select a project.
2. **APIs & Services → Library** → enable **Google Calendar API**. Do this first; without it the client is created fine but every call returns 403.
3. **Google Auth Platform → Audience** → user type **External** → add your own Google account under **Test users**.
4. **Google Auth Platform → Data access** → add exactly these two Calendar scopes:

   | Check | Scope | Why |
   | --- | --- | --- |
   | ✅ | `.../auth/calendar.events` | Read events for the morning brief and create or update one for RM-12 |
   | ✅ | `.../auth/calendar.calendarlist.readonly` | Know which calendars exist, so it reads the right ones |

   ❌ **Do not grant `.../auth/calendar`.** Its own description is *"See, edit, share and permanently delete all the calendars"*. ADR-0004 requires Approval for destructive actions, and no Approval gate can take back a scope the token already holds. Real-Ming must not be able to delete a calendar at all.

   ❌ **Do not add `.../auth/calendar.readonly`.** It is redundant beside the two above and cannot write, which RM-12 needs.

   Grant `calendar.events` now rather than starting read-only — adding a scope later forces re-consent and a new refresh token.

   **Nothing else from the 17 Calendar scopes is needed.** The filter list runs to two pages; ignore the rest. For the record: `*.freebusy` exposes availability rather than events, `*.public.readonly` is for public calendars, `*.readonly` variants cannot write, and `calendar.settings.readonly` is unnecessary because the 07:30 Asia/Kuala_Lumpur schedule is configured in Real-Ming rather than read from Google.

   🤔 **One judgement call.** `calendar.events.owned` is narrower than `calendar.events` — *calendars that you own* rather than *all of your calendars*. If every calendar you care about is one you created, prefer `.owned`. If any are subscribed or shared with you, such as a university academic calendar, `.owned` cannot see them and the morning brief would silently miss those commitments. Default to `calendar.events` unless you are certain.
5. **Google Auth Platform → Clients → Create client** → Application type **Desktop app** → name it `Real-Ming` rather than leaving `Desktop client 1`, so it is identifiable when you revoke it.
6. Copy → `REAL_MING_GOOGLE_CLIENT_ID` and `REAL_MING_GOOGLE_CLIENT_SECRET`
7. Mint the **refresh token** (`REAL_MING_GOOGLE_REFRESH_TOKEN`) so the system keeps access without re-consenting. Put the client id and secret in `.env` first, then run:

   ```bash
   npm run google:refresh-token
   ```

   It prints a consent URL, waits on a loopback port, exchanges the code, and writes the token straight into `.env`. The value is never printed, logged, or sent anywhere else. Expect the unverified-app warning; choose **Advanced** and continue, then approve both Calendar permissions.

   Confirm with `npm run secrets:preflight`, which reports names only.

### ⏰ Publish the app, or the refresh token dies in 7 days

While the app's publishing status is **Testing**, Google expires refresh tokens after **7 days**. The morning brief would work for a week and then silently stop authenticating.

**First complete Branding.** Google refuses to publish while the OAuth configuration is incomplete, reporting *"Your app's OAuth configuration is incomplete"*. Google marks required fields with an asterisk. There are exactly three; **every other field on the page is optional**:

| Required field | Action |
| --- | --- |
| **App name** | Any identifiable name, shown on the consent screen |
| **User support email** | Select your own account |
| **Developer contact → Email addresses** | Your own address. Reusing the support address is fine, but use one you actually read — Google sends project, OAuth, and security notices there, including a disabled client or a flagged scope. |

If the incomplete-configuration message persists after the first two are filled, it is the Developer contact address that is still empty.

**Production additionally requires two public URLs.** Hovering the disabled **Publish app** button states it outright: *"Valid app name, support email, homepage URL and privacy policy URL are required for switching the app to external production mode."* Those two fields carry no asterisk on the Branding page, because they are optional for Testing and mandatory only for production.

| Also required to publish | Action |
| --- | --- |
| **Application home page** | Public URL serving `consent-site/index.html` |
| **Application privacy policy link** | Public URL serving `consent-site/privacy.html` |
| **Authorised domains** | The domain both URLs live on |

Both pages are in [`consent-site/`](../consent-site/) with deployment instructions in its README. `npx vercel deploy consent-site --prod` publishes them. **Application Terms of Service link stays empty** - it is not required.

⚠️ **The domain must be one Google accepts.** Every domain shown on the consent screen must be pre-registered under Authorised domains, and production generally expects a domain verifiable in Google Search Console. A domain you own is the reliable choice; a `*.vercel.app` subdomain may be rejected because `vercel.app` is a public suffix you cannot verify. See `consent-site/README.md`.

⚠️ **Do not click "+ Add domain" until you have a domain to enter.** An added row is required, and a blank one fails with *"Invalid domain: must not be empty"*, blocking the page from saving. Delete an accidental blank row with the trash icon at the right of the field rather than leaving it.

❌ **Do not upload an App logo.** The page states that uploading one forces verification unless the app is Internal or still in Testing - and you are about to leave Testing. A logo would push a personal app into Google's verification queue for no benefit.

Then:

- **Google Auth Platform → Audience → Publish app** (status becomes *In production*).
- Calendar is a sensitive scope, so an unverified app shows an "unverified app" warning at consent. For your own account that is fine — **Advanced → Go to Real-Ming (unsafe)**. Unverified apps with sensitive scopes are capped at 100 users; you need one.
- Once published, the refresh token persists until you revoke it, change your password, or leave it unused for six months.

Do this **before** minting the refresh token in item 7, otherwise you will mint one that expires and have to redo it.

> 🙋 **The refresh token step is fiddly.** Tell me and I will add a one-time local helper that runs the consent flow in your browser and writes the token straight into `.env` — I never see the value. Say *"add the Google OAuth helper"*.

## Step D · Generate the three local secrets

Run three times, one value each:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Run | Variable |
| --- | --- |
| 1st | `REAL_MING_DASHBOARD_TOKEN` |
| 2nd | `REAL_MING_VAULT_KEY` |
| 3rd | `REAL_MING_WORKER_SHARED_SECRET` |

> ⚠️ **`REAL_MING_VAULT_KEY` cannot be casually rotated.** It derives the Knowledge Vault encryption key; changing it requires re-keying and republishing every root generation. Store it somewhere you will not lose it.

## Step E · Decide where the control plane runs

RM-06 asks you to name the always-on environment and secret-storage location. The specification deliberately leaves the vendor to you.

- **To start the loop today:** your own machine plus `.env` is enough. Tickets RM-07 through RM-14 are implemented and verified locally.
- **By RM-15 at the latest** you need a real always-on host with a secret store that supports rotation, because RM-15 is literally *"Run Daily Operations in the always-on environment."*

Write your choice into [CREDENTIAL-INVENTORY.md](CREDENTIAL-INVENTORY.md) under Environment, or tell me and I will record it.

---

# 🔐 Phase 2 — Store the values

1. Copy the template:

```bash
cp .env.example .env
```

2. Fill in all ten values. `.env.example` holds names only and is the only committed copy.
3. Do **not** paste any value into a GitHub issue, a commit message, or a chat message to me.

---

# ✅ Phase 3 — Verify

| # | Test | Command | Expected |
| --- | --- | --- | --- |
| TC-01 | Preflight before filling | `npm run secrets:preflight` | `0/10 supplied`, ten `missing` lines, exit code 1 |
| TC-02 | Preflight after filling | `npm run secrets:preflight` | `10/10 supplied`, no `missing` lines, exit code 0 |
| TC-03 | No value ever printed | inspect TC-02 output | only variable **names** appear — never a value |
| TC-04 | Nothing leaked into Git | `npm run check` | all tests pass, including the tracked-file credential scan |
| TC-05 | `.env` is untracked | `git status --porcelain` | `.env` does **not** appear |

- [ ] TC-01 · [ ] TC-02 · [ ] TC-03 · [ ] TC-04 · [ ] TC-05

---

# 🏁 Phase 4 — Close the gate

Comment on [#7](https://github.com/pmgwee/real-ming/issues/7) confirming:

- [ ] All five identities exist (bot, Notion integration, Google client, environment, secret store)
- [ ] All ten values are stored outside Git and issue text
- [ ] Each is rotatable and revocable without a code change
- [ ] The inventory is complete and records no values
- [ ] `npm run secrets:preflight` reports 10/10

Then close it. **Paste no values into the comment.**

Then restart the loop with [RESUME-PROMPT.md](RESUME-PROMPT.md).

---

# 🧯 Troubleshooting

| Symptom | Cause → Fix |
| --- | --- |
| `secrets:preflight` says missing but you filled it in | The value is blank or whitespace only. Blank counts as missing by design. |
| `secrets:preflight` still 0/10 | It now loads `.env` automatically. If it still reports zero, the values are blank or `.env` is not at the repository root. |
| `npm run google:refresh-token` says the client id is not set | Fill `REAL_MING_GOOGLE_CLIENT_ID` and `REAL_MING_GOOGLE_CLIENT_SECRET` in `.env` first; the helper reads them from there. |
| The helper reports that Google returned no refresh token | The account has already consented. Revoke Real-Ming at https://myaccount.google.com/permissions and run the helper again. |
| The helper reports a state mismatch | The callback did not come from the URL it printed. Nothing was written. Re-run it and use the fresh URL. |
| `npm run check` fails on the credential scan | A real credential reached a tracked file. Remove it, rotate that credential immediately, and re-run. |
| `.env` shows up in `git status` | Your `.gitignore` was modified. It must contain `.env`, `.env.*`, and `!.env.example`. |
| Notion 32-char id looks wrong | You copied a *page* id, not a *database* id. Open the database as a full page first, then copy from the URL. |
| Cannot find "New integration" in Notion | Notion renamed it. Use **+ New connection** on Developer tools -> Connections, and pick **Access token**, not OAuth. |
| Notion API returns 404 for the database | The database is not shared with the connection. Redo Step B item 7 - sharing the parent page does not always cascade. |
| Notion API returns 403 on a write | The connection lacks Update or Insert content capability. Fix it in the connection settings. |
| BotFather token has no `:` | You copied the username, not the token. Re-run `/mybots` → your bot → **API Token**. |
| Google consent screen blocks you | Add your own Google account under **Test users** on Google Auth Platform -> Audience. |
| Cannot find "Credentials" or "OAuth consent screen" in Google | Renamed. Credentials is now **Clients**, OAuth consent screen is now **Audience**, Scopes is now **Data access**, all under Google Auth Platform. |
| Calendar worked for about a week then stopped authenticating | The app is still in **Testing**, so the refresh token expired after 7 days. Publish the app, then mint a new refresh token. |
| Google returns 403 on every Calendar call | The Calendar API is not enabled on the project, or the scope is missing under Data access. |
| Google returns 403 only on writing an event | You granted `calendar.readonly` instead of `calendar.events`. Fix the scope, then re-consent to mint a new refresh token. |
| Consent shows an "unverified app" warning | Expected for a sensitive scope on an unverified app. Choose **Advanced -> Go to Real-Ming (unsafe)**. |
| "Your app's OAuth configuration is incomplete" when publishing | Branding is unfinished. Beyond the three asterisked fields, production also needs a homepage URL and a privacy policy URL. Hover the disabled **Publish app** button to see what Google is still waiting for. |
| **Publish app** stays greyed out although Branding saved | Saving Branding is not the same as satisfying production mode. The homepage and privacy policy URLs are almost certainly still empty. |
| "Invalid domain: must not be empty" under Authorised domains | You clicked **+ Add domain**, which created a required blank row. Delete the row with its trash icon. Do not fill it; a Desktop app has no domain. |
| Google asks you to submit the app for verification | You uploaded an App logo, or filled a domain field. Remove them; neither is needed for a Desktop app used only by its owner. |
| "Advanced settings are available for apps in production" | Informational. It disappears once the app is published on the Audience page. |

---

# 📎 Appendix

**The ten variables** — full detail with owner, purpose, environment, and revocation procedure is in [CREDENTIAL-INVENTORY.md](CREDENTIAL-INVENTORY.md), generated from `src/config/tracer-secrets.ts` so it cannot drift.

**Security notes 🔐**

- Values live only in `.env` or your secret store. Never in Git, issues, test fixtures, logs, or a prompt to me.
- Every credential is rotatable without touching code — the application reads names, never literals.
- `npm run secrets:preflight` reports presence only. It never reads, prints, or transmits a value; this is asserted by a test.
- `npm run check` fails the build if any tracked file ever contains GitHub, OpenAI, Slack, AWS, Google, Telegram, or PEM private-key shaped material.

**If a credential leaks:** revoke it at the provider first (procedures are in the inventory), then generate a replacement, then update `.env`. No code change is needed.
