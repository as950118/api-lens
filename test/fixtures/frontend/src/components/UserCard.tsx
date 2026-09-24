import type { UserResponse } from "../types";

export function UserCard({ user }: { user: UserResponse }) {
  return <p>{user.name.toUpperCase()}</p>;
}
