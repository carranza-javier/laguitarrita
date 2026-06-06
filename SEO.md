# SEO Brief — laguitarrita.ch (German-only)

Audience: this document is written for Claude Code. Read it fully, then implement in the order
in section 8, in small commits, explaining each step. The site must stay deployable on GitHub
Pages with the laguitarrita.ch custom domain.

**Important framing:** none of the items below fix a "penalty" — the site is not penalised.
These are standard best practices that make the site index more reliably, load faster, and look
good when shared. 

## Scope decision (already made)
- **Target language for SEO is German only.** Do **not** create `/de` and `/en` routes and do
  **not** add `hreflang`. The single URL serving German by default is exactly what we want.
- The in-page English toggle can stay for human visitors — it just isn't an SEO target.
- `<html lang="de">`, `og:locale = de_CH`.

Site context: Angular SPA + Angular Material, GitHub Pages, custom domain laguitarrita.ch
(Cloudflare DNS), hero video from CloudFront. One-pager: Hero, Über mich, Unterricht, Preise,
Kontakt. Business: Javier Carranza, flamenco/Spanish guitar teacher in Bern; teaches at the
student's home in Bern and online; first 30-minute trial lesson free.

The one-pager structure is correct and stays. 

---

## 1. Prerendering (the one worthwhile technical improvement)

Enable Angular **prerendering / static site generation (SSG)** so the page is output as fully
rendered static HTML. Reason: the content (in German) is then present in the HTML at fetch time,
indexing is more reliable, and first paint is faster. Works perfectly on GitHub Pages.

Prerendering captures the default German state; the client-side English toggle keeps working for
visitors. Keep the `CNAME` file (laguitarrita.ch) in the published output and provide a
`404.html` fallback so deep links and refreshes work on GitHub Pages.

This is recommended but not urgent — it is the lowest-regret technical change.

---

## 2. `<head>` tags (German)

Set via Angular's `Title`/`Meta` services or at prerender time.

- **`<html lang="de">`**
- **Title** (≈ 50–60 chars): `Flamenco-Gitarrenlehrer in Bern – Javier Carranza`
- **Meta description** (≈ 150–160 chars):
  `Flamenco-Gitarrenlehrer in Bern. Für alle Niveaus und Altersgruppen. Erste Probestunde gratis.`
- **Canonical**: `https://laguitarrita.ch/` (single URL)
- **Open Graph** — important, because the site is being shared on WhatsApp and the preview is
  currently empty/ugly:
  - `og:title`, `og:description`, `og:type=website`, `og:url=https://laguitarrita.ch/`,
    `og:locale=de_CH`, and `og:image` = The img in assets/javier.jpg is perfect.
- **Twitter Card**: `summary_large_image` with title, description, image.
- **Favicon** + The favicons are in the public folder.
- Exactly one **`<h1>`** containing the main keyword, e.g. `Flamenco-Gitarrenunterricht in Bern`.
  Keep the section titles (Über mich, Unterricht, …) as `<h2>`, with no skipped levels.

  In this moment there is:
  <div _ngcontent-ng-c910126637="" class="hero-content"><h1 _ngcontent-ng-c910126637="" class="hero-name">Javier Carranza</h1><p _ngcontent-ng-c910126637="" class="hero-tagline">Flamenco-Gitarrenlehrer in Bern</p><p _ngcontent-ng-c910126637="" class="hero-sub">Für alle Niveaus und Altersgruppen</p></div>
  But maybe you could improve it for a better SEO. 

---

## 3. Structured data (JSON-LD, German)

Add JSON-LD in the (prerendered) HTML:
- **LocalBusiness** : `name` (La Guitarrita – Javier
  Carranza), `description`, `areaServed` = Bern (use `areaServed`, not a fixed `address`, since
  there is no public studio), `url`, `email` (javier@laguitarrita.ch), `telephone`
  (+41 78 44 95 591), `priceRange` (`CHF 60–80`), `image`, and `sameAs` once social profiles
  exist.
- **Person**: Javier Carranza, flamenco guitarist / guitar teacher, `worksFor` the business.
- **Service**: guitar lessons, `areaServed` Bern, `availableChannel` in-person + online.
- **FAQPage**: mirror the FAQ in section 4 (this can surface in Google's results / AI answers —
  high value, low effort).

---

## 4. FAQ section (German) — recommended content

Add a compact FAQ accordion (closed by default, expand on click) after Preise. These genuinely
help a prospective student decide and they double as FAQPage structured data.

