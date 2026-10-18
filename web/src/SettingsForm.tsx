import type { Settings, Status } from "../../shared/page-api";
import styles from "./Page.module.css";

interface Props {
  settings: Settings;
  members: Status["members"];
  me: string;
  onChange: (settings: Settings) => void;
}

const choices: { key: keyof Settings; label: string; hint?: string }[] = [
  {
    key: "autoApply",
    label: "Apply changes by myself each morning",
    hint: "Starts once you have pressed Apply yourself.",
  },
  {
    key: "followGroup",
    label: "Follow the album playlists the rest of the group makes",
  },
  { key: "albumFirst", label: "Name new playlists Album – Artist" },
  {
    key: "privatePlaylists",
    label: "Make new playlists private",
    hint: "The group cannot follow private playlists.",
  },
];

export function SettingsForm({ settings, members, me, onChange }: Props) {
  const others = members
    .filter((member) => member.id !== me)
    .map((member) => member.name);
  return (
    <section className={styles.card} aria-labelledby="settings">
      <h2 id="settings" className={styles.section}>
        Settings
      </h2>
      {choices.map(({ key, label, hint }) => (
        <label key={key} className={styles.setting}>
          <input
            type="checkbox"
            checked={settings[key]}
            onChange={(event) => {
              onChange({ ...settings, [key]: event.target.checked });
            }}
          />
          <span>
            {label}
            {key === "followGroup" && others.length > 0 ? (
              <span className={styles.meta}> ({others.join(", ")})</span>
            ) : null}
            {hint === undefined ? null : (
              <span className={styles.meta}>
                <br />
                {hint}
              </span>
            )}
          </span>
        </label>
      ))}
    </section>
  );
}
