from app.repositories.order_repository import OrderRepository


class OrderService:
    def __init__(self) -> None:
        self.repo = OrderRepository()

    def find_by_id(self, order_id: int):
        return self.repo.find_by_id(order_id)

    def create(self, dto: dict):
        return self.repo.insert(dto)
