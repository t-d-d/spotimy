import styles from "./Page.module.css";
import { signInMessage } from "./view";

export function SignedOutView() {
  const message = signInMessage(
    new URLSearchParams(window.location.search).get("signin"),
  );
  return (
    <main>
      <h1 className={styles.title}>spotimy</h1>
      <p className={styles.lede}>
        Keeps your saved albums and your album playlists in step, for you and
        the people you share playlists with.
      </p>
      {message === undefined ? null : (
        <p className={styles.note} role="status">
          {message}
        </p>
      )}
      <div className={styles.buttons}>
        <a className={styles.primary} href="/api/login">
          Sign in with Spotify
        </a>
      </div>
    </main>
  );
}
