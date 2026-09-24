import axios from "axios";

export const api = axios.create({ baseURL: "https://api.example.com" });

export function request(options: { method: string; url: string }) {
  return api.request(options);
}
