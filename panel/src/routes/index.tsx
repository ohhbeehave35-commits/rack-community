import { createFileRoute } from "@tanstack/react-router";
import { RackShell } from "@/components/rack/shell";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <RackShell />;
}
