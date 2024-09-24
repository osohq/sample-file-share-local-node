# Oso Cloud document sharing example application

This application provides a reference for using Oso Cloud's [local
authorization](https://www.osohq.com/docs/reference/authorization-data/local-authorization)
to create a multi-tenant document sharing application.

## App UX

The application includes a multi-tenant-enabled user management system, which
lets you create organizations (tenants), as well as users within those tenants
with specific roles. When running the app, you have a super-admin like
impersonation privilege that lets you view the application state as any given
user.

Users can create documents, which they can then share with other users,
assigning them specific roles on the shared files. The only editable field of
the documents are their titles, though other capabilities are more
full-featured.

## Reference files

This app's primary purposes are providing reference and documentation for using
Oso's local authorization.

While any part of the code might be instructive, the primary set of
documentation includes:

- Configuration to set up local authorization within an application
- Integration of local authorization within the API

Different components offer different examples of authorization patterns:

| Component      | Pattern                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `Organization` | RBAC: [multi-tenancy], [global roles]                                               |
| `User`         | ReBAC: [user-resource relations]                                                    |
| `Document`     | RBAC: [resource roles], ReBAC: [user-resource relations], ABAC: [private resources] |

[global roles]: https://www.osohq.com/docs/guides/role-based-access-control-rbac/globalroles
[multi-tenancy]: https://www.osohq.com/docs/guides/role-based-access-control-rbac/roles
[private resources]: https://www.osohq.com/docs/guides/attribute-based-access-control-abac/public
[resource roles]: https://www.osohq.com/docs/guides/role-based-access-control-rbac/resourcespecific
[user-resource relations]: https://www.osohq.com/docs/guides/relationship-based-access-control-rebac/ownership

To get a holistic sense of using these authorization paradigms, look at both the
configuration and integration files.

### Configuration

Configuring your app to use Oso Cloud's local authorization is demonstrated
across a few files:

| File                   | Use                                                               |
| ---------------------- | ----------------------------------------------------------------- |
| `db_init_template.sql` | The application's database schema                                 |
| `oso-policy.polar`     | The authorization policy for this application                     |
| `oso-local-auth.yaml`  | Configuration correlating your policy and your application's data |

While there is a lot of inline documentation, you can find more documentation in
[Oso Cloud's Local Authorization
docs](https://www.osohq.com/docs/reference/authorization-data/local-authorization).

### Integration

This application's "backend" API implementation provides reference for
integrating local auth with TypeScript.

| File               | API for...                     |
| ------------------ | ------------------------------ |
| `/actions/org.ts`  | `Organization`s (tenants)      |
| `/actions/user.ts` | `Users` within `Organization`s |
| `/actions/doc.ts`  | `Document`s                    |

This code currently uses React server components for the API. Even if you do not
use React server components in your application, the examples are easily
adaptable to any API structure––all of the patterns are amenable to any endpoint
implementation.

## Architecture

- Oso local auth for all authorization requests
- NextJS with app routers for the back end
  - Automatic reload on changes
- PostgreSQL
  - Initialized with `db_init_template.sql`, which can reference `.env`
    variables.
- Docker w/ compose to build and run both components

## Running the app

1. [Log in to or create an Oso Cloud account](https://ui.osohq.com/).
1. [Create an API key for the
   application](https://www.osohq.com/docs/guides/production/manage-organization-settings#create-new-api-keys).
   Make sure you save this!
1. Copy `/oso-policy.polar` as the policy in the environment by deploying it.
1. Convert `.env.example` to `.env` with the appropriate values set, e.g.
   `OSO_CLOUD_API_KEY`.
1. Install the dependencies using a Node.JS package manager, such as `npm` or
   `yarn`.
1. Run the app locally via:

   ```sh
   docker compose up --build
   ```

   Note the provided `docker-compose.yml` file makes the PostgreSQL container
   accessible from the host machine on port `5433`. This should reduce the
   likelihood of interfering with any local PostgresSQL instances. Within Docker
   compose network, it still runs on the standard port, `5432`.

   If that port fails to work, grep for it in the provided code and change it to
   any other value.

1. Load the app at `http://localhost:3000`

From here you can create and manage:

- `Organization`s
- `User`s
- `Document`s

### Using your own database

You can configure the application to use your own database by point to it using
your `.env` file. You will want to ensure you also populate the database using
the contents of `db_init_template.sql`.

## Demonstrating the app

The application is meant to provided a means of creating tenants (Organizations)
and users, and then letting users create a and share documents with one another.

Going through these steps will demonstrate to you a number of its features.

1. Go to <http://localhost:3000/user/root>.
1. In **Create orgs**, enter `acme` and click **Add org**. You can now create
   users in a separate tenant.
1. In **Create users**, create a user named `alice` in the `acme` organization with the `admin` role, and then click **Add user**.
1. Click the link for `alice`, or go to
   <http://localhost:3000/user/alice>.
1. Because `alice` is an admin, you will be able to create other users in the
   `acme` organization here. Do that, creating a user `bob` who is a `member`.
1. In the **alice Docs** section, click **Create doc**, and name it `private`.
1. On the page that loads (which should be <http://localhost:3000/user/root/docs/1>), in the **Shareable** section, make `bob` and `editor`.
1. Click `< Home` in the upper-left-hand corner, and then create another document called `public`.
1. On the page that loads (which should be <http://localhost:3000/user/root/docs/2>), click **Set public**.
1. Click `< Home` and then click the [`bob`](http://localhost:3000/user/bob) link.
1. In the **bob Docs** section, you should see the following docs:
   - `private` because `alice` explicitly shared the document with `bob`. If you visit the document, you can change its title, which will be visible to all users who can see it.
   - `public` because `alice` and `bob` are both members of the same organization (`acme`) and the doc is public.

To understand why and how this all works, you'll need to read the code!

## Notes + TODOs

### Styling

TODO: Add a style to the app. Currently, the GUI is entirely unstyled HTML.

I left all of the `tailwind` boilerplate in here because it seemed obnoxious to
remove it and try to re-add it.
