/** The one local owner. There is no sign-in; see `middleware.ts`. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
};

export const LOCAL_OWNER: AppUser = {
  id: "local-owner",
  displayName: "Local owner",
  primaryEmail: null,
};

export type CurrentUserState = { user: AppUser | null; isPending: boolean };

export function useCurrentUserState(): CurrentUserState {
  return { user: LOCAL_OWNER, isPending: false };
}

export function useCurrentUser(): AppUser | null {
  return LOCAL_OWNER;
}
