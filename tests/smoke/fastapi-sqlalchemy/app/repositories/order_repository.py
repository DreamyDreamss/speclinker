from sqlalchemy import select
from app.models.order import Order


class OrderRepository:
    def find_by_id(self, order_id: int):
        # 실제론 session.scalar(select(Order).where(...))
        return None

    def insert(self, dto: dict):
        order = Order(**dto)
        return order
