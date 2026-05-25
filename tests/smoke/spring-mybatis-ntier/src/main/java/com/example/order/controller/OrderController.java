package com.example.order.controller;

import com.example.order.service.OrderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/api/orders/{id}")
    public Object getOrder(@PathVariable Long id) {
        return orderService.findById(id);
    }

    @PostMapping("/api/orders")
    public Object createOrder(@RequestBody Object dto) {
        return orderService.create(dto);
    }
}
