import type { Plan } from "../../shared/page-api";
import styles from "./Page.module.css";
import { byYear, hasWork, ignoredLine } from "./view";

const matchNote = {
  tracks: undefined,
  cover: "matched by cover",
  name: "matched by name only",
} as const;

export function PlanView({ plan }: { plan: Plan }) {
  const ignored = ignoredLine(plan.ignored);
  return (
    <section className={styles.card} aria-labelledby="plan">
      <h2 id="plan" className={styles.section}>
        {hasWork(plan) ? "What applying would change" : "Nothing to change"}
      </h2>
      {plan.first && hasWork(plan) ? (
        <p className={styles.note}>
          This is your first plan. Nothing changes until you press Apply.
        </p>
      ) : null}

      {plan.save.length === 0 ? null : (
        <details>
          <summary className={styles.summary}>
            Albums to save ({plan.save.length})
          </summary>
          <ul className={styles.list}>
            {plan.save.map((entry) => (
              <li key={entry.albumId}>
                {entry.label}
                {matchNote[entry.match] === undefined ? null : (
                  <span className={styles.pill}>{matchNote[entry.match]}</span>
                )}
                {entry.from === entry.label ? null : (
                  <div className={styles.meta}>from {entry.from}</div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.follow.length === 0 ? null : (
        <details>
          <summary className={styles.summary}>
            Playlists to follow ({plan.follow.length})
          </summary>
          <ul className={styles.list}>
            {plan.follow.map((entry) => (
              <li key={entry.playlistId}>
                {entry.name}
                <div className={styles.meta}>{entry.ownerName}&apos;s</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.create.length === 0 ? null : (
        <details>
          <summary className={styles.summary}>
            Playlists to make ({plan.create.length})
          </summary>
          <ul className={styles.list}>
            {byYear(plan.create).map(([year, names]) => (
              <li key={year}>
                <strong>{year}</strong>: {names.join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan.review.length === 0 ? null : (
        <details>
          <summary className={styles.summary}>
            Left alone ({plan.review.length})
          </summary>
          <ul className={styles.list}>
            {plan.review.map((entry) => (
              <li key={entry.playlist}>
                {entry.playlist}
                <div className={styles.meta}>{entry.detail}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {ignored === undefined ? null : <p className={styles.meta}>{ignored}</p>}
    </section>
  );
}
