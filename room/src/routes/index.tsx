import { createFileRoute } from "@tanstack/react-router";
import { TalkbackRoom } from "@/components/talkback/room";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <TalkbackRoom />;
}
