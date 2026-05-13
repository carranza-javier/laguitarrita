# laguitarrita.ch

Personal website for Javier Carranza, Flamenco guitar teacher in Bern, Switzerland.

## Stack
- **Frontend**: Angular (static build, deployed on GitHub Pages)
- **UI Library**: Angular Material
- **Backend**: AWS Lambda + API Gateway (to be implemented later)
- **Storage**: AWS S3 (for private student videos, later)
- **Auth**: JWT (later, for private student area)

## Deployment
- Frontend: GitHub Pages
- Backend: AWS (not in scope for now)

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
| Single class | CHF 80 |
| Monthly presencial — 4 classes | CHF 280 (CHF 70/class) |
| Monthly online — 4 classes | CHF 240 (CHF 60/class) |

- Monthly students receive a private recording of each class to review at home
- Payment in advance (TWINT or bank transfer)
- Cancellation: 24h notice required, otherwise class is charged

### 5. Contact
- No contact form
- Show email: javier@laguitarrita.ch
- Show phone/WhatsApp number (to be provided)
- Keep it simple — just reach out directly

## Future features (not in scope now)
- Private student area (login with JWT, hosted on AWS)
- Private video library per student (AWS S3)
- AI chatbot (AWS Bedrock)

## General notes
- No group classes for now
- Teacher travels to student's home in Bern — no fixed studio
- Mobile first
- Keep all copy warm, direct and human — no long conditions or legal text
- The accent color `#c0634a` should be used sparingly — only for key highlights, not decorative
