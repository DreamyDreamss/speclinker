from django.db import models


class Order(models.Model):
    user_id = models.IntegerField(db_index=True)
    amount = models.IntegerField()
    status = models.CharField(max_length=32, default="PLACED")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orders"
