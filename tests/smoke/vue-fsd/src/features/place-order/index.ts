import { ref } from 'vue';
import { createOrder } from '../../entities/order';

export const PlaceOrderForm = {
  setup() {
    const userId = ref<number>(0);
    const amount = ref<number>(0);
    const submit = async () => {
      await createOrder({ userId: userId.value, amount: amount.value });
    };
    return { userId, amount, submit };
  },
  template: `
    <form @submit.prevent="submit">
      <input v-model.number="userId" placeholder="userId" />
      <input v-model.number="amount" placeholder="amount" />
      <button>Place</button>
    </form>
  `,
};