**1. Kommst du zu mir nach Hause?**
Ja. Ich unterrichte bei dir zu Hause in Bern, damit du in deiner gewohnten Umgebung lernen kannst.

**2. Ist der Unterricht auch für absolute Anfänger geeignet?**
Ja, absolut. Du brauchst keine Vorkenntnisse – wir fangen genau dort an, wo du stehst.

**3. Muss ich Noten lesen können?**
Nein. Im Flamenco lernst du vor allem übers Hören, Fühlen und Spielen. Noten sind keine Voraussetzung.

**4. Brauche ich eine eigene Gitarre?**
Zum Üben brauchst du eine eigene Gitarre. Bei der Auswahl berate ich dich gerne.

**5. Ist die erste Probestunde wirklich kostenlos?**
Ja. Die erste halbe Stunde ist kostenlos und unverbindlich, damit wir uns kennenlernen.

**6. In welchen Sprachen findet der Unterricht statt?**
Auf Deutsch, Englisch oder Spanisch – ganz wie es für dich am besten passt.

**7. Kann ich auch online lernen?**
Ja, Online-Unterricht funktioniert sehr gut. Du brauchst nur eine Gitarre und eine stabile Internetverbindung.

**8. Unterrichtest du nur Flamenco?**
Mein Schwerpunkt ist Flamenco- und spanische Gitarre, aber ich unterrichte auch Pop, Singer-Songwriter und andere Stile. Frag einfach nach.

(If the English toggle is on, provide English translations of these too so the toggle stays
consistent — but German is the version that matters for SEO.)

---

## 5. Crawlability

- **robots.txt** at the domain root: allow all crawling and reference the sitemap
  (`Sitemap: https://laguitarrita.ch/sitemap.xml`).
- **sitemap.xml** listing the single URL `https://laguitarrita.ch/` with an accurate `<lastmod>`;
  update `<lastmod>` on each deploy (used as a freshness signal).
- **No hash routing.** Hash fragments (`/#/…`) in the main URL are ignored by search engines.
  The earlier GitHub Pages setup used `HashLocationStrategy`; with prerendering switch the main
  route to a clean path and rely on `404.html` for deep links. In-page anchors for scrolling are
  fine.

---

## 6. Performance / Core Web Vitals

- **alt text** on every image and a meaningful `aria-label` on the Unterricht card icons.

---

## 7. Audit — verify and fix

- [ ] Content present in the raw HTML (achieved via prerendering).
- [ ] `<title>` and meta description set (German).
- [ ] `<html lang="de">`.
- [ ] Canonical tag present (single URL).
- [ ] Open Graph + Twitter tags present (fixes WhatsApp/social preview).
- [ ] robots.txt and sitemap.xml present; sitemap `<lastmod>` accurate.
- [ ] No hash-based main URL.
- [ ] alt text / aria-labels present.
- [ ] Exactly one `<h1>`, no skipped heading levels.
- [ ] CNAME preserved and 404.html present for GitHub Pages.

---

## 8. Implementation order

1. Add `<head>` tags: title, meta description, canonical, Open Graph, Twitter, favicon, `lang`
   (section 2). *Quick win — do this first; it also fixes the WhatsApp preview.*
2. Add JSON-LD: LocalBusiness, Person, Service, FAQPage (section 3).
3. Build the FAQ accordion with the section 4 content.
4. Add robots.txt + sitemap.xml with lastmod (section 5).
5. Enable prerendering (SSG); switch the main route off hash routing; keep CNAME + add 404.html
   (section 1).
6. Performance pass
7. Re-run the section 7 audit and confirm each item.

---

## 9. Off-site — highest local-SEO impact (not code)

For a local service in Bern this moves the needle more than anything on-page, and it is what
makes you appear with a proper profile when someone searches your name:
- Create a **Google Business Profile** as a service-area business (area = Bern, no public address
  shown). Add website, phone (+41 78 44 95 591), email, photos, short description.
- Keep name / phone / website **consistent** everywhere (site, Business Profile, any directory).
- Genuine reviews over time help significantly.

This is handled outside the codebase — set it up separately.

---

## How to hand this to Code
Save as `SEO.md` in the repository root and tell Code:

> Read SEO.md and implement sections 2–7 in the order in section 8, in small commits, explaining
> each step. German is the only SEO target — do not create /de or /en routes and do not add
> hreflang. Keep the site deployable on GitHub Pages with the laguitarrita.ch custom domain
> (preserve CNAME, add 404.html).
