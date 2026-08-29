import { Router } from 'express';
import { getOrder, createOrder } from '../controllers/orders.controller.js';

export const ordersRouter = Router();

ordersRouter.get('/:orderId', getOrder);
ordersRouter.post('/', createOrder);
