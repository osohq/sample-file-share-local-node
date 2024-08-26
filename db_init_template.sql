-- substitutions occur in db_init_generate.sh; if not using the orchestrated DB,
-- you can skip this section.
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};

\connect ${DB_NAME};

-- the remainder of these commands create the data model + data for the
-- application

CREATE TABLE organizations (name TEXT PRIMARY KEY);

-- Note that this is synchronized with oso-policy.polar
CREATE TYPE organization_role AS ENUM ('member', 'admin');

-- Do not allow duplicate usernames. Each user belongs to a single organization.
CREATE TABLE users (
	username
		TEXT PRIMARY KEY,
	org
		TEXT REFERENCES organizations (name),
	"role"
		organization_role
);

-- Our special `global` organization
INSERT INTO organizations (name) VALUES ('_');
-- A default, bootstrap user
INSERT INTO users (username, org, "role") VALUES ('root', '_', 'admin');

-- Note that this is synchronized with oso-policy.polar
CREATE TYPE document_role AS ENUM ('viewer', 'editor', 'manager', 'owner');

CREATE TABLE documents (
	id
		SERIAL UNIQUE NOT NULL,
	org
		TEXT REFERENCES organizations (name),
	title
		TEXT NOT NULL,
	public
		BOOLEAN NOT NULL DEFAULT false,
	PRIMARY KEY (org, id)
);

CREATE TABLE document_user_roles (
	document_id
		SERIAL REFERENCES documents (id) ON DELETE CASCADE,
	username
		TEXT REFERENCES users (username) ON DELETE CASCADE,
	"role"
		document_role,
	PRIMARY KEY (document_id, username)
);

-- For more details about how this interacts with other components of the system,
-- see:
-- - oso-policy.polar for this application's Polar policy, for use in Oso Cloud
-- - oso-local-auth.yaml for how we correlate the policy to the SQL schema
