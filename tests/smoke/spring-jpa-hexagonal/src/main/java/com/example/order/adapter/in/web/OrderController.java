package com.example.order.adapter.in.web;

import com.example.order.application.service.PlaceOrderService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
    private final PlaceOrderService placeOrderService;

    public OrderController(PlaceOrderService placeOrderService) {
        this.placeOrderService = placeOrderService;
    }

    @PostMapping("/api/orders")
    public Object place(@RequestBody Object cmd) {
        return placeOrderService.place(cmd);
    }
}
