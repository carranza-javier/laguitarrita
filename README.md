# laguitarrita.ch

Personal website for Javier Carranza, Flamenco guitar teacher in Bern, Switzerland.

## Stack
- **Frontend**: Angular (static build, deployed on GitHub Pages)
- **UI Library**: Angular Material
- **Backend** (student area): AWS SAM in `backend/` — API Gateway HTTP API + Lambda
- **Storage**: private S3 bucket for student videos
- **Auth**: Cognito user pool (JWT), admin-created users only

## Deployment
- Frontend: GitHub Pages (`.github/workflows/deploy.yml`, builds the Angular app only)
- Backend: deployed manually with AWS SAM (see *Student area* below)

> Note: Use `HashLocationStrategy` for Angular routing to work correctly on GitHub Pages.

## Languages
The website is fully bilingual: **German and English**.
Language selector visible in the navigation bar.
No auto-detection — the user chooses manually.

## Design system
- **Background**: `#f0efed` (off-white)
- **Text**: near-black
- **Accent**: `#c0634a` (terracotta)
- **Headings font**: Playfair Display (Google Fonts, serif)
- **Body font**: Inter (Google Fonts, sans-serif)
- **Style**: minimalist, clean, lots of whitespace, no shadows, no gradients, single accent color used sparingly

## Structure
Single page app (one-pager), sections in order:

### 1. Hero
- Video occupies almost the entire screen on entry
- Overlay on top of the video: name **"Javier Carranza"** and tagline **"Flamenco-Gitarre in Bern"**
- Below the tagline, a short line: **"Für alle Niveaus und Altersgruppen"** / **"For all levels and ages"**
- Autoplay, with sound, discrete mute/unmute button in one corner
- Video: Javier playing guitar (to be recorded, horizontal format, white background)

### 2. About
- Short personal presentation
- Warm, human and direct tone — no formal or legal language

### 3. Classes
What is offered:
- Spanish guitar and Flamenco guitar
- All levels and ages, beginners very welcome
- Practical approach, lots of exercises
- Presencial at student's home in Bern, or online
- Classes in German, English or Spanish
- First trial class free (30 minutes, no commitment)

### 4. Prices
Clean, simple and easy to understand at a glance:

| | Price |
|---|---|
| Single class | CHF 60 |
| Monthly presencial — 4 classes | CHF 220 (CHF 55/class) |
| Monthly online — 4 classes | CHF 200 (CHF 50/class) |

Launch pricing: the regular prices (CHF 80 / 280 / 240) are shown struck through.
They live in `LAUNCH_OLD_PRICES` in `prices.component.ts` — set it to `null` to end the launch period.

- Monthly students receive a private recording of each class to review at home
- Payment in advance (TWINT or bank transfer)
- Cancellation: 24h notice required, otherwise class is charged

### 5. Contact
- No contact form
- Show email: javier@laguitarrita.ch
- Show phone/WhatsApp number (to be provided)
- Keep it simple — just reach out directly

## Student area (`/schueler`)
Students sign in with a username (a pseudonym chosen by the teacher) and a password. They see their
own class materials (videos, audio files and PDFs) as a list grouped by month (newest first) with a
search by title. Videos and audio files play in a player with slower speeds (0.5×–1×), PDFs open in
the browser's viewer; everything can be downloaded and students write their own notes per file.
No e-mail addresses or real names are stored anywhere.
There is no public sign-up, no password recovery and Cognito never sends a message: the teacher
manages everything with the scripts below.

- Region `eu-central-1`, stack `laguitarrita-students` (template: `backend/template.yaml`)
- Files: `s3://laguitarrita-students-videos-964907375727/students/{cognito-sub}/videos/{file}` (the
  folder is called `videos` for all types). Only videos (mp4, m4v, mov, webm, mkv, avi), audio files
  (mp3, m4a, aac, wav, ogg, flac) and PDFs are shown. They are permanent (no lifecycle rules, bucket
  kept even if the stack is deleted).
- Titles are the file names without the extension, so name files the way they should appear
  (e.g. `Bulerías - compás básico.mp4`). Videos and audio files are dated by the recording date stored
  in the file (kept as S3 metadata `recorded` by the upload script), PDFs by the upload date.
- `GET /videos` returns the caller's files with their type, note and presigned URLs valid for 1 hour; the
  page asks for new ones transparently when they expire. `PUT /notes {video, text}` saves a note
  (max. 5000 characters; empty deletes it) in the DynamoDB table `laguitarrita-students-notes`.
- Public frontend config (pool id, client id, API URL): `src/app/student/student-config.ts`.

### Admin scripts
Requirements: Node.js 22+, AWS CLI credentials for the account, and optionally ffmpeg
(`winget install Gyan.FFmpeg`). Run once: `cd backend && npm install`.

