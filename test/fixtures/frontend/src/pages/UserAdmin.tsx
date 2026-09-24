import axios from "axios";
import { getUser } from "../api/user";

export async function loadOrders() {
  const res = await axios.get("/orders");
  return res.data.items;
}

export async function renameUser(id: number, nickname: string) {
  return axios.patch(`/users/${id}`, { nickname });
}

export async function createUser(name: string, age: number) {
  return axios.post("/users", { name, age, nickname: name });
}

export async function searchUsers(keyword: string) {
  const { data } = await axios.get("/users/search", { params: { keyword, size: 20, limit: 5 } });
  return data.content.map((u) => u.nmae);
}

export async function badge(id: number) {
  const user = await getUser(id);
  return `${user.nickname} <${user.profile.email}> ${user.tags.length} ${user.status.label}`;
}
