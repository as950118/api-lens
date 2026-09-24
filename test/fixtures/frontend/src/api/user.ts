import axios from "axios";
import { api } from "./client";
import type { UserResponse } from "../types";

export async function getUser(id: number): Promise<UserResponse> {
  const res = await axios.get(`/users/${id}`);
  return res.data;
}

export const userApi = {
  getUser: (id: number) => axios.get<UserResponse>("/users/" + id).then((res) => res.data),
  updateUser: (id: number, body: Partial<UserResponse>) => api.put(`/users/${id}`, body),
};

export async function listUsers(): Promise<UserResponse[]> {
  const response = await fetch("/users");
  return response.json();
}

export function deleteUser(id: number) {
  return fetch(`/users/${id}`, { method: "DELETE" });
}
