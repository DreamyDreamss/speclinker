from rest_framework.viewsets import ModelViewSet
from rest_framework.response import Response
from orders.services.order_service import OrderService


_svc = OrderService()


class OrderViewSet(ModelViewSet):
    def retrieve(self, request, pk=None):
        order = _svc.find_by_id(pk)
        return Response(order)

    def create(self, request):
        order = _svc.create(request.data)
        return Response(order, status=201)
