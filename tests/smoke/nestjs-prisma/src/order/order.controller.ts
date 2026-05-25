import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { OrderService } from './order.service';

@Controller('api/orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orderService.findById(Number(id));
  }

  @Post()
  create(@Body() dto: Record<string, unknown>) {
    return this.orderService.create(dto);
  }
}
