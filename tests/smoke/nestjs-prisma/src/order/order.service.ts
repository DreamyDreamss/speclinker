import { Injectable } from '@nestjs/common';
import { OrderRepository } from './order.repository';

@Injectable()
export class OrderService {
  constructor(private readonly repo: OrderRepository) {}

  findById(id: number) {
    return this.repo.findById(id);
  }

  create(dto: Record<string, unknown>) {
    return this.repo.insert(dto);
  }
}
