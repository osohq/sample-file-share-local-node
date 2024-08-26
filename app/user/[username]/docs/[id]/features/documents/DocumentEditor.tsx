"use client";

import React, { useEffect, useState } from "react";

import {
  deleteDoc,
  getDocumentWPermissions,
  ReadableDocument,
  setPublic,
  updateDocumentTitle,
} from "@/actions/doc";
import { useFormState } from "react-dom";
import DocumentShareManager from "./DocumentShareManager";
import { stringifyError } from "@/lib/result";
import Link from "next/link";

interface DocumentEditorProps {
  username: string;
  id: number;
}

/**
 * Render the user's view of the application.
 */
const DocumentEditor: React.FC<DocumentEditorProps> = ({ id, username }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [docState, setDoc] = useState<ReadableDocument | null>(null);
  const updateDocumentTitleWithParams = updateDocumentTitle.bind(null, {
    username,
    id,
  });
  const [docTitleFormState, docTitleFormAction] = useFormState(
    updateDocumentTitleWithParams,
    null
  );

  const [isPublic, setIsPublic] = useState<boolean>(false);

  // Get users + roles on initial load
  useEffect(() => {
    const initializeDocumentState = async () => {
      try {
        const docRes = await getDocumentWPermissions(username, id);
        setDoc(docRes);
        setIsPublic(docRes.public);
        setErrorMessage(null);
      } catch (e) {
        setErrorMessage(stringifyError(e));
      }
    };
    initializeDocumentState();
  }, []);

  useEffect(() => {
    if (!docState || !docTitleFormState) {
      return;
    }

    if (docTitleFormState.success) {
      setErrorMessage(null);
      setDoc({ ...docState, title: docTitleFormState.value });
    } else {
      setErrorMessage(docTitleFormState.error);
    }
  }, [docTitleFormState]);

  // Save changed roles button
  const handlePublicToggle = async () => {
    try {
      const publicSetting = await setPublic(username, id, !isPublic);
      setErrorMessage(null);
      setIsPublic(publicSetting);
    } catch (e) {
      setErrorMessage(stringifyError(e));
    }
  };

  // Save changed roles button
  const handleDelete = async () => {
    try {
      await deleteDoc(username, id);
      setErrorMessage(null);
      // Load new page
      window.location.href = `/user/${username}`;
    } catch (e) {
      setErrorMessage(stringifyError(e));
    }
  };

  return (
    <div>
      {errorMessage && (
        <div className="error" role="alert">
          {errorMessage}
        </div>
      )}

      {docState && (
        <div>
          <Link href={`/user/${username}`}>&lt; Home</Link>
          <h3>
            {username}'s Permissions on Doc {id}
          </h3>
          <div className="permissions">
            <table>
              <thead>
                <tr>
                  <th>
                    <strong>Permission</strong>
                  </th>
                  <th>
                    <strong>Value</strong>
                  </th>
                  <th>
                    <strong>Lets this user...</strong>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Read</td>
                  <td>true</td>
                  <td>
                    Read the document; if you can see this, it must be true.
                  </td>
                </tr>
                <tr>
                  <td>Edit</td>
                  <td>{docState.edit.toString()}</td>
                  <td>Change this document's title.</td>
                </tr>
                <tr>
                  <td>Set public</td>
                  <td>{docState.setPublic.toString()}</td>
                  <td>
                    Toggle this document's public attribute. Public docs can be
                    read by all org members.
                  </td>
                </tr>
                <tr>
                  <td>Delete</td>
                  <td>{docState.delete.toString()}</td>
                  <td>Delete the document.</td>
                </tr>
                <tr>
                  <td>Manage share</td>
                  <td>{docState.manageShare.toString()}</td>
                  <td>
                    Manage other users' roles. Note that organization admins
                    always implicitly have the <code>owner</code> role.
                  </td>
                </tr>
                <tr>
                  <td>Assign owner</td>
                  <td>{docState.assignOwner.toString()}</td>
                  <td>
                    Assign or unassign the <code>owner</code> roles + remove
                    share from other owners.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <hr />
          <table>
            <tbody>
              <tr>
                <td>
                  <strong>Title:</strong>
                </td>
                <td>
                  {docState.edit ? (
                    <form action={docTitleFormAction}>
                      <div>
                        <input
                          id="title"
                          type="text"
                          name="title"
                          defaultValue={docState.title}
                          required
                        />
                      </div>
                      <button type="submit">Save title</button>
                    </form>
                  ) : (
                    <p>{docState.title}</p>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div>
            {docState.setPublic ? (
              <button onClick={handlePublicToggle}>
                {isPublic ? "Set private" : "Set public"}
              </button>
            ) : (
              <p>{isPublic ? "Public" : "Private"}</p>
            )}
          </div>
          <div>
            {docState.delete ? (
              <button onClick={handleDelete}>Delete document</button>
            ) : (
              <div />
            )}
          </div>
          {docState.manageShare ? (
            <DocumentShareManager username={username} id={id} />
          ) : (
            <div />
          )}
          <h3>Contents</h3>
          <p>
            Neque porro quisquam est qui dolorem ipsum quia dolor sit amet,
            consectetur, adipisci velit...
          </p>
        </div>
      )}
    </div>
  );
};

export default DocumentEditor;
