// Tekster for storskjerm-mappa (bokmål). Lokal i mappa så den kan kopieres
// til andre Sunday-apper uten å dra med seg appens locale-fil.
export const tekst = {
  knapp: "Vis på storskjerm",
  tittel: "Vis på storskjerm",
  visHvordan: "Vis hvordan",
  lukk: "Lukk",
  anbefalt: "Anbefalt for din enhet",
  fullskjerm: {
    hjelp: "For HDMI eller speiling",
    knapp: "Fullskjerm her",
  },
  eget: {
    hjelp: "Kontrollene blir her",
    knapp: "Åpne storskjermen i eget vindu",
    flyttet: "Storskjermen ble flyttet til den andre skjermen. Trykk F for fullskjerm.",
    flyttHint: "Dra vinduet til prosjektoren og trykk F for fullskjerm.",
    blokkert: "Nettleseren blokkerte det nye vinduet. Tillat popup-vinduer for denne siden og prøv igjen.",
  },
  chromecast: {
    tittel: "Chromecast / Google TV",
    steg1: "Åpne storskjermen i eget vindu (knappen over).",
    steg2: "I Chrome-menyen ⋮ velger du «Cast …» (Lagre og del → Cast), og velger «Cast fane».",
    steg3: "Velg TV-en i listen. Trykk F i storskjerm-vinduet for fullskjerm.",
    ikkeChromium: "Dette krever Chrome eller Edge på PC eller Chromebook. Åpne siden i en av dem for å caste.",
  },
  apple: {
    tittel: "Apple TV (AirPlay)",
    mac1: "Mac: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.",
    mac2: "Velg «Bruk som separat skjerm».",
    mac3: "Åpne storskjermen i eget vindu (knappen over) og dra den over til Apple TV-en. Trykk F for fullskjerm.",
    ios1: "iPad/iPhone: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.",
    ios2: "Trykk deretter «Fullskjerm her» (knappen over).",
  },
  tavle: {
    avslutt: "Avslutt storskjerm",
    tilkobling: "Mistet kontakten – prøver på nytt …",
  },
} as const;
