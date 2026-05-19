import { Injectable, computed, signal } from '@angular/core';

export type Lang = 'de' | 'en';

const TRANSLATIONS = {
  de: {
    nav: {
      about: 'Über mich',
      classes: 'Unterricht',
      prices: 'Preise',
      contact: 'Kontakt',
    },
    hero: {
      name: 'Javier Carranza',
      tagline: 'Flamenco-Gitarrenlehrer in Bern',
      sub: 'Für alle Niveaus und Altersgruppen',
    },
    about: {
      heading: 'Über mich',
      body: 'Ich bin Javier Carranza, Flamenco-Gitarrist seit mehr als zehn Jahren. Aufgewachsen in Zaragoza, habe ich die Flamenco-Gitarre als Kind zum ersten Mal gehört und war sofort fasziniert. Mein erster Lehrer war Rubén Jiménez, im lebhaften Viertel La Magdalena. Später zog ich nach Andalusien, erst nach Granada, dann nach Sevilla, wo ich bei Meistern wie Pedro Sierra, Naranjito Hijo und Miguel Salado gelernt habe.\nJetzt bin ich hier in Bern und möchte dich auf diesem Weg begleiten. Gemeinsam werden wir die Gitarre von Grund auf kennenlernen und jeden Ton spüren. Für mich ist die Gitarre mehr als ein Instrument. Sie ist eine Begleiterin in guten Zeiten und eine Zuflucht in schwierigen. Wenn ich sie in den Händen halte, existiert der Rest der Welt für mich nicht mehr.',
    },
    classes: {
      heading: 'Unterricht',
      items: [
        { icon: 'music_note', title: 'Flamenco-Gitarre', desc: 'Je nach deinen Zielen und Interessen.' },
        { icon: 'people', title: 'Alle Niveaus und Altersgruppen', desc: 'Anfänger sind herzlich willkommen. Kinder, Jugendliche, Erwachsene.' },
        { icon: 'fitness_center', title: 'Praxisorientiert', desc: 'Viele Übungen und konkreter Fortschritt.' },
        { icon: 'home', title: 'Präsenz oder Online', desc: 'Ich komme zu dir nach Bern. Oder online – wie es dir am besten passt.' },
        { icon: 'language', title: 'Auf Deutsch, Englisch oder Spanisch', desc: 'Du wählst die Sprache, in der du dich am wohlsten fühlst.' },
        { icon: 'star', title: 'Erste Probestunde gratis', desc: '30 Minuten, kostenlos, ohne jede Verpflichtung.' },
      ],
    },
    prices: {
      heading: 'Preise',
      col1: 'Angebot',
      col2: 'Preis',
      rows: [
        { label: 'Einzelstunde', price: 'CHF 80 / Std.' },
        { label: 'Monat Präsenz – 4 Stunden', price: 'CHF 280 (CHF 70/Std.)' },
        { label: 'Monat Online – 4 Stunden', price: 'CHF 240 (CHF 60/Std.)' },
      ],
      notes: [
        'Monatliche Schüler:innen erhalten nach jeder Stunde eine private Aufnahme zum Nachüben zu Hause.',
        'Zahlung im Voraus per TWINT oder Banküberweisung.',
        'Absage: 24 Stunden Voranmeldung erforderlich – sonst wird die Stunde verrechnet.',
      ],
    },
    contact: {
      heading: 'Kontakt',
      intro: 'Schreib mir einfach eine Nachricht – ich freue mich auf dich.',
      emailLabel: 'E-Mail',
      phoneLabel: 'Telefon / WhatsApp',
      phone: '+41 78 44 95 591',
    },
  },
  en: {
    nav: {
      about: 'About',
      classes: 'Classes',
      prices: 'Prices',
      contact: 'Contact',
    },
    hero: {
      name: 'Javier Carranza',
      tagline: 'Flamenco Guitar Teacher in Bern',
      sub: 'For all levels and ages',
    },
    about: {
      heading: 'About me',
      body: "I'm Javier Carranza, a flamenco guitarist for over ten years. Growing up in Zaragoza, I heard flamenco guitar for the first time as a child and was immediately hooked. My first teacher was Rubén Jiménez, in the vibrant neighbourhood of La Magdalena. Later I moved to Andalusia, first to Granada, then to Seville, where I learned from teachers like Pedro Sierra, Naranjito Hijo and Miguel Salado.\nNow I'm here in Bern and I'd love to accompany you on this journey. Together we'll explore the guitar from the ground up and feel every note. For me the guitar is more than an instrument. It's a companion in good times and a refuge in difficult ones. When I have it in my hands, the rest of the world simply disappears.",
    },
    classes: {
      heading: 'Classes',
      items: [
        { icon: 'music_note', title: 'Flamenco Guitar', desc: 'Tailored to your goals and interests.' },
        { icon: 'people', title: 'All levels and ages', desc: 'Beginners very welcome. Children, teens, adults.' },
        { icon: 'fitness_center', title: 'Practical approach', desc: 'Lots of exercises and real progress.' },
        { icon: 'home', title: 'In-person or online', desc: 'I come to you in Bern. Or online — whatever works best for you.' },
        { icon: 'language', title: 'In German, English or Spanish', desc: 'Choose whichever language you feel most comfortable in.' },
        { icon: 'star', title: 'First trial class free', desc: '30 minutes, no cost, no commitment.' },
      ],
    },
    prices: {
      heading: 'Prices',
      col1: 'Option',
      col2: 'Price',
      rows: [
        { label: 'Single class', price: 'CHF 80 / h' },
        { label: 'Monthly in-person — 4 classes', price: 'CHF 280 (CHF 70/class)' },
        { label: 'Monthly online — 4 classes', price: 'CHF 240 (CHF 60/class)' },
      ],
      notes: [
        'Monthly students receive a private recording of each class to review at home.',
        'Payment in advance via TWINT or bank transfer.',
        'Cancellation: 24h notice required — otherwise the class is charged.',
      ],
    },
    contact: {
      heading: 'Contact',
      intro: 'Just reach out — I look forward to hearing from you.',
      emailLabel: 'Email',
      phoneLabel: 'Phone / WhatsApp',
      phone: '+41 78 44 95 591',
    },
  },
} as const;

@Injectable({ providedIn: 'root' })
export class TranslationService {
  readonly lang = signal<Lang>('de');
  readonly t = computed(() => TRANSLATIONS[this.lang()]);

  toggle(): void {
    this.lang.update(l => (l === 'de' ? 'en' : 'de'));
  }
}
