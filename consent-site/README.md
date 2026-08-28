# Consent site

Two static pages that exist only to satisfy Google's requirement for switching the OAuth app to **External production** mode:

> *"Valid app name, support email, homepage URL and privacy policy URL are required for switching the app to external production mode."*

Without them the **Publish app** button stays disabled, the app stays in Testing, and Google expires the refresh token every 7 days.

| File | Becomes |
| --- | --- |
| `index.html` | Application home page |
| `privacy.html` | Application privacy policy link |

Both are self-contained: no build step, no dependencies, no external requests. They are not part of the Real-Ming application and are excluded from the build.

## Deploy

> ⚠️ **Deploy this folder, not the repository.** `real-me` is private and holds the specification, ADRs, architecture diagrams, the CEO Office, and the credential inventory. None of that belongs on a public URL, and Google needs only the two pages here. Do not link the Vercel project to the GitHub repository either — deploying the folder directly avoids it.

```bash
cd consent-site
npx vercel login
npx vercel deploy --prod
```

Running from inside this directory uploads only these files. Vercel serves them as a static site with no build step.

Note the URL it prints. You need it in three places: **Application home page**, **Application privacy policy link** (append `/privacy.html`), and the domain under **Authorised domains**.

Any static host works. GitHub Pages needs a public repository; this one is private.

## ⚠️ The domain has to be one Google will accept

Google requires every domain shown on the consent screen to be pre-registered under **Authorised domains**, and for production it generally expects a domain you can verify in Google Search Console.

- **A domain you own** (for example the one already used for DuitSini, or a personal domain) is the reliable choice. Verify it in Search Console first, then add it under Authorised domains.
- **A `*.vercel.app` subdomain may be rejected**, because `vercel.app` is a public suffix you cannot verify as your own. Try it if you like — if Google refuses the Authorised domain, point both URLs at a domain you own instead.

## Before publishing

- [ ] Deployed, and both URLs load publicly in a private browser window
- [ ] Domain verified in Google Search Console
- [ ] Domain added under **Google Auth Platform → Branding → Authorised domains**
- [ ] Homepage URL and privacy policy URL filled in on the Branding page
- [ ] Still **no App logo** — uploading one forces verification once out of Testing

## Keeping it honest

`privacy.html` describes what Real-Ming actually does: a single operator, Calendar and Notion and Telegram access, no third-party sharing, no advertising, no model training, encrypted derived knowledge, revocation via Google Account permissions. It also carries the Limited Use disclosure Google requires for sensitive scopes.

If Real-Ming's data handling changes, update this page. A privacy policy that stops matching the system is worse than none.

The contact address is currently `ngxiaohao123@gmail.com`, matching the consent screen's support email. Change both together if you want a different one.
