package com.example.order.application.service;

import com.example.order.domain.Order;
import com.example.order.adapter.out.persistence.OrderRepository;
import org.springframework.stereotype.Service;

@Service
public class PlaceOrderService {
    private final OrderRepository orderRepository;

    public PlaceOrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public Order place(Object cmd) {
        Order order = Order.create(cmd);
        return orderRepository.save(order);
    }
}
