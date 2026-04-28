import { useState } from "react";
import SessionsPage from "./pages/SessionsPage";
import IncidentPage from "./pages/IncidentPage";
import type { Session } from "./types";

type View = { page: "sessions" } | { page: "incident"; session: Session };

export default function App() {
  const [view, setView] = useState<View>({ page: "sessions" });
  const [sessionsKey, setSessionsKey] = useState(0);

  if (view.page === "incident") {
    return (
      <IncidentPage
        session={view.session}
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
