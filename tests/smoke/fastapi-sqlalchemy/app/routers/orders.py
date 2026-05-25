from fastapi import APIRouter
from app.services.order_service import OrderService

router = APIRouter(prefix="/api/orders")
svc = OrderService()


@router.get("/{order_id}")
async def get_order(order_id: int):
    return svc.find_by_id(order_id)


@router.post("")
async def create_order(body: dict):
    return svc.create(body)
