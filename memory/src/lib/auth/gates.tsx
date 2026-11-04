import { useCurrentUser } from "./use-current-user";

/** A small label for who is using the app. There is no account and nothing to sign out of. */
export function UserButton() {
  const user = useCurrentUser();
  if (!user) return null;
  return (
    <span className="text-sm font-medium text-muted-foreground">
      {user.displayName ?? "Local owner"}
    </span>
  );
}
