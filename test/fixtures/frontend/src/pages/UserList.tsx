import { useQuery } from "@tanstack/react-query";
import { listUsers } from "../api/user";

export function UserList() {
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });
  return (
    <ul>
      {data?.map((u) => (
        <li key={u.name}>{u.age}</li>
      ))}
    </ul>
  );
}
