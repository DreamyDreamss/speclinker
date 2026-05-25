from orders.repositories.order_repository import OrderRepository


class OrderService:
    def __init__(self) -> None:
        self.repo = OrderRepository()

    def find_by_id(self, pk):
        return self.repo.find_by_id(pk)

    def create(self, data):
        return self.repo.insert(data)
