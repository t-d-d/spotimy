import { SignedIn } from "./SignedIn";
import { SignedOutView } from "./SignedOutView";
import styles from "./Page.module.css";
import { useStatus } from "./useStatus";

export function App() {
  const { loaded, load, show } = useStatus();
  switch (loaded.kind) {
    case "loading":
      return <p className={styles.meta}>Loading…</p>;
    case "signed-out":
      return <SignedOutView />;
    case "failed":
      return (
        <main>
          <h1 className={styles.title}>spotimy</h1>
          <p className={styles.note}>
            spotimy could not be reached. Try again in a minute.
          </p>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        </main>
      );
    case "ready":
      return <SignedIn status={loaded.status} show={show} reload={load} />;
  }
}
