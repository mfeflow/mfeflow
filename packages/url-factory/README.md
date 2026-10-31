# @mfeflow/url-factory

Typed API URLs for micro-frontends. Path params are checked from the template at compile time, and base URLs are read from runtime config on every call, so one build runs in every environment.

## Install

```sh
pnpm add @mfeflow/url-factory
```

## Usage

```ts
import { createUrlFactory, defineEndpoints } from '@mfeflow/url-factory';

const endpoints = defineEndpoints({
  getOrder: { service: 'orders', path: '/v1/orders/:orderId' },
  listOrders: { service: 'orders', path: '/v1/orders' },
});

const services: Record<string, string> = { orders: 'https://api.example.com' };
const apiUrl = createUrlFactory(endpoints, (service) => services[service]);

apiUrl('getOrder', { params: { orderId: 42 }, query: { expand: 'items' } });
// https://api.example.com/v1/orders/42?expand=items
apiUrl('getOrder'); // compile error: params are required
```

A missing param, an unknown endpoint or a service without a base URL throws with a message that names it.

## Module Federation sharing

Bucket: **stateless**. Nothing here holds state shared between micro-frontends, so each remote can bundle its own copy and different versions can run side by side. No sharing config is needed.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [mfeflow.dev](https://mfeflow.dev) (documentation, coming soon)

MIT licensed.
