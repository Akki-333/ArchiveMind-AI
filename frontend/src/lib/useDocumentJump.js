/**
 * Open a document in chat or the mind map, reusing an existing conversation
 * for that document rather than starting a duplicate one every time.
 *
 * Navigation still happens if the session cannot be created - landing on the
 * screen you asked for beats being silently kept where you were.
 */
import { useNavigate } from 'react-router-dom';

import { createSession } from '../api';

export const useDocumentJump = (sessions, setSessions, setCurrentSessionId) => {
  const navigate = useNavigate();
  return async (doc, targetPath) => {
    const existing = sessions.find((s) => s.doc_id === doc.id);
    if (existing) {
      setCurrentSessionId(existing.id);
    } else {
      try {
        const session = await createSession(doc.filename, doc.id);
        setSessions((prev) => [session, ...prev]);
        setCurrentSessionId(session.id);
      } catch {
        // Navigation still makes sense even if the session could not be made.
      }
    }
    navigate(targetPath);
  };
};
