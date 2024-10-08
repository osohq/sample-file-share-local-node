"use client";

import React, { useState, useEffect } from "react";
import { useFormState } from "react-dom";

import { SubmitButton } from "@/lib/components";
import { Org, Role } from "@/lib/relations";
import {
  createUser,
  ReadableUser,
  getReadableUsersWithPermissions,
} from "@/actions/user";
import { getCreateUserOrgs, getOrgRoles } from "@/actions/org";

import UserManager from "./UserManager";
import { stringifyError } from "@/lib/result";

interface UserCreatorProps {
  requestor: string;
  orgsIn: Org[];
}

/**
 * Provides a component to create users, as well as manage permitted users.
 *
 * This component receives organizations from `OrgCreator` (`orgsIn`), and
 * creates users, it passes to `UserManager`.
 */
const UserCreator: React.FC<UserCreatorProps> = ({ requestor, orgsIn }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [roles, setRoles] = useState<Role[]>([]);

  // We need to provide the username of the user creating the new user to ensure
  // they're permitted to do so.
  const createUserWithCreator = createUser.bind(null, { requestor });
  const [formState, formAction] = useFormState(createUserWithCreator, null);

  // Triggers re-build of form to reset fields.
  const [formKey, setFormKey] = useState<number>(0);

  // Organizations that user can create new users on.
  const [orgs, setOrgs] = useState<Org[]>(orgsIn);
  // Synchronize orgs with orgsIn.
  useEffect(() => {
    setOrgs(orgsIn);
  }, [orgsIn]);

  // Users to propagate down to the manage users component.
  const [users, setUsers] = useState<ReadableUser[]>([]);

  // Convenience function to update the form data by reaching out to the
  // database + applying Oso list filtering.
  async function updateUsers(requestor: string) {
    try {
      const users = await getReadableUsersWithPermissions(requestor);
      // Don't let the user manage their own permissions.
      setUsers(users.filter((user) => user.username !== requestor));
    } catch (e) {
      setErrorMessage(stringifyError(e));
    }
  }

  // Get users + roles on initial load
  useEffect(() => {
    const initializeCreateUserFormState = async () => {
      try {
        const orgsResult = await getCreateUserOrgs(requestor);
        // Determine the database's values for `organization_role`.
        const orgRoles = await getOrgRoles();
        setOrgs(orgsResult);
        setRoles(orgRoles);
        updateUsers(requestor);
      } catch (e) {
        setErrorMessage(stringifyError(e));
      }
    };
    initializeCreateUserFormState();
  }, []);

  // Update users whenever new user created.
  useEffect(() => {
    if (!formState) {
      return;
    }
    if (formState.success) {
      // Refresh the page if the form submission was successful to re-fetch new
      // data.
      updateUsers(requestor);
      // Re-render form after successful submission.
      setFormKey((prevKey) => prevKey + 1);
      setErrorMessage(null);
    } else {
      setErrorMessage(formState.error);
    }
  }, [formState]);

  return (
    <div>
      {Boolean(orgs?.length) && (
        <div>
          <hr />
          <h2>User management</h2>
          <h3>Create users</h3>
        </div>
      )}
      {errorMessage && (
        <div className="error" role="alert">
          {errorMessage}
        </div>
      )}
      {Boolean(orgs?.length) && (
        <form action={formAction} key={formKey}>
          <div>
            <label htmlFor="username">Username:</label>
            <input id="username" type="text" name="username" required />
          </div>
          <div>
            <label htmlFor="organization">Organization:</label>
            <select id="organization" name="organization" required>
              {orgs.map((org) => (
                <option key={org.name} value={org.name}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="role">Role:</label>
            <select id="role" name="role" required>
              {roles.map((role) => (
                <option key={role.name} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton action="Create user" />
        </form>
      )}
      <UserManager requestor={requestor} usersIn={users} roles={roles} />
    </div>
  );
};

export default UserCreator;
