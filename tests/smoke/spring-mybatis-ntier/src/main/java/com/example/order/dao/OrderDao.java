package com.example.order.dao;

import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface OrderDao {
    Object findById(Long id);
    Object insert(Object dto);
}
