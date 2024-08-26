"use client";

import React, { useState, useEffect, useRef } from "react";
import { useFormState } from "react-dom";

import { SubmitButton } from "@/lib/components";
import { Role, DocumentUserRole, User } from "@/lib/relations";
import {
  updateDocUserRole,
  deleteDocUserRole,
  getAssignableDocRoles,
  getDocumentOrg,
  getDocUserRoles,
  assignDocUserRole,
} from "@/actions/doc";
import { getOrgUsers } from "@/actions/user";
import { stringifyError } from "@/lib/result";
import Link from "next/link";

interface DocumentShareManagerProps {
  username: string;
  id: number;
}

interface DocumentUserRoleWActions {
  inner: DocumentUserRole;
  roleCurr: string;
  onRoleChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const DocumentShareManager: React.FC<DocumentShareManagerProps> = ({
  username,
  id,
}) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [org, setOrg] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sharedUsers, setSharedUsers] = useState<DocumentUserRoleWActions[]>(
    []
  );
  // Use a ref to formData so that closures built over it operate over a
  // reference.
  const sharedUsersRef = useRef(sharedUsers);
  useEffect(() => {
    sharedUsersRef.current = sharedUsers;
  }, [sharedUsers]);

  const [shareableUsers, setShareableUsers] = useState<User[]>([]);

  function sharedUsersWActions(
    userRoles: DocumentUserRole[]
  ): DocumentUserRoleWActions[] {
    return userRoles.map((user, index) => ({
      inner: user,
      roleCurr: user.role,
      onRoleChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
        handleRoleChange(e, index),
      onEdit: () => handleEdit(index),
      onDelete: () => handleDelete(index),
    }));
  }

  // Get users + roles on initial load
  useEffect(() => {
    const initializeDocShareState = async () => {
      try {
        // Get this document's org.
        const orgsResult = await getDocumentOrg(username, id);
        // Determine the database's values for `organization_role`.
        const docRoles = await getAssignableDocRoles(username, id);
        setErrorMessage(null);
        setOrg(orgsResult);
        setRoles(docRoles);
      } catch (e) {
        setErrorMessage(stringifyError(e));
      }
    };
    initializeDocShareState();
  }, []);

  // Convenience function to update the form data by reaching out to the
  // database + applying Oso list filtering.
  async function updateUsers(requestor: string, org: string) {
    try {
      const orgUsers = await getOrgUsers(requestor, org);
      const docUserRoles = await getDocUserRoles(requestor, id);
      const sharedUsers = new Set(
        docUserRoles.map((docUserRole) => docUserRole.username)
      );
      const shareableUsers = orgUsers.filter(
        (user) => !sharedUsers.has(user.username)
      );
      setSharedUsers(sharedUsersWActions(docUserRoles));
      setShareableUsers(shareableUsers);
    } catch (e) {
      setErrorMessage(stringifyError(e));
    }
  }

  useEffect(() => {
    const initializeUserShareState = async () => {
      if (org === null) {
        return;
      }
      await updateUsers(username, org);
    };
    initializeUserShareState();
  }, [org, roles]);

  const handleRoleChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
    index: number
  ) => {
    const newFormData = [...sharedUsersRef.current];
    newFormData[index].roleCurr = e.target.value;
    setSharedUsers(newFormData);
  };

  // Ensure that there is only one pending change when modifying a single user.
  function ensureOnePendingChange(exceptIndex: number): void {
    sharedUsersRef.current.forEach((user, index) => {
      if (user.inner.role !== user.roleCurr && exceptIndex !== index) {
        throw new Error(
          `Cannot edit or delete individual users with multiple users' changes pending'.`
        );
      }
    });
  }

  // Edit + Delete buttons
  async function handleSingleUserOperation(
    requestor: string,
    index: number,
    operation: "edit" | "delete"
  ) {
    try {
      ensureOnePendingChange(index);
      const user = sharedUsersRef.current[index];
      operation === "edit"
        ? await updateDocUserRole(
            requestor,
            id,
            user.inner.username,
            user.roleCurr
          )
        : await deleteDocUserRole(requestor, id, user.inner.username);
      await updateUsers(requestor, org as string);
    } catch (error) {
      setErrorMessage(stringifyError(error));
    }
  }

  const handleEdit = (index: number) =>
    handleSingleUserOperation(username, index, "edit");
  const handleDelete = (index: number) =>
    handleSingleUserOperation(username, index, "delete");

  // We need to provide the username of the user creating the new user to ensure
  // they're permitted to do so.
  const assignDocUserRoleWRequestor = assignDocUserRole.bind(null, {
    requestor: username,
    id,
  });
  const [formState, formAction] = useFormState(
    assignDocUserRoleWRequestor,
    null
  );

  // Triggers re-build of form to reset fields.
  const [formKey, setFormKey] = useState<number>(0);

  // Update users whenever new user created.
  useEffect(() => {
    if (formState?.success && org !== null) {
      // Refresh the page if the form submission was successful to re-fetch new
      // data.
      updateUsers(username, org);
      // Re-render form after successful submission.
      setFormKey((prevKey) => prevKey + 1);
      setErrorMessage(null);
    } else if (!formState?.success) {
      setErrorMessage(formState?.error as string);
    }
  }, [formState]);

  return (
    <div>
      {errorMessage && (
        <div className="error" role="alert">
          {errorMessage}
        </div>
      )}
      <div>
        <h2>Shares</h2>
        <p>Click the username below to view the document as that user.</p>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Doc Role</th>
            </tr>
          </thead>
          <tbody>
            {sharedUsers.map((s) => {
              const editable =
                roles.find((o) => o.name == s.roleCurr) &&
                s.inner.username !== username;

              return editable ? (
                <tr
                  key={s.inner.username}
                  // Highlight all changed values in yellow to indicate to user
                  // their pending changes.
                  style={{
                    backgroundColor:
                      s.inner.role === s.roleCurr ? "" : "yellow",
                  }}
                >
                  <td>
                    <Link href={`/user/${s.inner.username}/docs/${id}`}>
                      {s.inner.username}
                    </Link>
                  </td>
                  <td>
                    <select
                      name="role"
                      value={s.roleCurr}
                      onChange={(e) => s.onRoleChange(e)}
                    >
                      {roles.map((role) => (
                        <option key={role.name} value={role.name}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button onClick={s.onEdit}>Edit</button>
                  </td>
                  <td>
                    <button onClick={s.onDelete}>Delete</button>
                  </td>
                </tr>
              ) : (
                <tr key={s.inner.username}>
                  <td>
                    {s.inner.username}{" "}
                    <em>{s.inner.username == username ? "(self)" : ""}</em>
                  </td>
                  <td>
                    <p>{s.roleCurr}</p>
                  </td>
                  <td></td>
                  <td></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2>Shareable</h2>
        {Boolean(shareableUsers.length) ? (
          <form action={formAction} key={formKey}>
            <div>
              <label htmlFor="username">User:</label>
              <select id="username" name="username" required>
                {shareableUsers.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="role">Doc Role:</label>
              <select id="role" name="role" required>
                {roles.map((role) => (
                  <option key={role.name} value={role.name}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton action="Share document" />
          </form>
        ) : (
          <p>No available users</p>
        )}
      </div>
    </div>
  );
};

export default DocumentShareManager;
