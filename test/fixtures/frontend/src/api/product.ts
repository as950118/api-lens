import { request } from "./client";

export const productApi = {
  getProduct: (id: number) => request({ method: "GET", url: `/products/${id}` }),
};
