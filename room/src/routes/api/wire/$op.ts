import { createFileRoute } from "@tanstack/react-router";
import { handleWire, wirePreflight } from "@/lib/talkback/wire-http";

export const Route = createFileRoute("/api/wire/$op")({
  server: {
    handlers: {
      OPTIONS: () => wirePreflight(),
      GET: ({ request, params }) => handleWire(request, params.op),
      POST: ({ request, params }) => handleWire(request, params.op),
    },
  },
});
