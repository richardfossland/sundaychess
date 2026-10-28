// Én skriver per turnering. Åpner man samme fysiske turnering i to faner, ville begge lagre sin
// egen versjon av loggen og den siste vinne stille. Her tar den første fanen en lås; fane to blir
// skrivebeskyttet og kan «ta over» (bekreftes av brukeren). Storskjerm/utskrift leser bare og
// trenger ingen lås.
//
// Primært `navigator.locks` (eksklusiv lås som holdes så lenge fanen lever; frigis automatisk når
// fanen lukkes eller krasjer; `steal` gir take over). Reserve uten Web Locks: BroadcastChannel med
// hjerteslag (holder svarer på «hello», og gir seg ved «takeover»).

export interface WriterLock {
  readonly held: boolean;
  /** Prøv å få låsen uten å vente. true = vi er skriveren. */
  acquire(): Promise<boolean>;
  /** Tving til oss låsen (den forrige holderen får onLost). */
  takeOver(): Promise<void>;
  /** Slipp låsen og rydd opp. */
  dispose(): void;
}

interface LockManagerLike {
  request(
    name: string,
    options: { mode?: "exclusive"; ifAvailable?: boolean; steal?: boolean },
    cb: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}
interface ChannelLike {
  postMessage(m: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
}

export interface LockEnv {
  locks?: LockManagerLike | null;
  createChannel?: ((name: string) => ChannelLike) | null;
  /** Hvor lenge reservevarianten venter på svar fra en eksisterende holder. */
  helloWaitMs?: number;
  beatMs?: number;
}

const browserEnv = (): LockEnv => ({
  locks: typeof navigator !== "undefined" && "locks" in navigator ? (navigator.locks as unknown as LockManagerLike) : null,
  createChannel: typeof BroadcastChannel !== "undefined" ? (n) => new BroadcastChannel(n) as unknown as ChannelLike : null,
});

export function createWriterLock(name: string, onLost: () => void, env: LockEnv = browserEnv()): WriterLock {
  return env.locks ? webLock(name, onLost, env.locks) : channelLock(name, onLost, env);
}

function webLock(name: string, onLost: () => void, locks: LockManagerLike): WriterLock {
  let held = false;
  let release: (() => void) | null = null;
  let disposed = false;

  function request(opts: { ifAvailable?: boolean; steal?: boolean }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let got = false;
      const until = new Promise<void>((r) => {
        release = r;
      });
      locks
        .request(name, { mode: "exclusive", ...opts }, async (lock) => {
          if (!lock || disposed) {
            resolve(false);
            return;
          }
          got = true;
          held = true;
          resolve(true);
          await until;
        })
        .then(
          () => {
            if (got) held = false; // en mislykket (ifAvailable) forespørsel skal ikke nullstille en senere
          },
          () => {
            // Låsen ble stjålet (AbortError) eller forespørselen feilet.
            if (!got) return resolve(false);
            const wasHeld = held;
            held = false;
            if (wasHeld && !disposed) onLost();
          },
        );
    });
  }

  return {
    get held() {
      return held;
    },
    acquire: () => request({ ifAvailable: true }),
    async takeOver() {
      await request({ steal: true });
    },
    dispose() {
      disposed = true;
      held = false;
      release?.();
    },
  };
}

function channelLock(name: string, onLost: () => void, env: LockEnv): WriterLock {
  const me = Math.random().toString(36).slice(2);
  const ch = env.createChannel?.(`sundaychess-lock:${name}`) ?? null;
  const helloWait = env.helloWaitMs ?? 300;
  const beatMs = env.beatMs ?? 1500;
  let held = false;
  let beat: ReturnType<typeof setInterval> | null = null;
  let onBeat: (() => void) | null = null;

  const send = (t: string) => ch?.postMessage({ t, from: me });
  function become() {
    held = true;
    send("beat");
    beat = setInterval(() => send("beat"), beatMs);
  }
  function stop() {
    held = false;
    if (beat) clearInterval(beat);
    beat = null;
  }

  if (ch) {
    ch.onmessage = (e) => {
      const m = e.data as { t?: string; from?: string };
      if (!m || m.from === me) return;
      if (m.t === "hello" && held) send("beat");
      else if (m.t === "beat") onBeat?.();
      else if (m.t === "takeover" && held) {
        stop();
        onLost();
      }
    };
  }

  return {
    get held() {
      return held;
    },
    async acquire() {
      if (!ch) return true; // ingen mekanisme: ingen vern (bedre enn å låse brukeren ute)
      const taken = await new Promise<boolean>((resolve) => {
        onBeat = () => resolve(true);
        send("hello");
        setTimeout(() => resolve(false), helloWait);
      });
      onBeat = null;
      if (taken) return false;
      become();
      return true;
    },
    async takeOver() {
      send("takeover");
      await new Promise((r) => setTimeout(r, 50));
      if (!held) become();
    },
    dispose() {
      stop();
      if (ch) {
        ch.onmessage = null;
        ch.close();
      }
    },
  };
}
