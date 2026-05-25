<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { PlaceOrderForm } from '../../features/place-order';
import { fetchOrder } from '../../entities/order';

const route = useRoute();
const order = ref<any>(null);

onMounted(async () => {
  if (route.params.id) {
    order.value = await fetchOrder(String(route.params.id));
  }
});
</script>

<template>
  <div>
    <h1>Order Page</h1>
    <PlaceOrderForm />
    <pre v-if="order">{{ order }}</pre>
  </div>
</template>
