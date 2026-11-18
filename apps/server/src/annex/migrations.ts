import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

// Annex tables migrate under their own ledger so their ids never collide with upstream's
// `effect_sql_migrations`, which refuses to start when two builds disagree on an id.
const run = Migrator.make({});

const migrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  "1_Geasa": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS annex_project_settings (
        project_id TEXT PRIMARY KEY,
        key_prefix TEXT NOT NULL,
        next_number INTEGER NOT NULL DEFAULT 1,
        delivery_actions_json TEXT,
        checks_json TEXT NOT NULL DEFAULT '[]',
        rules TEXT NOT NULL DEFAULT ''
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS annex_geas (
        geas_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        geas_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        request TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'none',
        labels_json TEXT NOT NULL DEFAULT '[]',
        thread_id TEXT,
        run_state TEXT NOT NULL DEFAULT 'idle',
        needs_you INTEGER NOT NULL DEFAULT 0,
        last_activity_at TEXT NOT NULL,
        workspace_json TEXT NOT NULL,
        model_selection_json TEXT NOT NULL,
        runtime_mode TEXT NOT NULL,
        interaction_mode TEXT NOT NULL,
        report_json TEXT NOT NULL,
        report_revision INTEGER NOT NULL DEFAULT 0,
        agent_runs_since_user INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      )
    `;
    yield* sql`CREATE INDEX IF NOT EXISTS idx_annex_geas_thread ON annex_geas(thread_id)`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS annex_geas_activity (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id TEXT NOT NULL UNIQUE,
        geas_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        event_type TEXT,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        notify INTEGER NOT NULL DEFAULT 0,
        actions_json TEXT NOT NULL DEFAULT '[]',
        run_id TEXT,
        created_at TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_annex_geas_activity_geas ON annex_geas_activity(geas_id, seq)
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS annex_geas_runs (
        run_id TEXT PRIMARY KEY,
        geas_id TEXT NOT NULL,
        thread_run_id TEXT,
        started_by TEXT NOT NULL,
        model_selection_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        outcome TEXT,
        final_response TEXT
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_annex_geas_runs_geas ON annex_geas_runs(geas_id, started_at)
    `;
    // The latest exit code per command in a geas thread, which is what checks are verified from.
    yield* sql`
      CREATE TABLE IF NOT EXISTS annex_geas_commands (
        item_id TEXT PRIMARY KEY,
        geas_id TEXT NOT NULL,
        command TEXT NOT NULL,
        exit_code INTEGER,
        completed_at TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_annex_geas_commands_geas
      ON annex_geas_commands(geas_id, completed_at)
    `;
  }),
  "2_Familiars": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE IF NOT EXISTS annex_familiars (
        familiar_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role_prompt TEXT NOT NULL,
        project_id TEXT NOT NULL,
        thread_id TEXT,
        model_selection_json TEXT NOT NULL,
        runtime_mode TEXT NOT NULL,
        interaction_mode TEXT NOT NULL,
        autonomy TEXT NOT NULL,
        tome TEXT NOT NULL DEFAULT '',
        tome_revision INTEGER NOT NULL DEFAULT 0,
        daily_run_budget INTEGER NOT NULL,
        runs_today INTEGER NOT NULL DEFAULT 0,
        runs_day TEXT NOT NULL DEFAULT '',
        paused_at TEXT,
        archived_at TEXT,
        held_task_ids_json TEXT NOT NULL DEFAULT '[]',
        held_wakes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    yield* sql`CREATE INDEX IF NOT EXISTS idx_annex_familiars_thread ON annex_familiars(thread_id)`;
    // Which thread laid a geas, so a Familiar's geasa can wake its channel.
    yield* sql`ALTER TABLE annex_geas ADD COLUMN enacted_by_thread_id TEXT`;
  }),
};

export const runAnnexMigrations = run({
  loader: Migrator.fromRecord(migrations),
  table: "annex_migrations",
}).pipe(Effect.withSpan("Annex.runMigrations"));
