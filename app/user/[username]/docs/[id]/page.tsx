import React from "react";

import DocumentEditor from "./features/documents/DocumentEditor";

interface DocumentViewProps {
  params: { username: string; id: number };
}

/**
 * Render the user's view of the application.
 */
export default async function DocumentView({ params }: DocumentViewProps) {
  const { id, username } = params;
  return (
    <div>
      <DocumentEditor username={username} id={id} />
    </div>
  );
}
