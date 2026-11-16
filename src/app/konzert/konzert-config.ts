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
    name: 'Sulgenrain 24',
    street: 'Sulgenrain 24',
    postalCode: '3007',
    city: 'Bern',
    country: 'CH',
  },
} as const;

export const MAX_TICKETS = 4;
