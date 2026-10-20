import { useState } from "react";
import type { Settings, Status } from "../../shared/page-api";
import {
  Busy,
  Changed,
  leave,
  saveSettings,
  signOut,
  startApply,
  startCheck,
} from "./api";
import styles from "./Page.module.css";
import { PlanView } from "./PlanView";
import { SettingsForm } from "./SettingsForm";
import { byYear, lastLine, standing } from "./view";

interface Props {
  status: Status;
  show: (status: Status) => void;
  reload: () => Promise<void>;
}

export function SignedIn({ status, show, reload }: Props) {
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { last } = status;
  const now = new Date();
  const { state, heading, next, button } = standing(status, now);
  const made = last?.applied?.created ?? [];

  const act = async (action: () => Promise<Status>) => {
    setProblem(undefined);
    try {
      show(await action());
    } catch (error) {
      setProblem(
        error instanceof Changed
          ? "Your plan changed while this page was open. Look it over again, then press Apply plan."
          : error instanceof Busy
            ? "A run is already going. This page updates when it finishes."
            : "That did not work. Try again in a minute.",
      );
      await reload();
    }
  };

  // The box changes at once. The saved status replaces it when it comes.
  const changeSettings = (settings: Settings) => {
    show({ ...status, settings });
    void act(() => saveSettings(settings));
  };

  const leaveSpotimy = () => {
    if (
      !window.confirm(
        "Leave spotimy? It forgets your Spotify sign-in and stops syncing. Nothing in your library changes.",
      )
    ) {
      return;
    }
    void leave().then(() => {
      window.location.assign("/");
    });
  };

  return (
    <main>
      <header className={styles.header}>
        <h1 className={styles.title}>spotimy</h1>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            void signOut().then(() => {
              window.location.assign("/");
            });
          }}
        >
          Sign out
        </button>
      </header>
      <p className={styles.meta}>Signed in as {status.user.name}</p>

      <section className={styles.card} aria-labelledby="run">
        <h2 id="run" className={styles.section}>
          {heading}
        </h2>
        {next === undefined ? null : (
          <p
            className={state === "stopped" ? styles.note : styles.lede}
            role="status"
          >
            {next}
          </p>
        )}
        {last === null ? null : (
          <p className={styles.history}>{lastLine(last, now)}</p>
        )}
        {made.length === 0 ? null : (
          <div className={styles.lede}>
            <p>Drag the new playlists into their year folders:</p>
            <ul className={styles.list}>
              {byYear(made).map(([year, names]) => (
                <li key={year}>
                  <strong>{year}</strong>: {names.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {problem === undefined ? null : (
          <p className={styles.note} role="alert">
            {problem}
          </p>
        )}
        {button === "apply" && last !== null ? (
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void act(() => startApply(last.runId))}
            >
              Apply plan
            </button>
          </div>
        ) : null}
        {button === "update" ? (
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void act(startCheck)}
            >
              Update plan
            </button>
          </div>
        ) : null}
      </section>

      {last === null ? null : <PlanView plan={last.plan} />}

      <SettingsForm
        settings={status.settings}
        members={status.members}
        me={status.user.id}
        onChange={changeSettings}
      />

      <section className={styles.card} aria-labelledby="folders">
        <h2 id="folders" className={styles.section}>
          About folders
        </h2>
        <p className={styles.lede}>
          Spotify does not let apps use playlist folders, so new and followed
          playlists appear at the top of Your Library. Drag each one into its
          folder.
        </p>
      </section>

      <div className={styles.buttons}>
        <button type="button" className={styles.danger} onClick={leaveSpotimy}>
          Leave spotimy
        </button>
      </div>
    </main>
  );
}
