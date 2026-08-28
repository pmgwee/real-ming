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

From the repository root:

```bash
npx vercel deploy consent-site --prod
```

Vercel serves the directory as a static site. Note the URL it prints — you need it in two places on the consent screen, plus its domain under **Authorised domains**.

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
