// Public config of the concert-ticket backend (backend/konzert/template.yaml output ApiUrl).
// Nothing here is a secret: /availability and /tickets are public endpoints.
// The TWINT mobile number is NOT stored here — it is read from the contact section
// (TranslationService contact.phone), the single place the number lives.
export const KONZERT_CONFIG = {
  apiUrl: 'https://egyep7sdrb.execute-api.eu-central-1.amazonaws.com',
  // GitHub Pages serves the prerendered page at /konzert/ (it 301-redirects /konzert there), so the
  // canonical and the Event offer URL use the trailing slash: the final, non-redirecting URL.
  url: 'https://laguitarrita.ch/konzert/',

  // Concert facts. The human-readable versions are the texts in translation.service.ts; these
  // machine-readable values feed the price fallback (until /availability answers) and the Event
  // structured data for search engines.
  startIso: '2027-02-21T17:00:00+01:00',
  doorsIso: '2027-02-21T16:00:00+01:00',
  priceChf: 15,
  capacity: 34,
  location: {
    name: 'Sulgenrain 14',
    street: 'Sulgenrain 14',
    postalCode: '3007',
    city: 'Bern',
    country: 'CH',
  },

  // Concert poster, served from src/assets/konzert (not hashed). The WebP is shown on the page
  // (JPG fallback for older browsers); the JPG also serves as the absolute og:image for link
  // previews. Intrinsic size 1200x1607 is set on the <img> so the layout reserves the space.
  flyer: {
    webp: '/assets/konzert-flyer.webp',
    jpg: '/assets/konzert-flyer.jpg',
    width: 1200,
    height: 1607,
    ogImage: 'https://laguitarrita.ch/assets/konzert-flyer.jpg',
  },

  // Two contacts shown at the foot of the page. The visible text keeps the Swiss 0xx spacing;
  // the tel: link uses the international +41 form. Javi's number is the same one used for TWINT.
  contacts: {
    venue: { tel: '+41786651092', phone: '078 665 10 92', name: 'Angi' },
    info: { tel: '+41784495591', phone: '078 449 55 91', name: 'Javi' },
  },
} as const;

export const MAX_TICKETS = 4;