All scripts accept `--stack <name>` (default `laguitarrita-students`). If `--password` is omitted the
script asks for it without showing it (and it does not end up in the shell history). Usernames are
3-32 characters (letters, digits, `.`, `-`, `_`) and case-insensitive; passwords need 8+ characters.

```bash
cd backend

# Create a student (permanent password, no message is sent). Prints the student's sub.
node scripts/create-student.mjs --username USERNAME --password "PASSWORD"

# Upload videos, audio files and PDFs (files and/or folders). With ffmpeg, videos above 480p are
# re-encoded to 480p with +faststart; everything else is uploaded unchanged. The recording date is
# kept. Existing files are skipped unless --overwrite.
node scripts/upload-videos.mjs --username USERNAME "C:/Videos/clase-01.mp4" "C:/Videos/USERNAME/"

# Set the order the student sees (first argument on top). The app sorts by date (newest first), so this
# just rewrites each named file's recording date; the files are not re-uploaded. Run it after uploading.
# Files are dated today by default; --date YYYY-MM-DD puts them on another day/month. Pass names exactly
# as uploaded (with extension); files you do not name are left untouched.
node scripts/order-videos.mjs --username USERNAME "Técnica - Arpegio.mp4" "Soleá - Falseta (Parte 2).mp4" ...

# Set a new password (also signs the student out everywhere)
node scripts/reset-password.mjs --username USERNAME --password "NEW_PASSWORD"

# List students (username, sub and number of videos)
node scripts/list-students.mjs

# Delete a student's login and notes; add --delete-videos to also delete their folder
node scripts/delete-student.mjs --username USERNAME [--delete-videos]
```

Deleting a single video: `aws s3 rm "s3://laguitarrita-students-videos-964907375727/students/<sub>/videos/<file>"`.

### Deploying the backend
Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).

```bash
cd backend
sam build && sam deploy                      # production stack (samconfig.toml)
sam build && sam deploy --config-env test    # throwaway test stack laguitarrita-students-test
```

### Tests
`npm run test:integration` (in `backend/`, needs ffmpeg) creates two temporary students on the stack
named by `STUDENTS_STACK` (default `laguitarrita-students-test`), checks that requests without a valid
token get 401, that student B can never see, download or annotate student A's videos, that notes and
recording dates work and that the user pool stores nothing but a username and a sub, then deletes them.

To remove the test stack: empty and delete its bucket (it is retained) after
`aws cloudformation delete-stack --stack-name laguitarrita-students-test`.

### Costs
All resources carry the tag `project=laguitarrita-students`; the AWS budget
`laguitarrita-students-5usd` alerts javier@laguitarrita.ch at 80 % (actual) and 100 % (forecast) of
5 USD/month once the tag is activated as a cost allocation tag:
`aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=project,Status=Active`

## Concert tickets (`/konzert`)
Public, indexable page to sell tickets for an informal concert. Visitors enter a name and a number of
tickets (1–4) and get a "Dein Ticket" screen with the exact TWINT payment steps: they pay by sending
money to the teacher's mobile number (the one in the contact section) with a reference such as
`Konzert Anna 2`. The site records each ticket and enforces the venue capacity; it never processes a
payment. German by default, English via the existing selector.

- Region `eu-central-1`, stack `laguitarrita-konzert` (template: `backend/konzert/template.yaml`),
  completely separate from the student-area stack: its own DynamoDB table and public HTTP API, no
  Cognito, no S3. The student area is untouched.
- Concert facts live as template parameters (`Capacity` = 34, `PriceChf` = 15,
  `ConcertIso` = `2027-02-21T17:00:00+01:00`). The frontend reads the price and the remaining seats
  from the API; the human-readable date/time/place are texts in `translation.service.ts`.
- Each ticket row has: `id`, `name`, number of `tickets`, `status` (active/cancelled), `paid`
  (**informational only — it never affects the capacity or frees a seat**) and `createdAt`. Every
  active ticket counts towards the capacity the moment it is created, paid or not. A reserved counter
  row holds the seats taken; a purchase updates the counter and inserts the ticket in a single
  conditional `TransactWriteItems`, so simultaneous buyers can never exceed the capacity. A TTL field
  deletes all rows 30 days after the concert.
- `GET /availability` (public) returns the remaining tickets, capacity and price. `POST /tickets`
  (public) validates and cleans the input (name length-capped and stripped of anything that could
  break the reference), enforces the capacity atomically, and is protected by API rate limiting and a
  honeypot field. CORS is limited to `https://laguitarrita.ch` and `http://localhost:4200`.
- Public frontend config (API URL and concert facts): `src/app/konzert/konzert-config.ts`. The TWINT
  number is **not** duplicated there — it is read from the contact section (the single place it lives).

### Ticket admin scripts
Same requirements as the student scripts (Node 22+, AWS credentials). All accept `--stack <name>`
(default `laguitarrita-konzert`). Run from `backend/`.

