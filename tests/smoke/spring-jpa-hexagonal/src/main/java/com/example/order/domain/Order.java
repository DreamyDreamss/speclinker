package com.example.order.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.GeneratedValue;

@Entity
public class Order {
    @Id @GeneratedValue
    private Long id;
    private Long userId;
    private Long amount;
    private String status;

    public static Order create(Object cmd) {
        Order o = new Order();
        o.status = "PLACED";
        return o;
    }
}
