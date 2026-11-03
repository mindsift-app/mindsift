# Teilen & Berechtigungen

## Rollen

| Ebene | Werte | Bedeutung |
|---|---|---|
| Server | `admin`, `member` | Admins verwalten Benutzer, Organisationen, Einladungen und Einstellungen (`/admin/*`). |
| Organisation | Mitglied | Bestimmt, wer wen sieht (siehe unten). Nur Server-Admins ordnen zu. |
| Gruppe | `admin`, `member` | Gruppen-Admins ändern/löschen die Gruppe und verwalten Mitglieder. Wer eine Gruppe anlegt, wird Admin. |
| Ressource | siehe unten | Eigentümer, Bearbeiter, Leser. |

## Berechtigungen je Ressource

| Ressource | Eigentümer | Bearbeiter | Leser | Freigabe an |
|---|---|---|---|---|
| **Aufgabenliste** (`task_list_shares.permission`) | alles, löschen, (un)teilen | Aufgaben anlegen/ändern/abhaken/verschieben/löschen, Liste umbenennen, Spalten ändern | nur ansehen | Benutzer, Gruppen |
| **Geteilte Liste** (`list_shares.role`) | alles, löschen, (un)teilen | Einträge anlegen/ändern/abhaken/löschen | nur ansehen | Benutzer, Gruppen |
| **Notiz** (`doc_shares`, `doc_team_shares`) | alles, Freigaben, löschen | Inhalt, Struktur, Titel | nur lesen | Benutzer, Gruppen |
| **Geteilter Ordner** (`workspace_folder_shares`) | alles | Notizen darin bearbeiten | nur lesen | Benutzer, Gruppen |

- **Notizen und Ordner:** Die effektive Rolle berechnet `Store.DocRole` (Eigentümer, Eigentümer des geteilten Ordners = Bearbeiter, direkte Freigabe, Gruppenfreigabe, Ordnerfreigabe; höchste gewinnt). Im Freigabe-Dialog sind für Notizen und geteilte Ordner „Bearbeiten“ und „Nur Lesen“ wählbar (gespeichert als `write`/`read`). Bearbeiter ändern Inhalt, Struktur und Titel über die Sync-Engine; Leser sehen Änderungen live.
- Bei Aufgabenlisten und Listen gilt: Hat jemand mehrere Zugriffswege (direkt und über Gruppen), zählt die **höchste** Stufe.
- Für Gruppen gilt die Freigabe für alle aktuellen und künftigen Mitglieder.
- **Aufgaben-Zuweisungen** hängen am Zugriff: Verliert jemand den letzten Zugriffsweg auf eine Aufgabenliste, entfernt der Server ihn aus allen Zuweisungen dieser Liste ([modules/tasks.md](modules/tasks.md)).

## Aufgabenlisten teilen (Details)

1. Eigentümer öffnet „Teilen“ an der Liste, wählt Gruppe oder Benutzer und die Stufe **Bearbeiten** oder **Nur Lesen**.
2. `POST /task-lists/{id}/shares` speichert `permission`; erneutes Hinzufügen desselben Ziels ändert die Stufe.
3. `GET /task-lists` liefert je Liste `permission` (`owner`/`editor`/`viewer`). Das Frontend blendet für `viewer` alle Eingabemöglichkeiten aus und zeigt „Nur Lesen“.
4. Der Server prüft unabhängig davon jeden Schreibzugriff (`403`, `storage.ErrTaskListReadOnly`).

Bestehende Freigaben aus der Zeit vor dieser Stufe wurden mit `editor` migriert, behalten also ihr Verhalten.

## Sichtbarkeit: Organisationen und Modi (`system_settings.sharing_mode`)

Zwei Begriffe, nicht verwechseln:

| Begriff | Verwaltet von | Zweck |
|---|---|---|
| **Organisation** | nur Server-Admin (`/admin/organizations`) | Legt fest, wer wen **sehen** darf. Jeder Benutzer gehört höchstens einer an (`users.organization_id`). |
| **Gruppe** (Code: `teams`) | Benutzer selbst | Abkürzung beim Teilen („teile mit meiner WG“). Erweitert die Sichtbarkeit nie. |