```bash
cd backend

# Door list: expected reference ("Konzert Anna 2"), name, tickets, expected amount (tickets × CHF 15),
# paid (yes/no) and date — unpaid first — plus totals (sold, paid, unpaid, available, total expected).
node scripts/list-tickets.mjs
node scripts/list-tickets.mjs --out door-list.csv   # export the list as CSV for printing (or --csv to stdout)

# Mark one or more tickets as paid (informational; does NOT change the capacity). A selector can be a
# ticket id, a buyer name or the full reference text. Use --unpaid to undo. If a name matches several
# tickets you are asked which one.
node scripts/mark-paid.mjs "Konzert Anna 2"
node scripts/mark-paid.mjs "Anna" "beat" --unpaid

# Cancel one or more tickets and free their seats (so they stop counting towards the capacity).
node scripts/cancel-ticket.mjs <id | name | "Konzert Anna 2"> ...
```

The scripts above stay as a backup. Day-to-day the concert is managed from the admin page below.

### Admin page (`/konzert-admin`)
A private, deliberately simple, mobile-first page to view and manage the ticket list from a phone
without running scripts. The interface is in **German by default and English via the DE/EN selector**,
using the same translation system as the rest of the site. It lives at
`https://laguitarrita.ch/konzert-admin` and is **not linked anywhere, carries `noindex, nofollow`, is
not in `sitemap.xml`/`robots.txt`, and is kept out of the prerender** (see `prerender-routes.txt`);
reloading it is served by GitHub Pages' `404.html` fallback.

- It shows one counter (sold/capacity), a manual-entry button and form, a print button, a
  "show cancelled" switch, and the list of active tickets (unpaid first). Each ticket shows the name,
  ticket count, reference, expected amount and age, with just two actions: toggle paid, and cancel
  (with a confirmation). The list loads on open and again whenever the tab becomes visible — no refresh
  button and no timer.
- Auth is a **separate, brand-new Cognito user pool** (`AdminUserPool` in the same concert template),
  fully independent of the student-area pool: username sign-in only, no e-mail/phone, no self-sign-up,
  no messages, 12-character minimum password, case-insensitive username, deletion protection on in
  prod. A single admin user. Sign-in is SRP (the password never leaves the browser); the page uses the
  **access token** against a JWT authorizer on the `/admin` routes. The public routes are unchanged and
  stay open.
- Admin API (all require a valid admin access token, otherwise 401; rate-limited): `GET /admin/tickets`
  (the list plus the sold/capacity counter), `PATCH /admin/tickets/{id}` (toggles `paid` only), `POST
  /admin/tickets/{id}/cancel` (atomic, idempotent; the admin may cancel paid tickets too) and `POST
  /admin/tickets` (manual entry respecting the capacity with the same atomic conditional write).
  Cancelling marks the ticket cancelled (it is not deleted) and frees its seats once; the TTL still
  removes every row 30 days after the concert.
- Admin frontend config (public pool ids, API URL): `src/app/konzert-admin/konzert-admin-config.ts`.
  Nothing secret: the client has no secret and every `/admin` call needs a token.

Create or reset the single admin user (run from `backend/`, needs AWS credentials):

```bash
cd backend
node scripts/create-concert-admin.mjs --username <name>          # asks for the password (min 12) without echo
node scripts/reset-concert-admin-password.mjs --username <name>  # set a new password, signs out everywhere
```

### Deploying the concert backend
```bash
cd backend
npm run deploy:konzert           # production stack laguitarrita-konzert
npm run deploy:konzert:test      # throwaway test stack laguitarrita-konzert-test (Capacity 10)
```

### Tests
`npm run test:konzert` (in `backend/`, deploy the test stack first) runs integration tests against
`laguitarrita-konzert-test`: it fires many simultaneous purchases and checks that the capacity is never
exceeded, that invalid tickets (bad count, empty name, honeypot, non-JSON) are rejected without
consuming a seat, and that the buyer name is cleaned so it cannot break the TWINT reference.

### Deleting the data after the concert
Every ticket row is deleted automatically 30 days after the concert (DynamoDB TTL), so normally you do
nothing. To remove everything earlier, delete the stack — the table and all tickets go with it (unlike
the student-area bucket, nothing here is retained). The admin user pool has **deletion protection** in
prod, so disable it first, then delete the stack (this also removes the admin pool and its user):

```bash
aws cognito-idp update-user-pool --user-pool-id <AdminUserPoolId> --deletion-protection INACTIVE --region eu-central-1
aws cloudformation delete-stack --stack-name laguitarrita-konzert
```

## Future features (not in scope now)
- AI chatbot (AWS Bedrock)

## General notes
- No group classes for now
- Teacher travels to student's home in Bern — no fixed studio
- Mobile first
- Keep all copy warm, direct and human — no long conditions or legal text
- The accent color `#c0634a` should be used sparingly — only for key highlights, not decorative
