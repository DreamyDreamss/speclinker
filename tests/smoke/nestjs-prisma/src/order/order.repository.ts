import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class OrderRepository {
  async findById(id: number) {
    return prisma.order.findUnique({ where: { id } });
  }

  async insert(dto: Record<string, unknown>) {
    return prisma.order.create({ data: dto as any });
  }
}
