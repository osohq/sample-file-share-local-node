"use server";

import { pool } from "@/lib/db";
import { authorizeUser, oso } from "@/lib/oso";
import { User } from "@/lib/relations";
import { Result, stringifyError } from "@/lib/result";

/**
 * Identifies a `User`, as well as fields describing its permissions on its
 * parent organization.
 */
export interface UserWOrgPermissions {
  username: string;
  org: string;
  role: string;
  // Permissions
  readOrg: boolean;
  createUser: boolean;
  createOrg: boolean;
  createDoc: boolean;
}

/**
 * Fetches the specified user, as well as their permissions on their
 * organization.
 *
 * This is a super-admin-like function that intentionally omits any
 * authorization.
 *
 * ## Oso documentation
 * Demonstrates an advanced form of local authorization, which relies on
 * evaluating many properties of a resource in a single query. This design
 * reduces the number of roundtrips to the database your application needs to
 * perform.
 *
 * @throws {Error} If there is a problem with the database connection or the
 * user does not exist.
 */
export async function getUserWOrgPermissions(
  username: string
): Promise<UserWOrgPermissions> {
  const osoUser = { type: "User", id: username };
  const client = await pool.connect();
  try {
    // At this point, we only know the username but not the organization to
    // which the user belongs. While we could restructure this endpoint to use
    // `oso.authorizeLocal`, it would require an additional roundtrip to the
    // database, which is likely less efficient than having the DB check for the
    // existence of a value in a subquery (i.e. `oso.listLocal`).
    //
    // However, if we _did_ know the organization, using `oso.authorizeLocal` as
    // a subquery in the projection would almost certainly have better
    // performance because it would result in an optimized point lookup.
    const readOrgCond = await oso.listLocal(
      osoUser,
      "read",
      "Organization",
      "org"
    );

    // Ditto the comment on `readOrgCond`.
    const createUsersCond = await oso.listLocal(
      osoUser,
      "create_user",
      "Organization",
      "org"
    );

    // TODO: This should be removed from `Organization` and become a global
    // permission.
    const createOrgCond = await oso.listLocal(
      osoUser,
      "create",
      "Organization",
      "org"
    );

    const createDocCond = await oso.listLocal(
      osoUser,
      "create_doc",
      "Organization",
      "org"
    );

    const user = await client.query<UserWOrgPermissions>(
      `SELECT
        username,
        org,
        role,
        ${readOrgCond} as "readOrg",
        ${createUsersCond} as "createUser",
        ${createOrgCond} as "createOrg",
        ${createDocCond} as "createDoc"
      FROM users
      WHERE username = $1`,
      [username]
    );
    if (user.rowCount != 1) {
      throw new Error(`cannot find User ${username}`);
    }

    return user.rows[0];
  } catch (error) {
    console.error("Error in getUser:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Identifies a `User` the requestor is permitted to read, as well as fields
 * describing other permissions.
 */
export interface ReadableUser {
  username: string;
  org: string;
  role: string;
  // Permissions
  editRole: boolean;
  deleteUser: boolean;
}

/**
 * Get the list of users which `requestor` can `read`, as well as additional
 * information about permissions on those users.
 *
 * This data can include the requestor's own data, so the requestor might need
 * to be filtered out before using the data.
 *
 * ## Oso documentation
 * Demonstrates an advanced form of local authorization, which relies on
 * evaluating many properties of a resource in a single query. This design
 * reduces the number of roundtrips to the database your application needs to
 * perform.
 *
 * @throws {Error} If there is a problem with the database connection.
 */
export async function getReadableUsersWithPermissions(
  requestor: string
): Promise<ReadableUser[]> {
  const osoUser = { type: "User", id: requestor };
  const client = await pool.connect();
  try {
    // Determine the users for which this user has `read` permissions. This will
    // form the base of which users this user might be able to manage.
    const readableUsersCond = await oso.listLocal(
      osoUser,
      "read",
      "User",
      "username"
    );

    // Determine the users for which this user has `edit_role` permissions.
    const editableRoleUsersCond = await oso.listLocal(
      osoUser,
      "edit_role",
      "User",
      "username"
    );

    // Determine the users for which this user has `delete` permissions.
    const deleteUsersCond = await oso.listLocal(
      osoUser,
      "delete",
      "User",
      "username"
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
      ORDER BY username`
    );
    const users = usersWPermissionsRes.rows;
    return users;
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
 * Requires `requestor` to have the `create_user` permission on the
 * organization.
 *
 * ## Oso documentation
 * Demonstrates a standard authorized endpoint––ensuring the user has a specific
 * permission, and permitting it to occur only if they do.
 *
 * @throws {Error} If there is a problem with the database connection or
 * authorization fails.
 */
export async function createUser(
  // Bound parameter because `createUser` is used as a form action.
  p: { requestor: string },
  _prevState: Result<string> | null,
  formData: FormData
): Promise<Result<string>> {
  const data = {
    username: formData.get("username")! as string,
    org: formData.get("organization")! as string,
    role: formData.get("role")! as string,
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
      [data.username, data.org, data.role]
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
 * Requires `requestor` to have the `delete` permission for the specified user.
 *
 * ## Oso documentation
 * Demonstrates a standard authorized endpoint––ensuring the user has a specific
 * permission, and permitting it to occur only if they do.
 *
 * @throws {Error} If there is a problem with the database connection or
 * authorization fails.
 */
export async function deleteUser(
  requestor: string,
  username: string
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
 * Requires `requestor` to have the `edit` permission on all edited users.
 *
 * ## Oso documentation
 * Demonstrates a complex approach to authorizing many resources at once using
 * local authorization, relying on a transaction to verify authorization
 * occurred as the requestor expected.
 *
 * @throws {Error} If there is a problem with the database connection, or the
 * requestor cannot does not have permission to edit all requested users.
 */
export async function editUsersRoleByUsername(
  requestor: string,
  updates: User[]
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
      "users.username"
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
      throw new Error(`not permitted to edit role of all submitted users`);
    } else {
      // If these numbers aligned things are good.
      client.query("COMMIT");
      return;
    }
  } catch (error) {
    client.query("ROLLBACK");
    console.error("Error in editUsersRoleByUsername:", error);
    client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get all users in a specified organization for which `requestor` has the
 * `read` permission.
 *
 * ## Oso documentation
 * This function demonstrates a standard read path with local authorization,
 * relying on `listLocal` to generate a condition for a query.
 *
 * @throws {Error} If there is a problem with the database connection.
 */
export async function getOrgUsers(
  requestor: string,
  org: string
): Promise<User[]> {
  const osoUser = { type: "User", id: requestor };
  const client = await pool.connect();
  try {
    // Determine the users for which this user has `read` permissions.
    const readableUsersCond = await oso.listLocal(
      osoUser,
      "read",
      "User",
      "username"
    );

    const orgUsers = await client.query<User>(
      `SELECT username, org, role
        FROM users
        WHERE org = $1 AND ${readableUsersCond}
        ORDER BY username`,
      [org]
    );

    return orgUsers.rows;
  } catch (error) {
    console.error("Error in getOrgUsers:", error);
    throw error;
  } finally {
    client.release();
  }
}
