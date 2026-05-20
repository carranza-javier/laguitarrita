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
      soundOn: 'Ton an',
      soundOff: 'Ton aus',
    },
    about: {
      heading: 'Über mich',
      body: 'Ich heisse Javier Carranza und spiele seit über zehn Jahren Flamenco-Gitarre. Aufgewachsen bin ich in Zaragoza, wo ich schon als Kind zum ersten Mal Flamenco hörte und sofort davon begeistert war. Meinen ersten Unterricht bekam ich bei Rubén Jiménez im Viertel La Magdalena.\n\nSpäter zog es mich nach Andalusien, zuerst nach Granada und danach nach Sevilla. Dort hatte ich die Möglichkeit, bei renommierten Gitarristen wie Pedro Sierra, Naranjito Hijo und Miguel Salado zu lernen und meinen eigenen Stil weiterzuentwickeln.\n\nHeute lebe ich in Bern und möchte meine Erfahrung und meine Leidenschaft für die Gitarre weitergeben. Im Unterricht arbeiten wir Schritt für Schritt an Technik, Rhythmus und vor allem am musikalischen Gefühl.\n\nDie Gitarre begleitet mich seit vielen Jahren. In guten Zeiten bringt sie Freude, und in schwierigen Momenten hilft sie mir, Ruhe und Ausgleich zu finden.',
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
      soundOn: 'Sound on',
      soundOff: 'Sound off',
    },
    about: {
      heading: 'About me',
      body: "My name is Javier Carranza, and I have been playing flamenco guitar for more than ten years. I grew up in Zaragoza, where I first heard flamenco as a child and was immediately fascinated by it. My first guitar teacher was Rubén Jiménez, in the La Magdalena neighbourhood.\n\nLater, I moved to Andalusia, first to Granada and then to Seville. There, I had the opportunity to study with renowned guitarists such as Pedro Sierra, Naranjito Hijo, and Miguel Salado, while gradually developing my own style.\n\nToday I live in Bern, where I share my experience and passion for the guitar. In my lessons, we work step by step on technique, rhythm, and above all, musical expression and sensitivity.\n\nThe guitar has been with me for many years. In the best moments, it has brought me joy, and in the difficult ones, it has helped me find balance and calm.",
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
