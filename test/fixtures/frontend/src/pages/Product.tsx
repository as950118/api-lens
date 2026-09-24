import { productApi } from "../api/product";

export async function showPrice(id: number) {
  const product = await productApi.getProduct(id);
  return product.price;
}
