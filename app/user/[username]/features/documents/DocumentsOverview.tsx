"use client";

import React, { useEffect, useState } from "react";

import { Document, User } from "@/lib/relations";
import { getReadableDocuments, createDocument } from "@/actions/doc";
import Link from "next/link";
import { useFormState } from "react-dom";
import { stringifyError } from "@/lib/result";

interface DocumentsOverviewProps {
  user: User;
}

const DocumentsOverview: React.FC<DocumentsOverviewProps> = ({ user }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [newDocFormVisible, setNewDocFormVisible] = useState<boolean>(false);
  // We need to provide the username of the user creating the new user to ensure
  // they're permitted to do so.
  const createDocumentWithCreator = createDocument.bind(null, {
    requestor: user,
  });
  const [newDocFormState, newDocFormAction] = useFormState(
    createDocumentWithCreator,
    null
  );

  useEffect(() => {
    const initializeDocumentsOverView = async () => {
      try {
        const docsRes = await getReadableDocuments(user);
        setDocs(docsRes);
      } catch (e) {
        setErrorMessage(stringifyError(e));
      }
    };
    initializeDocumentsOverView();
  }, []);

  const handleToggleForm = () => {
    setNewDocFormVisible(!newDocFormVisible);
  };

  useEffect(() => {
    // Narrow from null
    if (!newDocFormState) {
      return;
    }

    if (newDocFormState.success) {
      setErrorMessage(null);
      // Load new page
      window.location.href = `/user/${user.username}/docs/${newDocFormState.value}`;
    } else if (!newDocFormState.success) {
      setErrorMessage(newDocFormState.error);
    }
  }, [newDocFormState]);

  return (
    <div>
      <h1>{user.username} Docs</h1>

      {errorMessage && (
        <div className="error" role="alert">
          {errorMessage}
        </div>
      )}

      <button onClick={handleToggleForm}>
        {newDocFormVisible ? "Cancel" : "+ Create Doc"}
      </button>

      {newDocFormVisible && (
        <form action={newDocFormAction}>
          <div>
            <label htmlFor="title">Title:</label>
            <input id="title" type="text" name="title" required />
          </div>
          <button type="submit">Submit</button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Title</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td>
                <Link href={`/user/${user.username}/docs/${doc.id}`}>
                  {doc.title}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DocumentsOverview;
