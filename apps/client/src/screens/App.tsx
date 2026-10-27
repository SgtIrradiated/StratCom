import { FACTIONS, MAPS, getFaction } from "@stratcom/data";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Capabilities } from "../boot/capabilities";
import type { GameSession } from "../game/GameSession";
import { LoadCancelled, loadMatch } from "../game/loadMatch";
import {
  defaultSkirmish,
  localSlot,
  validateSkirmish,
  type SkirmishConfig,
} from "../game/skirmishConfig";
import { skinFor } from "../ui/theme";
import { FactionSelect } from "./FactionSelect";
import { InGame } from "./InGame";
import { Loading, type LoadLine } from "./Loading";
import { MainMenu } from "./MainMenu";
import { Results } from "./Results";
import { SkirmishSetup } from "./SkirmishSetup";
import { transition, type Screen, type ScreenEvent } from "./router";

const CONTENT = { factions: FACTIONS, maps: MAPS };

/** A fresh match seed. The client may use `Math.random`; only the sim may not (ADR-0002). */
const newSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

/** The local player's slot config while one exists (every screen but the main menu). */
function configOf(screen: Screen): SkirmishConfig | undefined {
  return screen.id === "menu" ? undefined : screen.config;
}

/**
 * Root of the menu and HUD UI. Owns the screen state machine ({@link transition}), the
 * running {@link GameSession}, and the faction skin. Enter and Escape act as the primary and
 * back actions on every screen except the match, which handles its own keys.
 */
/** `?hotseat`: debug mode in which one person commands every player in turn (F9). */
const HOTSEAT = new URLSearchParams(window.location.search).has("hotseat");

export function App(props: { caps: Capabilities }): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ id: "menu" });
  const [lines, setLines] = useState<readonly LoadLine[]>([]);
  const lastConfig = useRef<SkirmishConfig>(defaultSkirmish(CONTENT, newSeed()));
  const session = useRef<GameSession | undefined>(undefined);
  const dispatch = (event: ScreenEvent): void => {
    setScreen((s) => transition(s, event));
  };

  const config = configOf(screen);
  if (config) lastConfig.current = config;
  const local = config ? config.slots[localSlot(config)] : undefined;
  const skin = skinFor(local ? getFaction(local.factionId) : undefined);

  // Mirror the skin colours onto :root for elements outside the app tree (selection box).
  const phosphor = skin.style["--phosphor"] ?? "";
  useEffect(() => {
    document.documentElement.style.setProperty("--phosphor", phosphor);
  }, [phosphor]);

  useEffect(() => {
    document.documentElement.dataset["screen"] = screen.id;
    if (screen.id !== "game" && screen.id !== "loading") {
      session.current?.dispose();
      session.current = undefined;
    }
  }, [screen.id]);

  const loadingConfig = screen.id === "loading" ? screen.config : undefined;
  useEffect(() => {
    if (!loadingConfig) return;
    const abort = new AbortController();
    setLines([]);
    loadMatch(
      loadingConfig,
      (label, detail) => {
        setLines((l) => [...l, { label, detail }]);
      },
      (message) => {
        dispatch({ t: "failed", message: `Simulation error: ${message}` });
      },
      abort.signal,
    ).then(
      (s) => {
        session.current = s;
        dispatch({ t: "loaded" });
      },
      (err: unknown) => {
        if (err instanceof LoadCancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ t: "failed", message: `Could not start the match: ${message}` });
      },
    );
    return () => {
      abort.abort();
    };
  }, [loadingConfig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (screen.id === "game" || e.repeat) return;
      const t = e.target;
      const focused =
        t instanceof HTMLButtonElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLInputElement;
      if (e.key === "Escape") {
        dispatch({ t: "back" });
      } else if (e.key === "Enter" && !focused) {
        if (screen.id === "menu" || screen.id === "results") {
          dispatch({ t: "skirmish", config: lastConfig.current });
        } else if (screen.id === "setup") {
          if (validateSkirmish(screen.config, CONTENT).length === 0) dispatch({ t: "next" });
        } else if (screen.id === "faction") {
          dispatch({ t: "next" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [screen]);

  // Dispose the running match if the whole app goes away (Vite HMR).
  useEffect(() => () => session.current?.dispose(), []);

  const configure = (c: SkirmishConfig): void => {
    dispatch({ t: "configure", config: c });
  };
  return (
    <div class={`app ${skin.className} on-${screen.id}`} style={skin.style}>
      {screen.id === "menu" && (
        <MainMenu
          caps={props.caps}
          notice={screen.notice}
          onSkirmish={() => {
            dispatch({ t: "skirmish", config: lastConfig.current });
          }}
        />
      )}
      {screen.id === "setup" && (
        <SkirmishSetup
          config={screen.config}
          phosphor={phosphor}
          onChange={configure}
          onBack={() => {
            dispatch({ t: "back" });
          }}
          onNext={() => {
            dispatch({ t: "next" });
          }}
        />
      )}
      {screen.id === "faction" && (
        <FactionSelect
          config={screen.config}
          onChange={configure}
          onBack={() => {
            dispatch({ t: "back" });
          }}
          onNext={() => {
            dispatch({ t: "next" });
          }}
        />
      )}
      {screen.id === "loading" && (
        <Loading
          title={`${local ? getFaction(local.factionId).name : ""} · deploying`}
          lines={lines}
          onCancel={() => {
            dispatch({ t: "back" });
          }}
        />
      )}
      {screen.id === "game" && session.current && (
        <InGame
          session={session.current}
          config={screen.config}
          hotseat={HOTSEAT}
          onEnd={(result) => {
            dispatch({ t: "ended", result });
          }}
          onQuit={() => {
            dispatch({ t: "quit" });
          }}
        />
      )}
      {screen.id === "results" && (
        <Results
          config={screen.config}
          result={screen.result}
          onMenu={() => {
            dispatch({ t: "back" });
          }}
          onRematch={() => {
            dispatch({ t: "skirmish", config: screen.config });
          }}
        />
      )}
    </div>
  );
}
