package storage

import (
	"database/sql"
	"errors"
	"time"

	"github.com/mindsift-app/mindsift/internal/collab"
)

// doc_op_results keeps the result of every operation a client sent, by its op_id, so a batch sent again
// (a lost answer, a batch resent weeks later from IndexedDB) gets the same answers instead of being applied
// twice (Doku/database.md, "Why doc_op_results is kept 90 days"). It is the table with one row per edit,
// kept for 90 days, so its rows are compact (migration 52; before, about 310 bytes a row with its indexes):
//   - the result in columns, the status as a number (opResultStatus); a result of op_id carries op_id
//     itself, and a conflict copy's id follows from it (collab.ConflictBlockID), so neither is stored,
//   - created_at in Unix seconds (only the retention reads it),
//   - no user_id (nothing read it).
// Operations the server makes itself (moving a branch, task titles, the secret sweep) get random ids that
// nobody sends again; their results are not stored (applyDocChangeCtx with record false).

// opResultStatus: the number stored for a status; its position in the list is the code.
var opResultStatus = []string{collab.StatusApplied, collab.StatusConflict, collab.StatusRejected}

func opStatusCode(status string) int {
	for i, s := range opResultStatus {
		if s == status {
			return i
		}
	}
	return len(opResultStatus) // never stored: Apply only returns the three
}

// storedOpResult reads the result stored for opID through q. found is false when there is none;
// a result of another note (or one that cannot be read) comes back as "op_id_reused", as before.
func storedOpResult(q docQueryer, docID, opID string) (res collab.Result, found bool, err error) {
	var storedDoc, reason string
	var status, version int
	var seq int64
	err = q.QueryRow(`SELECT doc_id, status, version, seq, reason FROM doc_op_results WHERE op_id = ?`, opID).
		Scan(&storedDoc, &status, &version, &seq, &reason)
	if errors.Is(err, sql.ErrNoRows) {
		return res, false, nil
	}
	if err != nil {
		return res, false, err
	}
	if storedDoc != docID || status < 0 || status >= len(opResultStatus) {
		return collab.Result{OpID: opID, Status: collab.StatusRejected, Reason: "op_id_reused"}, true, nil
	}
	res = collab.Result{OpID: opID, Status: opResultStatus[status], Reason: reason, Version: version, Seq: seq}
	if res.Status == collab.StatusConflict {
		res.ConflictBlockID = collab.ConflictBlockID(opID)
	}
	return res, true, nil
}

// storeOpResult records the result of an operation of docID.
func storeOpResult(tx *sql.Tx, docID string, res collab.Result, at time.Time) error {
	_, err := tx.Exec(`INSERT INTO doc_op_results (op_id, doc_id, status, version, seq, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		res.OpID, docID, opStatusCode(res.Status), res.Version, res.Seq, res.Reason, at.Unix())
	return err
}

// migrateCompactOpResults converts doc_op_results into the compact form (migration 52). The results kept
// so far are converted with it (a result that does not parse answers "op_id_reused", as its reader did).
func (s *Store) migrateCompactOpResults() error {
	// Converted already (a database whose record of migrations was lost runs every step again)
	if old, err := s.columnExists("doc_op_results", "result"); err != nil || !old {
		return err
	}
	return s.execInTx(
		stmt(`CREATE TABLE doc_op_results_new (
			op_id TEXT PRIMARY KEY,
			doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			status INTEGER NOT NULL DEFAULT 0,
			version INTEGER NOT NULL DEFAULT 0,
			seq INTEGER NOT NULL DEFAULT 0,
			reason TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`),
		stmt(`INSERT INTO doc_op_results_new (op_id, doc_id, status, version, seq, reason, created_at)
			SELECT op_id, doc_id,
				CASE WHEN NOT json_valid(result) THEN 2
					WHEN json_extract(result, '$.status') = 'applied' THEN 0
					WHEN json_extract(result, '$.status') = 'conflict' THEN 1 ELSE 2 END,
				CASE WHEN json_valid(result) THEN COALESCE(json_extract(result, '$.version'), 0) ELSE 0 END,
				CASE WHEN json_valid(result) THEN COALESCE(json_extract(result, '$.seq'), 0) ELSE 0 END,
				CASE WHEN json_valid(result) THEN COALESCE(json_extract(result, '$.reason'), '') ELSE 'op_id_reused' END,
				COALESCE(CAST(strftime('%s', created_at) AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER))
			FROM doc_op_results`),
		stmt(`DROP TABLE doc_op_results`),
		stmt(`ALTER TABLE doc_op_results_new RENAME TO doc_op_results`),
		// Deleting a note deletes its results (ON DELETE CASCADE looks them up by note)
		stmt(`CREATE INDEX idx_doc_op_results_doc ON doc_op_results(doc_id)`),
		stmt(`CREATE INDEX idx_doc_op_results_created ON doc_op_results(created_at)`),
	)
}
