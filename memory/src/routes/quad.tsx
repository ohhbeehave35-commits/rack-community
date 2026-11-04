import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/quad")({
  beforeLoad: () => {
    throw redirect({ to: "/claude" });
  },
});
