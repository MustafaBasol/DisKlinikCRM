import { processPayment, refundPayment } from '../services/paymentService.js';
import * as inventoryService from '../services/inventoryService.js';
import '../services/sideEffectOnly.js';
import { formatOrderId } from '../utils/helper.js';
import unresolvedDefault from '../unscoped/outOfScope.js';

export function placeOrder(): void {
  processPayment();
  refundPayment();
  inventoryService.reserve();
  formatOrderId('1');
  void unresolvedDefault;
}
