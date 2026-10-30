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
Students sign in with a username (a pseudonym chosen by the teacher) and a password, and can watch
and download only their own class videos. No e-mail addresses or real names are stored anywhere.
There is no public sign-up, no password recovery and Cognito never sends a message: the teacher
manages everything with the scripts below.

- Region `eu-central-1`, stack `laguitarrita-students` (template: `backend/template.yaml`)
- Videos: `s3://laguitarrita-students-videos-964907375727/students/{cognito-sub}/videos/{file}`.
  They are permanent (no lifecycle rules, bucket kept even if the stack is deleted).
- `GET /videos` returns the caller's videos with presigned URLs valid for 1 hour; the page asks for
  new ones transparently when they expire.
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

# Upload videos (files and/or folders). With ffmpeg, videos above 480p are re-encoded to 480p
# with +faststart; 480p or smaller are uploaded unchanged. Existing files are skipped unless --overwrite.
node scripts/upload-videos.mjs --username USERNAME "C:/Videos/clase-01.mp4" "C:/Videos/USERNAME/"

# Set a new password (also signs the student out everywhere)
node scripts/reset-password.mjs --username USERNAME --password "NEW_PASSWORD"

# List students (username, sub and number of videos)
node scripts/list-students.mjs

# Delete a student's login; add --delete-videos to also delete their folder
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
token get 401, that student B can never see or download student A's videos and that the user pool
stores nothing but a username and a sub, then deletes them.

To remove the test stack: empty and delete its bucket (it is retained) after
`aws cloudformation delete-stack --stack-name laguitarrita-students-test`.

### Costs
All resources carry the tag `project=laguitarrita-students`; the AWS budget
`laguitarrita-students-5usd` alerts javier@laguitarrita.ch at 80 % (actual) and 100 % (forecast) of
5 USD/month once the tag is activated as a cost allocation tag:
`aws ce update-cost-allocation-tags-status --cost-allocation-tags-status TagKey=project,Status=Active`

## Future features (not in scope now)
- AI chatbot (AWS Bedrock)

## General notes
- No group classes for now
- Teacher travels to student's home in Bern — no fixed studio
- Mobile first
- Keep all copy warm, direct and human — no long conditions or legal text
- The accent color `#c0634a` should be used sparingly — only for key highlights, not decorative
