"use server";

import { pool } from "@/lib/db";
import { authorizeUser, oso } from "@/lib/oso";
import { User } from "@/lib/relations";
import { Result, stringifyError } from "@/lib/result";

/**
 * Identifies a `User` the requestor is permitted to read, as well fields
 * describing other permissions.
 */
export interface ReadableUser {
  username: string;
  org: string;
  role: string;
  editRole: boolean;
  deleteUser: boolean;
}

/**
 * Returns readable users with additional permissions set.
 *
 * The results are separated into `thisUser`, which identifies the requestor's
 * user, and `users`, which are all other users the requestor has `read` access
 * on.
 *
 * ## Oso documentation
 * This function demonstrates an advanced for of "authorized list" where, in a
 * single query, we provide a set of users with one permission, and then include
 * details about other permissions in the results of the query.
 *
 * @throws {Error} If there is a problem with the database connection, or the
 * requestor cannot find their own users' details.
 */
export async function getReadableUsersWithPermissions(
  requestor: string,
): Promise<{ users: ReadableUser[]; thisUser: User }> {
  const osoUser = { type: "User", id: requestor };
  const client = await pool.connect();
  try {
    // Determine the users for which this user has `read` permissions. This will
    // form the base of which users this user might be able to manage.
    const readableUsersCond = await oso.listLocal(
      osoUser,
      "read",
      "User",
      "username",
    );

    // Determine the users for which this user has `edit_role` permissions.
    const editableRoleUsersCond = await oso.listLocal(
      osoUser,
      "edit_role",
      "User",
      "username",
    );

    // Determine the users for which this user has `delete` permissions.
    const deleteUsersCond = await oso.listLocal(
      osoUser,
      "delete",
      "User",
      "username",
    );

    // Determine all visible users (`readableUsersCond`), along with whether or
    // not this user has `edit_role` (`editableRoleUsersCond`) or `delete`
    // permissions (`deleteUsersCond`).
    //
    // We inline the `edit_role` and `delete` permissions queries in this query to
    // make fewer calls to the database.
    const usersWPermissionsRes = await client.query<ReadableUser>(
      `SELECT
        username,
        org,
        role,
        ${editableRoleUsersCond} as "editRole",
        ${deleteUsersCond} as "deleteUser"
      FROM users
      WHERE ${readableUsersCond}
      ORDER BY username`,
    );
    const users = usersWPermissionsRes.rows;

    // Extract this user from the set of all users because we don't want them to
    // be able to edit themselves.
    const userIndex = users.findIndex((user) => user.username === requestor);

    if (userIndex === -1) {
      throw new Error(`user ${requestor} not found`);
    }

    const thisUser: User = users.splice(userIndex, 1)[0];
    return { users, thisUser };
  } catch (error) {
    console.error("Error in getReadableUsersWithPermissions:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Creates a new user on an organization with a specified role.
 *
 * Requires that the user has the `create_user` permission on the organization.
 *
 * ## Oso documentation
 * This function demonstrates a standard write path––determining the user has
 * permission to write the data, and permitting the write to occur only if they
 * do.
 */
export async function createUser(
  // Bound parameter because `createUser` is used as a form action.
  p: { requestor: string },
  _prevState: Result<string> | null,
  formData: FormData,
): Promise<Result<string>> {
  const data = {
    username: formData.get("username") as string,
    org: formData.get("organization") as string,
    role: formData.get("role") as string,
  };

  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, p.requestor, "create_user", {
      type: "Organization",
      id: data.org,
    });
    if (!auth) {
      return {
        success: false,
        error: `not permitted to create user in Organization ${data.org}`,
      };
    }

    await client.query(
      `INSERT INTO users (username, org, role) VALUES ($1, $2, $3::organization_role);`,
      [data.username, data.org, data.role],
    );
    return { success: true, value: data.username };
  } catch (error) {
    return { success: false, error: stringifyError(error) };
  } finally {
    client.release();
  }
}

/**
 * Deletes the specified user.
 *
 * Requires that the user has the `delete` permission on the specified user.
 *
 * ## Oso documentation
 * This function demonstrates a standard write path––determining the user has
 * permission to write the data, and permitting the write to occur only if they
 * do.
 *
 * @throws {Error} If there is a problem with the database connection, or the
 * requestor cannot does not have permission to delete the requested user.
 */
export async function deleteUser(
  requestor: string,
  username: string,
): Promise<undefined> {
  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, requestor, "delete", {
      type: "User",
      id: username,
    });
    if (!auth) {
      throw new Error(`not permitted to delete User ${username}`);
    }

    await client.query(`DELETE FROM users WHERE username = $1;`, [username]);
    return;
  } catch (error) {
    console.error("Error in deleteUser:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Edits a set of users' roles, identifying the users by their username.
 *
 * Requires that the user has the `edit` permission on all edited users.
 *
 * ## Oso documentation
 * This function demonstrates a standard write path––determining the user has
 * permission to write the data, and permitting the write to occur only if they
 * do.
 *
 * @throws {Error} If there is a problem with the database connection, or the
 * requestor cannot does not have permission to edit all requested users.
 */
export async function editUsersRoleByUsername(
  requestor: string,
  updates: User[],
): Promise<undefined> {
  const client = await pool.connect();

  const osoUser = { type: "User", id: requestor };

  try {
    // Ensure that this user has `edit_role` permission for all users being
    // updated. We perform this as a `listLocal` operation because there are an
    // arbitrary number of users that could be updated here.
    const editRoleAuthorized = await oso.listLocal(
      osoUser,
      "edit_role",
      "User",
      "users.username",
    );

    // Ensure that the users edited are part of the set of users the requestor
    // has `edit_role` permissions on.
    const queryText = `
        UPDATE users
        SET role = v.role::organization_role
        FROM (VALUES 
          ${updates.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")}
        ) AS v(username, role)
        WHERE users.username = v.username AND ${editRoleAuthorized};
      `;

    const userFields: string[] = updates.flatMap((user) => [
      user.username,
      user.role,
    ]);

    await client.query("BEGIN");
    const r = await client.query(queryText, userFields);

    // Check the affected row count, which is our signal that there is a
    // discrepancy between the number of users submitted and the number of users
    // that passed the condition expressed by `editRoleAuthorized`.
    if (r.rowCount !== updates.length) {
      // If these numbers do not align, abort the operation.
      client.query("ROLLBACK");
      throw new Error(`not permitted to edit role of all submitted users`);
    } else {
      // If these numbers aligned things are good.
      client.query("COMMIT");
      return;
    }
  } catch (error) {
    console.error("Error in editUsersRoleByUsername:", error);
    throw error;
  } finally {
    client.release();
  }
}