| Modus | Wer sieht wen |
|---|---|
| `private` | Niemand. Benutzersuche, Teilen und Gruppen sind aus (Server antwortet mit Fehler, UI blendet sie aus). |
| `organizations` (Standard) | Nur Mitglieder derselben Organisation. Wer keiner angehört, sieht niemanden. |
| `open` | Alle. |

**Eine Regel für alles:** `Store.CanSee(a, b)` und `Store.CanShareWith(owner, typ, ziel)` in [visibility.go](../internal/storage/visibility.go). Darüber laufen Benutzerverzeichnis (`/users/directory`, `/collaborators`), jede Freigabe (Notiz, Ordner, Aufgabenliste, Liste) und das Hinzufügen zu Gruppen. Server-Admins folgen beim Teilen derselben Regel; alle Konten verwalten sie über `/admin/*`.

- Mit einer Gruppe teilen darf nur, wer selbst Mitglied ist. Eine Gruppe gehört zur Organisation ihres Erstellers (`teams.org_id`), Mitglieder kommen nur von dort.
- Unbekannte und nicht sichtbare Personen liefern dieselbe Meldung („Benutzer oder Gruppe nicht gefunden“), damit niemand Konten per E-Mail ausprobieren kann.
- **Teilen geht nur vom Eigentümer.** Bearbeiter können nicht weiterteilen und keine fremden Freigaben entfernen; jeder kann aber seine eigene Freigabe entfernen (eine geteilte Notiz oder einen Ordner verlassen).

**Rechte folgen der Sichtbarkeit.** `Store.PruneSharing` entfernt alles, was unter dem aktuellen Modus nicht mehr erlaubt wäre: Gruppen-Mitgliedschaften außerhalb der Organisation der Gruppe, Freigaben an Personen, die der Eigentümer nicht mehr sieht, Freigaben an Gruppen, in denen der Eigentümer nicht mehr ist; danach leere Gruppen und über `PruneTaskAssignees` die Aufgaben-Zuweisungen. Gruppen ohne Admin bekommen einen. Es läuft nach:

- Wechsel oder Entfernen der Organisation eines Benutzers, Löschen einer Organisation
- Wechsel des Modus durch den Admin (vorher zeigt `GET /admin/settings/sharing-impact?mode=…` als Probelauf, wie viel wegfällt)
- Austritt aus oder Löschen einer Gruppe, Löschen eines Kontos

Bei der Einrichtung im Modus `organizations` wird eine Organisation mit dem Namen der Instanz angelegt und der erste Admin ihr zugeordnet. Einladungen und „Benutzer anlegen“ können eine Organisation mitgeben. Im Demo-Modus sind `admin` und `user` in der Organisation „Demo“.

## Entkoppelte Ablage geteilter Notizen und Ordner

- **Geteilte Ordner:** Der Ordner existiert einmal (`workspace_shared_folders`); jeder Empfänger hat seinen eigenen Einhängepfad (`workspace_folder_mounts.mount_path`). Verschiebt ein Empfänger den Ordner, ändert sich nur sein Pfad. Der Unterpfad innerhalb des Ordners (`documents.sub_folder_path`) gilt für alle.
- **Einzelne Notizen:** Jeder Empfänger kann eine geteilte Notiz in einen eigenen Ordner legen (`doc_user_folders`); die Notiz des Eigentümers bleibt unberührt.

## Sitzungen und Zugriff

- Jede Anmeldung ist eine Sitzung (`sessions`), die einzeln beendet werden kann (Logout, Profil → Aktive Sitzungen). Rollenwechsel, Deaktivierung und „Alle Sitzungen beenden“ beenden alle Sitzungen (`token_version`); eine Passwortänderung alle außer der aktuellen.
- Registrierung nur per Einladungscode oder, wenn vom Admin freigeschaltet, offen. Das erste Konto wird immer Administrator.
- Bekannte Lücken in der Zugriffskontrolle: siehe [flaws.md](flaws.md).
