import { Controller, Get, Param, Patch, Query, Body } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductPatch } from "./products.types";

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query("limit") limit?: string, @Query("cursor") cursor?: string) {
    const parsedLimit = Number(limit ?? 20);
    return this.productsService.list(parsedLimit, cursor);
  }

  @Get(":productId")
  getById(@Param("productId") productId: string) {
    return this.productsService.getById(productId);
  }

  @Patch(":productId")
  update(@Param("productId") productId: string, @Body() body: ProductPatch) {
    return this.productsService.update(productId, body);
  }
}
