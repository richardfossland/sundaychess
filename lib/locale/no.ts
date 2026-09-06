// All user-facing strings, Bokmål. Keep this the single source so an English
// pass is a one-file copy later.

export const no = {
  appName: "SundayChess",
  tagline: "Sjakkturnering for hele gruppa",

  common: {
    next: "Neste",
    back: "Tilbake",
    create: "Opprett",
    cancel: "Avbryt",
    close: "Lukk",
    confirm: "Bekreft",
    loading: "Laster …",
    copy: "Kopier",
    copied: "Kopiert!",
    error: "Noe gikk galt",
    retry: "Prøv igjen",
    notFoundTitle: "Fant ikke siden",
    notFoundBody: "Lenken kan være utløpt eller feil. Sjekk PIN-en, eller gå tilbake.",
    home: "Til forsiden",
    // Fixed-corner toggles (SoundToggle/FullscreenToggle) — same two labels on
    // every screen that renders them, so they live here rather than per-page.
    muteSound: "Slå av lyd",
    unmuteSound: "Slå på lyd",
    enterFullscreen: "Fullskjerm",
    exitFullscreen: "Avslutt fullskjerm",
  },

  landing: {
    teacher: "Jeg arrangerer",
    teacherSub: "Lag en turnering og vis tavla",
    student: "Jeg spiller",
    studentSub: "Bli med med en PIN",
    versus: "Spill mot hverandre",
    // "Slik funker det" 3-step strip + reassurance line on the landing page.
    howTitle: "Slik funker det",
    step1: "Lag turnering",
    step2: "Elevene skanner QR eller taster PIN",
    step3: "Følg tavla",
    reassurance:
      "Gratis · ingen elevkontoer · funker på Chromebook og mobil · ~20 min",
  },

  versus: {
    title: "Spill mot hverandre",
    subtitle: "To spillere – uten en hel turnering",
    sameScreen: "Samme skjerm",
    sameScreenSub: "Del én enhet, bytt på å trekke",
    online: "Hver sin enhet",
    onlineSub: "Del en kode, spill fra hver sin telefon",
    create: "Lag et parti",
    join: "Bli med med kode",
    yourName: "Navnet ditt",
    namePlaceholder: "F.eks. Ada",
    opponentCode: "Kode fra motspilleren",
    shareCode: "Del denne koden med motspilleren",
    waiting: "Venter på at motspilleren blir med …",
    whiteTurn: "Hvit sin tur",
    blackTurn: "Svart sin tur",
    whiteWon: "Hvit vant!",
    blackWon: "Svart vant!",
    draw: "Remis",
    flip: "Snu brettet",
    newGame: "Nytt parti",
    newGameConfirm: "Starte nytt parti? Det pågående partiet blir borte.",
    rematch: "⚔︎ Omkamp",
    start: "Start",
    back: "Tilbake",
    create2: "Lag parti",
    joinGame: "Bli med",
    invalidCode: "Fant ingen kamp med den koden",
    full: "Kampen er allerede full",
    connecting: "Kobler til …",
    done: "Partiet er ferdig",
  },

  host: {
    createTitle: "Ny turnering",
    quickStart: "Rask start",
    customize: "Tilpass turnering …",
    // Auto-title for "Rask start" — becomes "Turnering DD.MM" (see
    // app/arranger/page.tsx). Kept as a plain prefix so the date formatting
    // (which isn't language content) stays out of the locale file.
    quickStartTitlePrefix: "Turnering",
    enterTitle: "Åpne turnering",
    enterPrompt: "Skriv vertskoden for å åpne tavla igjen",
    hostCodeLabel: "Vertskode",
    missingHostCode:
      "Vertskoden mangler på denne enheten. Gå til forsiden og åpne turneringen på nytt med vertskoden din.",
    open: "Åpne",
    pinLabel: "Bli-med-PIN",
    joinUrlLabel: "Eller gå til",
    players: "Spillere",
    noPlayers: "Ingen har blitt med ennå …",
    startLeague: "Start liga",
    startCup: "Start cup",
    standings: "Stilling",
    rank: "#",
    name: "Navn",
    score: "Poeng",
    tiebreak: "Buchholz",
    tiebreakHelp:
      "Summen av motstandernes poeng — skiller spillere med like mange poeng.",
    round: "Runde",
    games: "Partier",
    nextRound: "Neste runde",
    replay: "Omspill",
    bracketRecap: "Slik gikk det",
    roundOver: "Runden er ferdig!",
    backToArranging: "Tilbake til arrangering",
    // LiveGamesView caps the projector grid at 8 boards by default (more than
    // that per screen becomes unreadable) — this expands/collapses the rest.
    showAllGames: (n: number) => `Vis alle (${n})`,
    showFewerGames: "Vis færre",
    playRematch: "Spill omkamp",
    advanceBySeed: "Send høyest rangert videre",
    drawChoiceHint:
      "Uavgjort i runden — spill omkamp, eller send den høyest rangerte videre.",
    rematchStarted: "Omkamp startet — spilles nå.",
    forceResolve: "Tving fullføring",
    forceResolveConfirm:
      "Sette alle uavgjorte partier til remis (½–½)? Dette kan ikke angres.",
    inProgress: "Pågår",
    finished: "Ferdig",
    bye: "Frirunde",
    overrideTitle: "Overstyr resultat",
    setResult: "Sett resultat",
    whiteWin: "Hvit vinner",
    blackWin: "Svart vinner",
    draw: "Remis",
    // Button label only (OverrideModal) — the imperative "cancel the game".
    // The PAST-TENSE status shown in the games grid uses `aborted` below;
    // reusing this one there read as an instruction, not a state.
    abort: "Annuller partiet",
    // Status label for an aborted game (LeagueView.resultLabel).
    aborted: "Avbrutt",
    overrideResultConfirm: (name: string) => `Sette resultatet til at ${name} vinner?`,
    overrideDrawConfirm: "Sette resultatet til remis?",
    overrideAbortConfirm:
      "Annullere partiet? Ingen av spillerne får poeng for det, og dette kan ikke angres.",
    overrideAbsentConfirm: (name: string, scope: "round" | "tournament") =>
      scope === "tournament"
        ? `Sette ${name} som borte for resten av turneringen? Motstanderen vinner dette partiet.`
        : `Sette ${name} som borte denne runden? Motstanderen vinner dette partiet.`,
    absentTitle: "Spiller borte → motstander vinner",
    absentRound: "Denne runden",
    absentTournament: "Ute av turneringen",
    absentSuffix: "er borte",
    showCodes: "Spillerkoder",
    codesTitle: "Spillerkoder",
    codesHint: "Les koden til en spiller som har mistet sin.",
    // CodesModal: masked-by-default roster (UX-3).
    codesWarning: "Koder gir tilgang til elevens økt — ikke vis på storskjerm",
    tapToReveal: "Trykk for å vise",
    tapToHide: "Trykk for å skjule",
    // LobbyView: the host code is never shown by default (UX-2).
    revealHostCode: "Vis vertskode",
    hostCodeWarning: "Ikke vis på storskjerm",
    join: "Bli med",
    liveToggle: "Live",
    boardToggle: "Tavle",
    // SpectateGame's own back button — distinct from `liveToggle` above (that
    // one SWITCHES a mode; this one LEAVES the single-game view for the grid),
    // even though they used to share the same copy.
    backToGames: "Alle partier",
    spectateWon: "vant!",
    spectateDraw: "Remis",
    kick: "Kast ut",
    kickConfirm: (name: string) => `Kaste ut ${name}?`,
    online: "Tilkoblet",
    offline: "Frakoblet",
    podium: "Vinnere",
    champion: "Mester",
    newTournament: "Ny turnering",
    bracket: "Sluttspill",
    timer: "Rundetid",
    timeUp: "Tiden er ute",
    // Screen-reader-only announcement (RoundTimer) — the visible countdown
    // itself is aria-live="off" (it ticks every second; announcing every
    // tick would be unusable), so this fires once, at the 60s mark.
    timerOneMinuteLeft: "Ett minutt igjen",
    addMinute: "+1 min",
    timeUpSuggestion: "Tiden er ute – vil du avslutte runden?",
    endRound: "Avslutt runden",
    crownChampion: "Kår mester 🏆",
    // Shared between league and bracket "can't advance yet" hints — kept as
    // one key so the two boards never drift apart. LeagueView still has its
    // own literal copy of this sentence pending a sibling copy-pass PR.
    awaitAllGames: "Alle partier må være ferdige før neste runde.",

    // Finished-screen print / save-as-PDF (window.print()).
    printResults: "Skriv ut / lagre som PDF",

    // Fair-play readout — a game whose `result_source` isn't plain "play".
    // Short marker shown next to the result badge in the results grid, plus
    // its hover title. Keyed by ResultSource (see lib/types.ts); `resultSourceLabel`
    // in lib/dto.ts looks these up so the mapping can't drift from the enum.
    resultSourceLabel: {
      walkover: "W.O.",
      opponent_absent: "Fraværende",
      teacher_override: "Overstyrt",
      timeout_draw: "Tid ute",
      bye: "Frirunde",
    } as Record<string, string>,
    resultSourceTitle: {
      walkover: "Walkover — registrert av arrangøren uten at partiet ble spilt",
      opponent_absent: "Motstanderen var borte — automatisk seier",
      teacher_override: "Resultatet er satt manuelt av arrangøren",
      timeout_draw: "Tiden løp ut i partiet — satt til remis",
      bye: "Frirunde denne runden",
    } as Record<string, string>,
    // Compact legend on the finished screen: how many games were decided
    // without play (walkover / fraværende / overstyrt) — a fair-play readout,
    // not a comment on ordinary byes or time-forced draws.
    resultSourceLegend: (n: number) =>
      `${n} ${n === 1 ? "parti" : "partier"} avgjort uten spill (walkover/fravær/overstyring).`,
  },

  // Lærerens avlesning av klient-telemetrien (T5). Se docs/TELEMETRY.md.
  diag: {
    open: "Diagnostikk",
    title: "Diagnostikk",
    hint: "Hva som faktisk skjedde med elevene i denne turneringen. Ingen navn, ingen IP-adresser – bare hendelsestyper og koder. Slettes automatisk etter 14 dager.",
    empty: "Ingen hendelser registrert. Det er et godt tegn.",
    unavailable:
      "Telemetri-tabellen er ikke opprettet ennå – kjør migrasjon 0012 i Supabase-dashbordet.",
    countsTitle: "Hendelser etter type",
    eventsTitle: "Siste hendelser",
    time: "Tid",
    who: "Spiller",
    what: "Hva",
    detail: "Detaljer",
    unknownPlayer: "Ukjent",
    // Hendelsestypene, i klartekst. Nøklene MÅ matche `kind` i migrasjon 0012.
    kinds: {
      kick: "Kastet ut av økten",
      watchdog: "Brettet låste seg (vakthund)",
      channel_error: "Sanntidskanalen falt ut",
      api_timeout: "Tidsavbrudd mot serveren",
      api_network: "Nettverksfeil",
      api_5xx: "Serverfeil",
      move_rollback: "Trekk rullet tilbake",
      game_vanished: "Partiet forsvant",
      tab_passive: "Fanen ble passiv (spiller i en annen fane)",
      js_error: "Feil i nettleseren",
    } as Record<string, string>,
  },

  // Sunday Account host login + "mine turneringer"-oversikt (arrangør only).
  // Players/joiners are untouched — they still use codes.
  hostAuth: {
    // Discreet entry point from the landing page to the optional Sunday
    // Account host dashboard — anonymous arrangører never need it.
    landingLink: "Arrangør med Sunday-konto →",
    loginTitle: "Logg inn som arrangør",
    loginLede: "Logg inn med Sunday-kontoen din for å samle turneringene dine.",
    emailLabel: "E-post",
    emailPlaceholder: "deg@skolen.no",
    sendLink: "Send innloggingslenke",
    sending: "Sender …",
    linkSent: "Sjekk innboksen — vi har sendt deg en innloggingslenke.",
    sunday: "Logg inn med Sunday-konto",
    google: "Logg inn med Google",
    linkError: "Klarte ikke å sende lenken — sjekk adressen og prøv igjen.",
    authError: "Innloggingen mislyktes. Prøv igjen.",
    or: "eller",
    // Dashboard
    dashTitle: "Mine turneringer",
    dashLede: "Turneringene du har laget mens du var innlogget.",
    signedInAs: "Innlogget som",
    signOut: "Logg ut",
    createNew: "Ny turnering",
    empty: "Du har ingen lagrede turneringer ennå. Lag en ny for å komme i gang.",
    untitled: "Uten tittel",
    created: "Opprettet",
    manage: "Åpne",
    delete: "Slett",
    deleting: "Sletter …",
    deleteConfirm:
      "Slette denne turneringen for godt? Alle spillere, partier og resultater forsvinner. Dette kan ikke angres.",
    deleteError: "Klarte ikke å slette turneringen. Prøv igjen.",
    loadError: "Klarte ikke å hente turneringene dine.",
    statusLobby: "Lobby",
    statusLeague: "Liga pågår",
    statusPlayoff: "Sluttspill",
    statusFinished: "Ferdig",
  },

  wizard: {
    step: "Steg",
    of: "av",
    titleStep: "Tittel",
    titleHint: "Valgfritt — f.eks. «7A vårturnering»",
    titlePlaceholder: "Turneringstittel",
    formatStep: "Turneringsform",
    formatLeague: "Liga",
    formatLeagueSub: "Alle spiller flere runder (sveitsisk) — ev. sluttspill til slutt",
    formatCup: "Cup",
    formatCupSub: "Rett på utslagsrunder — vinn eller ryk 🏆",
    reviewFormat: "Form",
    roundsStep: "Antall ligarunder",
    roundsHint: "Sveitsisk system — anbefalt 5",
    roundsRuleOfThumb: "Tommelfingerregel: færre runder enn spillere",
    roundsFewer: "Færre runder",
    roundsMore: "Flere runder",
    // Player-count-aware warning for lib/tournament/roundsAdvice.ts — not
    // wired into any screen yet (the wizard runs before anyone has joined,
    // so it has no roster to check against; see that file's doc comment).
    roundsWarningRematch: (rounds: number, players: number) =>
      `Med ${rounds} runder og ${players} spillere vil noen møtes to ganger.`,
    playoffStep: "Sluttspill?",
    playoffOn: "Med sluttspill",
    playoffOff: "Bare liga",
    playoffSizeStep: "Antall i sluttspill",
    playoffSizeHint: "Topp N går videre til utslagsrunder",
    timerStep: "Rundetimer",
    timerHint: "Nedtellingen vises på tavla og på elevenes skjermer.",
    timerOff: "Av",
    min: "min",
    reactionsStep: "Emoji-reaksjoner?",
    reactionsHint:
      "Spillerne kan sende emojis til hverandre under partiet. Skru av hvis det blir for mye fnising.",
    reactionsOn: "På",
    reactionsOff: "Av",
    clockStep: "Sjakklokke (lyn)?",
    clockHint:
      "Betenkningstid per spiller. Går tiden ut, kan motstanderen kreve seier.",
    clockOff: "Uten klokke",
    reviewClock: "Sjakklokke",
    teamsStep: "Lagturnering?",
    teamsHint:
      "Spillerne fordeles automatisk jevnt på lagene når de blir med. Lagets poeng = summen av spillernes poeng.",
    teamsOff: "Individuelt",
    reviewTeams: "Lag",
    variantStep: "Variant",
    variantHint: "Alle varianter følger vanlige sjakkregler.",
    variants: {
      standard: "Vanlig sjakk",
      standardSub: "Klassisk oppstilling",
      no_queens: "Dronningløst",
      no_queensSub: "Begge dronningene er fjernet — roligere partier",
      pawn_war: "Bondekrig",
      pawn_warSub: "Bare konge og bønder — kappløp om å promotere!",
    },
    reviewStep: "Se over",
    edit: "Endre",
    reviewRounds: "Ligarunder",
    reviewPlayoff: "Sluttspill",
    reviewTimer: "Rundetimer",
    reviewReactions: "Reaksjoner",
    reviewVariant: "Variant",
    none: "Ingen",
  },

  hype: {
    blunder: "💥 Bommert!",
    brilliant: "🌟 Strålende trekk!",
    swing: "😮 Vending!",
    mate: "♔ Sjakkmatt!",
  },

  replay: {
    title: "Reprise",
    cta: "Se gjennom partiet",
    play: "▶ Spill av",
    pause: "⏸ Pause",
    move: "Trekk",
    empty: "Ingen trekk å vise for dette partiet.",
  },

  review: {
    cta: "📋 Få trener-tilbakemelding",
    title: "Trenerens gjennomgang",
    loading: "Analyserer partiet …",
    error: "Kunne ikke lage gjennomgangen akkurat nå.",
    aiBadge: "✨ Skrevet av trener-AI",
    templateBadge: "Motoranalyse",
    accuracy: "Nøyaktighet",
    good: "Gode trekk",
    inaccuracies: "Unøyaktigheter",
    mistakes: "Feil",
    blunders: "Tabber",
    worstMove: "Trekk å se nærmere på",
    close: "Lukk",
  },

  promo: {
    title: "Velg brikke",
    // Esc used to default to dronning; it now cancels the trekket (see
    // PromotionPicker), so the hint must say that instead.
    hint: "Trykk en brikke · Esc = avbryt",
    q: "Dronning",
    r: "Tårn",
    b: "Løper",
    n: "Springer",
  },

  awards: {
    title: "Utmerkelser",
    fastest_mate: "Lyn-matt",
    most_captures: "Brikkesluker",
    longest_game: "Maratonpartiet",
    comeback: "Snuoperasjonen",
    movesUnit: "trekk",
    capturesUnit: "brikker slått",
    comebackDetail: "Vant fra håpløs stilling",
  },

  puzzle: {
    title: "Sjakknøtt mens du venter",
    prompt: "Sett sjakkmatt i ett trekk",
    toMoveWhite: "Hvit sin tur",
    toMoveBlack: "Svart sin tur",
    solved: "Riktig! 🎉",
    wrong: "Ikke matt – prøv igjen!",
    next: "Neste nøtt",
    counter: "løst",
  },

  teams: {
    standings: "Lagstilling",
    members: "spillere",
    yourTeam: "Du er på lag",
    winner: "Vinnerlag",
  },

  predict: {
    title: "Tipp resultatene",
    hint: "Hvem vinner de andre partiene? 1 poeng per riktig svar.",
    white: "Hvit",
    draw: "Uavgjort",
    black: "Svart",
    leaderboard: "Tippeliga",
    points: "poeng",
    myPoints: "Dine tippepoeng",
  },

  player: {
    joinTitle: "Bli med",
    pinPlaceholder: "6-sifret PIN",
    join: "Bli med",
    nameTitle: "Hva heter du?",
    namePlaceholder: "Visningsnavn",
    nameHint: "Bruk gjerne bare fornavn",
    resumeTitle: "Koden din",
    resumeHint: "Skriv den ned! Du trenger den hvis fanen lukkes.",
    resumeAck: "Jeg har skrevet ned koden",
    haveCode: "Har du en kode?",
    resumePlaceholder: "f.eks. KOLE-7F",
    resume: "Gjenoppta",
    waitingStart: "Venter på at arrangøren starter …",
    waitingNext: "Venter på neste motstander …",
    waitingBye:
      "Du har frirunde denne runden og får 1 poeng gratis 🎉 Slapp av til neste runde.",
    outOfTournament: "Du er ute av turneringen 🏁 — godt spilt!",
    tournamentFinished: "Turneringen er ferdig 🏆",
    showMyCode: "Vis koden min",
    // Shared classroom device: hand the iPad to the next student without
    // wiping any OTHER tournament this device has a session for (R6).
    switchPlayer: "Ikke deg? Bytt spiller",
    cupProgress: "Cup-stigen",
    yourTurn: "DIN TUR",
    opponentTurn: "Venter på motstander",
    // Background "your turn" cue for a hidden/backgrounded tab — see
    // lib/client/turnCue.ts. Distinct from `yourTurn` above (the in-page
    // banner): this is a browser tab title / notification title, so it's
    // punchier and carries an exclamation mark.
    turnTitle: "Din tur!",
    notifyOptIn: "🔔 Varsle meg når det er min tur",
    notifyBody: "Motstanderen din har trukket – bli med igjen for å spille.",
    boardLabel: "Sjakkbrett",
    otherTabTitle: "Du spiller i en annen fane",
    otherTabBody: "Spillet er åpent i en annen fane på denne enheten. For å unngå trøbbel spiller bare én fane om gangen.",
    otherTabResume: "Spill her",
    youAre: "Du spiller",
    white: "hvit",
    black: "svart",
    vs: "mot",
    offerDraw: "Tilby remis",
    resign: "Gi opp",
    resignConfirm: "Gi opp partiet?",
    drawOffered: "Remis tilbudt",
    drawSent: "Remis-forespørsel sendt til motstander – venter på svar",
    drawDeclined: "Motstander avslo remis",
    drawOfferedByOpponent: "Motstander tilbyr remis",
    accept: "Godta",
    decline: "Avslå",
    // Ghost button in the notice slot while an incoming draw offer's dialog
    // was dismissed (Esc/backdrop) without an answer — the offer is still
    // pending, so this reopens the same dialog.
    answerDrawOffer: "Svar på remistilbudet",
    // aria-describedby text on that dialog: Esc/backdrop only closes it
    // (the offer stays pending) — declining is a separate, explicit button.
    drawOfferDismissHint: "Esc eller klikk utenfor lukker uten å svare — tilbudet står fortsatt til du trykker Avslå eller Godta.",
    checkmate: "Sjakkmatt",
    youWon: "Du vant! 🎉",
    youLost: "Du tapte",
    gameDraw: "Remis",
    invalidPin: "Fant ingen turnering med den PIN-en",
    invalidCode: "Ugyldig kode",
    illegalMove: "Ulovlig trekk",
    notYourTurn: "Det er ikke din tur",
    connection: "Tilkobling ustabil – synkroniserer …",
    // The small persistent "reconnecting" badge (R7) — distinct copy from
    // `connection` above, which is a one-shot toast on a failed move.
    reconnecting: "Kobler til igjen …",
    refreshNow: "Oppdater",
    logOut: "Logg ut",
    // Resume trouble that is NOT "wrong code" — the session is kept, so every
    // one of these ends by saying the student can just try again.
    resumeTimeout: "Serveren svarte ikke i tide. Økten din er trygg – prøv igjen.",
    resumeOffline: "Ingen forbindelse. Sjekk nettet, og prøv igjen – økten din er trygg.",
    resumeBusy: "Mange kobler til samtidig. Vent noen sekunder og prøv igjen.",
    resumeServer: "Serveren svarer ikke akkurat nå. Økten din er trygg – prøv igjen.",
    tournamentGone: "Turneringen finnes ikke lenger",
    tournamentGoneBody:
      "Arrangøren har avsluttet eller slettet den. Logg ut, så kan du bli med i en ny.",
    // Kept to ONE line at 390px width (the turn banner reserves exactly one
    // line's height — see .turn-slot in globals.css) — the full explanation
    // moves to a `title` attribute (premoveSetTitle) instead of wrapping here.
    premoveSet: "Forhåndstrekk klart – trykk tomt felt for å avbryte",
    premoveSetTitle:
      "Forhåndstrekket spilles automatisk når det blir din tur. Trykk et tomt felt på brettet for å avbryte det.",
    premoveCancelled: "Forhåndstrekket ble forkastet",
    gameLoadFailed: "Fant ikke partiet. Prøv igjen eller gå tilbake.",
    sessionExpired: "Den forrige økten din er utløpt. Bli med på nytt.",
    // Removed from the lobby (usually the ghost-sweep after a locked phone).
    // Never silence: say it happened, and give them the one button that fixes it.
    removedLobbyTitle: "Fjernet fra lobbyen",
    removedLobbyBody:
      "Du ble borte en stund, så arrangøren tok deg ut av lobbyen. Trykk under, så er du med igjen.",
    rejoinLobby: "Bli med igjen",
    rejoinFailed: "Klarte ikke å bli med igjen. Prøv en gang til.",
    // Removed after the tournament started — the pairings are set, so they have
    // to join afresh rather than slipping silently back in.
    removedTitle: "Du ble fjernet fra turneringen",
    removedBody:
      "Arrangøren har tatt deg ut. Du kan bli med på nytt med PIN-en fra tavla.",
    rejoinNew: "Bli med på nytt",
    oppOutOfTime: "Motstanderens tid er ute!",
    claimWin: "Krev seier på tid",
    myTimeOut: "Tiden din er ute",
    finalTitle: "Sluttresultat",
    youPlaced: "Du ble nr.",
    of: "av",
    drawReason: {
      agreement: "Remis ved avtale",
      threefold: "Remis – trekkgjentakelse",
      insufficient: "Remis – for lite materiell",
      stalemate: "Remis – patt",
      fifty_move: "Remis – 50-trekksregel",
      draw: "Remis",
    },
  },

  solo: {
    cta: "Solo-spill",
    title: "Solo-spill",
    subtitle: "Øv deg når som helst – ingen PIN nødvendig",
    chooseColor: "Velg farge",
    white: "Hvit",
    black: "Svart",
    random: "Tilfeldig",
    difficulty: "Nivå",
    easy: "Lett",
    medium: "Middels",
    hard: "Vanskelig",
    impossible: "Umulig",
    start: "Start parti",
    thinking: "Datamaskinen tenker …",
    yourTurn: "Din tur",
    waiting: "Datamaskinen sin tur",
    computer: "Datamaskinen",
    you: "Du",
    newGame: "Nytt parti",
    newGameConfirm: "Starte nytt parti? Det pågående partiet blir borte.",
    undo: "Angre",
    back: "Tilbake",
    youWon: "Du vant!",
    youLost: "Datamaskinen vant",
    draw: "Remis",
    wonSub: "Sterkt spilt mot maskinen!",
    lostSub: "Prøv igjen – du klarer det!",
    drawSub: "Jevnt parti.",
    adaptive: "Tilpasset",
    adaptiveHint: "Maskinen justerer seg til ditt nivå",
    yourLevel: "Ditt nivå",
    levelUp: "Nivået ditt steg!",
    levelDown: "Nivået ditt sank litt",
    levelSame: "Nivået ditt holdt seg",
  },

  coach: {
    modeNormal: "♟ Vanlig spill",
    modeCoach: "🎓 Med coach",
    lessons: "📚 Lær sjakk – 18 oppgaver",
    level: "Hva vil du?",
    laer: "Lære å spille",
    ovning: "Bli bedre",
    mester: "Bli verdensmester",
    laerSub: "Hjelp til å unngå tabber underveis",
    ovningSub: "Tilbakemelding + angre og prøv igjen",
    mesterSub: "Sterkeste motstander + full analyse etterpå",
    warn: "Pass på – dette trekket ser ut til å tape materiell. Vil du flytte likevel?",
    moveAnyway: "Flytt likevel",
    tagGood: "👍 Godt trekk!",
    tagInaccuracy: "🤔 Litt unøyaktig",
    tagBlunder: "⚠️ Tabbe – du taper noe her",
    retry: "↶ Angre og prøv igjen",
    keep: "Spill videre",
    review: "🎓 Trenerens gjennomgang",
    lessonsTitle: "Lær sjakk",
    lessonsIntro: "18 små oppgaver – fra hvordan brikkene går til matt i ett trekk.",
    hint: "Hint",
    lessonDone: "Riktig! 🎉",
    lessonRetry: "Ikke helt – les hintet og prøv igjen.",
    /** {n} = oppgavenummer, {total} = antall oppgaver. */
    lessonProgress: "Oppgave {n} av {total}",
    /** {n} = løste oppgaver, {total} = antall oppgaver. */
    lessonsProgress: "{n} av {total} klart",
    lessonTryAgain: "↺ Prøv igjen",
    lessonSolvedLabel: "Klart",
    next: "Neste oppgave →",
    backToList: "← Oppgavene",
  },
} as const;

export type Locale = typeof no;
