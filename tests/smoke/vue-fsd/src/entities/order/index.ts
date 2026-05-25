import { apiClient } from '../../shared/api/client';

export interface Order {
  id: number;
  userId: number;
  amount: number;
  status: string;
}

export async function fetchOrder(id: string): Promise<Order> {
  return apiClient.get(`/api/orders/${id}`);
}

export async function createOrder(payload: { userId: number; amount: number }): Promise<Order> {
  return apiClient.post('/api/orders', payload);
}
