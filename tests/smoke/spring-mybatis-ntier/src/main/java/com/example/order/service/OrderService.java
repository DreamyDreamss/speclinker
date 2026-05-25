package com.example.order.service;

import com.example.order.dao.OrderDao;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderDao orderDao;

    public OrderService(OrderDao orderDao) {
        this.orderDao = orderDao;
    }

    public Object findById(Long id) {
        return orderDao.findById(id);
    }

    public Object create(Object dto) {
        return orderDao.insert(dto);
    }
}
