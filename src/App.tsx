import { useState, useEffect } from "react";
import SessionsPage from "./pages/SessionsPage";
import IncidentPage from "./pages/IncidentPage";
import type { Session } from "./types";
import {
  readDraftFromUrl,
  findOrCreateTodaySession,
  isoToHHMM,
  clearDraftParams,
} from "./lib/draftHandler";

type View =
  | { page: "sessions" }
  | { page: "incident"; session: Session; initialDraft?: { description: string; time: string; testMode: boolean } };

export default function App() {
  const [view, setView] = useState<View>({ page: "sessions" });
  const [sessionsKey, setSessionsKey] = useState(0);

  // On first mount, check URL for a Drift Report draft.
  useEffect(() => {
    const draft = readDraftFromUrl();
    if (!draft) return;
    const session = findOrCreateTodaySession();
    setView({
      page: "incident",
      session,
      initialDraft: {
        description: draft.description,
        time: isoToHHMM(draft.recordedAt),
        testMode: draft.testMode,
      },
    });
    clearDraftParams();
  }, []);

  if (view.page === "incident") {
    return (
      <IncidentPage
        session={view.session}
        initialDraft={view.initialDraft}
        onBack={() => {
          setView({ page: "sessions" });
          setSessionsKey(k => k + 1);
        }}
      />
    );
  }

  return (
    <SessionsPage
      key={sessionsKey}
      onSelect={session => setView({ page: "incident", session })}
    />
  );
}
