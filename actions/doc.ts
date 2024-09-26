"use server";

import { pool } from "@/lib/db";
import { authorizeUser, oso } from "@/lib/oso";
import { User, Document, DocumentUserRole, Role } from "@/lib/relations";
import { Result, stringifyError } from "@/lib/result";

/**
 * Get all documents on which the `user` has the `read` permission.
 *
 * ## Oso documentation
 * This function demonstrates a standard read path with local authorization,
 * relying on `listLocal` to generate a condition for a query.
 *
 * @throws {Error} If there is a problem with the database connection.
 */
export async function getReadableDocuments(user: User): Promise<Document[]> {
  const client = await pool.connect();
  try {
    const osoUser = { type: "User", id: user.username };

    // Determine the organizations for which the user has `create_user`
    // permissions.
    const readableDocsCond = await oso.listLocal(
      osoUser,
      "read",
      "Document",
      "id"
    );

    // Inline the condition generated from `listLocal` into a query the get the
    // organization's names.
    const readableDocs = `SELECT id, org, title, public FROM documents WHERE ${readableDocsCond}`;
    const docs = await client.query<Document>(readableDocs);
    return docs.rows;
  } catch (error) {
    console.error("Error in getReadableDocuments:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create a document.
 *
 * Requires the `requestor` have `create_document` permission on their own
 * organization. (Users can only create documents in their own organizations.)
 *
 * ## Oso documentation
 * Demonstrates a standard authorized endpoint––ensuring the user has a specific
 * permission, and permitting it to occur only if they do.
 */
export async function createDocument(
  // Bound parameter because `createDocument` is used as a form action.
  p: { requestor: User },
  _prevState: Result<number> | null,
  formData: FormData
): Promise<Result<number>> {
  const { requestor } = p;

  const data = {
    title: formData.get("title")! as string,
  };

  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, requestor.username, "create_doc", {
      type: "Organization",
      id: requestor.org,
    });

    if (!auth) {
      return {
        success: false,
        error: `not permitted to create documents in Organization ${requestor.org}`,
      };
    }

    client.query("BEGIN");

    const docIdRes = await client.query<{ id: number }>(
      `INSERT INTO documents (org, title, public) SELECT org, $2, false FROM users WHERE username = $1 RETURNING id`,
      [requestor.username, data.title]
    );
    const docId = docIdRes.rows[0].id;

    await client.query(
      `INSERT INTO document_user_roles (document_id, username, "role") VALUES ($1, $2, 'owner')`,
      [docId, requestor.username]
    );
    client.query("COMMIT");

    return { success: true, value: docId };
  } catch (error) {
    client.query("ROLLBACK");
    return {
      success: false,
      error: stringifyError(error),
    };
  } finally {
    client.release();
  }
}

/**
 * Identifies a `User` the requestor is permitted to read, as well fields
 * describing other permissions.
 */
export interface ReadableDocument {
  id: number;
  org: string;
  title: string;
  public: boolean;
  // Permissions
  delete: boolean;
  assignOwner: boolean;
  manageShare: boolean;
  edit: boolean;
  setPublic: boolean;
}

/**
 * Gets a specific document (`id`), with the permissions that `requestor` has on
 * it.
 *
 * Requires the `requestor` have `read` permission on the document.
 *
 * ## Oso documentation
 * Demonstrates an advanced form of local authorization, which relies on
 * evaluating many properties of a resource in a single query. This design
 * reduces the number of roundtrips to the database your application needs to
 * perform.
 *
 * @throws {Error} If there is a problem with the database connection or the
 * user does not have the `read` permission on the identified document.
 */
export async function getDocumentWPermissions(
  requestor: string,
  id: number
): Promise<ReadableDocument> {
  const osoUser = { type: "User", id: requestor };
  const document = {
    type: "Document",
    id: id.toString(),
  };
  const client = await pool.connect();
  try {
    // Determine actions available on document.
    const actionsQuery = await oso.actionsLocal(osoUser, document);
    const readableDocsQuery = `SELECT
        id,
        org,
        title,
        public,
        'delete' = ANY(actions) AS delete,
        'assign_owner' = ANY(actions) AS "assignOwner",
        'manage_share' = ANY(actions) as "manageShare",
        'edit' = ANY(actions) AS edit,
        'delete' = ANY(actions) AS delete,
        'set_public' = ANY(actions) AS "setPublic"
      FROM documents
      LEFT JOIN LATERAL (
        SELECT array_agg(actions) AS actions FROM (
            ${actionsQuery}
        ) AS actions
      ) AS actions ON true
      WHERE id = $1 AND 'read' = ANY (actions)`;

    const readableDocs = await client.query<ReadableDocument>(
      readableDocsQuery,
      [id]
    );

    const rows = readableDocs.rows;
    if (rows.length != 1) {
      throw new Error(`cannot find Document ${id}`);
    }

    return readableDocs.rows[0];
  } catch (error) {
    console.error("Error in getDocumentWPermissions:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Updates the specified document's title.
 *
 * Requires `requestor` to have the `edit` permission on the document.
 *
 * ## Oso documentation
 * Demonstrates a standard authorized endpoint––ensuring the user has a specific
 * permission, and permitting it to occur only if they do.
 *
 * @throws {Error} If there is a problem with the database connection,
 * authorization fails, or another request concurrently deletes the document.
 */
export async function updateDocumentTitle(
  // Bound parameter because `updateDocumentTitle` is used as a form action.
  p: { username: string; id: number },
  _prevState: Result<string> | null,
  formData: FormData
): Promise<Result<string>> {
  const { username, id } = p;

  const data = {
    title: formData.get("title")! as string,
  };

  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, username, "edit", {
      type: "Document",
      id: `${id}`,
    });
    if (!auth) {
      throw new Error(`not permitted to write to Document ${id}`);
    }

    const title = await client.query<String>(
      `UPDATE documents SET title = $2 WHERE id = $1 RETURNING title;`,
      [id, data.title]
    );

    if (title.rowCount != 1) {
      throw new Error(`cannot find Document ${id}`);
    }

    return { success: true, value: title.rows[0].valueOf() };
  } catch (error) {
    return { success: false, error: stringifyError(error) };
  } finally {
    client.release();
  }
}

/**
 * Set the document's public setting to the specified value.
 *
 * Requires `requestor` to have the `set_public` permission on the document.
 *
 * ## Oso documentation
 * Demonstrates a standard authorized endpoint––ensuring the user has a specific
 * permission, and permitting it to occur only if they do.
 *
 * @throws {Error} If there is a problem with the database connection,
 * authorization fails, or another request concurrently deletes the document.
 */
export async function setPublic(
  requestor: string,
  id: number,
  publicSetting: boolean
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, requestor, "set_public", {
      type: "Document",
      id: `${id}`,
    });
    if (!auth) {
      throw new Error(
        `not permitted to change public setting of Document ${id}`
      );
    }

    const publicSettingRes = await client.query<{ public: boolean }>(
      `UPDATE documents SET public = $2 WHERE id = $1 RETURNING public;`,
      [id, publicSetting]
    );
    if (publicSettingRes.rowCount != 1) {
      throw new Error(`failed to change public setting for Document ${id}`);
    }
    return publicSettingRes.rows[0].public;
  } catch (error) {
    console.error("Error in setPublic:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete the specified document.
 *
 * Requires `requestor` to have the `delete` permission on the document.
 *
 * ## Oso documentation
 * Demonstrates a standard authorized endpoint––ensuring the user has a specific
 * permission, and permitting it to occur only if they do.
 *
 * @throws {Error} If there is a problem with the database connection or
 * authorization fails.
 */
export async function deleteDoc(
  requestor: string,
  id: number
): Promise<undefined> {
  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, requestor, "delete", {
      type: "Document",
      id: `${id}`,
    });
    if (!auth) {
      throw new Error(`not permitted to delete Document ${id}`);
    }

    await client.query(`DELETE FROM documents WHERE id = $1;`, [id]);
    return;
  } catch (error) {
    console.error("Error in deleteDoc:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get all users and their roles on the specified document.
 *
 * Requires `requestor` to have the `manage_share` permission on the document.
 * Additionally, this function returns only users on which the requestor has the
 * `read` permission.
 *
 * ## Oso documentation
 * Demonstrates complex, multi-tiered authorization. The requestor must have
 * permissions on both a primary resource, as well as a list of resources
 * associated with it.
 *
 * @throws {Error} If there is a problem with the database connection or the
 * action is not permitted.
 */
export async function getDocUserRoles(
  requestor: string,
  id: number
): Promise<DocumentUserRole[]> {
  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, requestor, "manage_share", {
      type: "Document",
      id: `${id}`,
    });
    if (!auth) {
      throw new Error(`not permitted to read details of Document ${id}`);
    }

    const osoUser = { type: "User", id: requestor };

    // Determine the users for which the user has `read` permission.
    const readableUsersCond = await oso.listLocal(
      osoUser,
      "read",
      "User",
      "username"
    );

    const docUserRoles = await client.query<DocumentUserRole>(
      `SELECT document_id AS id, username, "role"
        FROM document_user_roles
        WHERE document_id = $1 AND ${readableUsersCond};`,
      [id]
    );

    return docUserRoles.rows;
  } catch (error) {
    console.error("Error in getDocUserRoles:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get all roles that the user can assign to the specified ID.
 *
 * Requires `requestor` to have `manage_share` permission on the document. The
 * set of roles includes the `owner` role iff `requestor` has the `assign_owner`
 * permission.
 *
 * ## Oso documentation
 * Demonstrates complex, multi-layered authorization.
 *
 * @throws {Error} If there is a problem with the database connection.
 */
export async function getAssignableDocRoles(
  requestor: string,
  id: number
): Promise<Role[]> {
  const client = await pool.connect();
  try {
    const manageShareAuth = await authorizeUser(
      client,
      requestor,
      "manage_share",
      {
        type: "Document",
        id: `${id}`,
      }
    );
    if (!manageShareAuth) {
      return [];
    }

    const value = await client.query<Role>(
      `SELECT DISTINCT unnest(enum_range(NULL::document_role)) AS name`,
      []
    );
    let roles = value.rows;

    const assignOwnerAuth = await authorizeUser(
      client,
      requestor,
      "assign_owner",
      {
        type: "Document",
        id: `${id}`,
      }
    );

    if (!assignOwnerAuth) {
      roles = roles.filter((role) => role.name != "owner");
    }

    return roles;
  } catch (error) {
    console.error("Error in getAssignableDocRoles:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Gets the organization to which a document belongs.
 *
 * Requires the `requestor` to have the `read` permission on the document.
 *
 * ## Oso documentation
 * This function demonstrates a standard access pattern––checking that the user
 * is permitted to perform the action.
 *
 * @throws {Error} If there is a problem with the database connection,
 * authorization fails, or the specified document cannot be found.
 */
export async function getDocumentOrg(
  requestor: string,
  id: number
): Promise<string> {
  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, requestor, "read", {
      type: "Document",
      id: id.toString(),
    });
    if (!auth) {
      throw new Error(`not permitted to read Document ${id}`);
    }

    const org = await client.query<{ org: string }>(
      `SELECT org FROM documents WHERE id = $1;`,
      [id]
    );
    if (org.rowCount != 1) {
      throw new Error(`cannot find Document ${id}`);
    }

    return org.rows[0].org;
  } catch (error) {
    console.error("Error in getDocumentOrg:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Assign a user (`username`) `role` on the document.
 *
 * Requires `requestor` to have the `manage_share` permission on the document.
 * If the specified role is `owner`, the requestor must also have the
 * `assign_owner` permission.
 *
 * ## Oso documentation
 * Demonstrates complex, multi-layered authorization.
 *
 * @throws {Error} If there is a problem with the database connection or the
 * action is not permitted.
 */
export async function assignDocUserRole(
  // Bound parameter because `createUser` is used as a form action.
  p: { requestor: string; id: number },
  _prevState: Result<{ username: string; role: string }> | null,
  formData: FormData
): Promise<Result<{ username: string; role: string }>> {
  const data = {
    username: formData.get("username")! as string,
    role: formData.get("role")! as string,
  };

  const client = await pool.connect();
  try {
    const auth = await authorizeUser(client, p.requestor, "manage_share", {
      type: "Document",
      id: p.id.toString(),
    });
    if (!auth) {
      throw new Error(`not permitted to manage share for Document ${p.id}`);
    }
    if (data.role === "owner") {
      const auth = await authorizeUser(client, p.requestor, "assign_owner", {
        type: "Document",
        id: p.id.toString(),
      });
      if (!auth) {
        throw new Error(`not permitted to assign owner for Document ${p.id}`);
      }
    }

    await client.query(
      `INSERT INTO document_user_roles (document_id, username, role) VALUES ($1, $2, $3::document_role);`,
      [p.id, data.username, data.role]
    );
    return { success: true, value: data };
  } catch (error) {
    return { success: false, error: stringifyError(error) };
  } finally {
    client.release();
  }
}

/**
 * Update `username`'s role on the specified document to the specified `role`.
 *
 * Requires the `requestor` to have the `manage_share` permission on the
 * document. If the `username` has the `owner` role, or the caller tries to set
 * the user's role to `owner`, `requestor` must also have the `assign_owner`
 * permission.
 *
 * Additionally, the document must have at least one owner after this
 * modification.
 *
 * ## Oso documentation
 * Demonstrates complex, multi-layered authorization.
 *
 * @throws {Error} If there is a problem with the database connection,
 * authorization fails, or the specified user's role is concurrently removed.
 */
export async function updateDocUserRole(
  requestor: string,
  id: number,
  username: string,
  role: string
): Promise<undefined> {
  const client = await pool.connect();
  try {
    const manageShareAuth = await authorizeUser(
      client,
      requestor,
      "manage_share",
      {
        type: "Document",
        id: id.toString(),
      }
    );
    if (!manageShareAuth) {
      throw new Error(`not permitted to manage share of Document ${id}`);
    }
    if (role === "owner") {
      const assignOwnerAuth = await authorizeUser(
        client,
        requestor,
        "assign_owner",
        {
          type: "Document",
          id: id.toString(),
        }
      );
      if (!assignOwnerAuth) {
        throw new Error(`not permitted to assign owner of Document ${id}`);
      }
    }

    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;");
    const roleCurr = await client.query<{ role: string }>(
      `SELECT "role" FROM document_user_roles WHERE document_id = $1 AND username = $2;`,
      [id, username]
    );

    if (roleCurr.rowCount != 1) {
      throw new Error(`User ${username} does not have role on Document ${id}`);
    }

    if (roleCurr.rows[0].role === "owner") {
      const assignOwnerAuth = await authorizeUser(
        client,
        requestor,
        "assign_owner",
        {
          type: "Document",
          id: id.toString(),
        }
      );
      if (!assignOwnerAuth) {
        throw new Error(`not permitted to change owner of Document ${id}`);
      }
    }

    await client.query(
      `UPDATE document_user_roles SET "role" = $1::document_role WHERE document_id = $2 AND username = $3;`,
      [role, id, username]
    );

    const owners = await client.query<{ count: number }>(
      `SELECT COUNT(*) FROM document_user_roles WHERE "role" = 'owner' AND document_id = $1;`,
      [id]
    );

    if (owners.rows[0].count < 1) {
      throw new Error(`Document ${id} must have at least one owner`);
    } else {
      await client.query("COMMIT");
      return;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error in updateDocUserRole:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Remove a user's role from a document.
 *
 * Requires `requestor` to have the `manage_share` permission on the document.
 * If the specified user has the `owner` role, the requestor must have the
 * `assign_owner` permission.
 *
 * Additionally, the document must have at least one owner after this
 * modification.
 *
 * ## Oso documentation
 * Demonstrates complex, multi-layered authorization.
 *
 * @throws {Error} If there is a problem with the database connection or
 * authorization fails.
 */
export async function deleteDocUserRole(
  requestor: string,
  id: number,
  username: string
): Promise<undefined> {
  const client = await pool.connect();
  try {
    const manageShareAuth = await authorizeUser(
      client,
      requestor,
      "manage_share",
      {
        type: "Document",
        id: id.toString(),
      }
    );
    if (!manageShareAuth) {
      throw new Error(`not permitted to manage share of Document ${id}`);
    }

    await client.query("BEGIN");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;");

    const deletedRole = await client.query<{ role: string }>(
      `DELETE FROM document_user_roles WHERE document_id = $1 AND username = $2 RETURNING "role";`,
      [id, username]
    );

    if (deletedRole.rows[0].role === "owner") {
      const assignOwnerAuth = await authorizeUser(
        client,
        requestor,
        "assign_owner",
        {
          type: "Document",
          id: id.toString(),
        }
      );
      if (!assignOwnerAuth) {
        throw new Error(`not permitted to assign owner of Document ${id}`);
      }
    }

    const ownerCount = await client.query<{ count: number }>(
      `SELECT COUNT(*) FROM document_user_roles WHERE "role" = 'owner' AND document_id = $1;`,
      [id]
    );

    if (ownerCount.rows[0].count < 1) {
      throw new Error(`Document ${id} must have at least one owner`);
    } else {
      await client.query("COMMIT");
      return;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error in deleteDocUserRole:", error);
    throw error;
  } finally {
    client.release();
  }
}
