import { useEffect, useState } from "react";
import { transform } from "some-utils";
import { getUser, userApi } from "../api/user";
import { UserCard } from "../components/UserCard";
import type { UserResponse } from "../types";

export function UserPage({ id }: { id: number }) {
  const [user, setUser] = useState<UserResponse | null>(null);

  useEffect(() => {
    getUser(id).then(setUser);
  }, [id]);

  if (!user) return null;

  return (
    <div>
      <h1>{user.name}</h1>
      <span>{user.age}</span>
      <UserCard user={user} />
    </div>
  );
}

export async function loadProfile(id: number) {
  const { name } = await getUser(id);
  const user = await userApi.getUser(id);
  console.log(name, user?.profile.email);
  const value = transform(user);
  return value.name;
}
