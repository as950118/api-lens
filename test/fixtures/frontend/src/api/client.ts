import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

export function request(options: { method: string; url: string }) {
  return api.request(options);
}
