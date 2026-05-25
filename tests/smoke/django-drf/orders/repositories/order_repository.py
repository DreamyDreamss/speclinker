from orders.models.order import Order


class OrderRepository:
    def find_by_id(self, pk):
        return Order.objects.filter(pk=pk).first()

    def insert(self, data):
        return Order.objects.create(**data)
