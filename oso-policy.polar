actor User {
    permissions = ["read", "edit_role", "delete"];
    relations = {
        parent: Organization
    };

    "read" if "member" on "parent";
    "edit_role" if "admin" on "parent";
    "delete" if "admin" on "parent";
}

resource Organization {
    roles = ["admin", "member"];
    permissions = ["read", "create_user"];

    "member" if "admin";

    "read" if "member";
    "create_user" if "admin";
}
