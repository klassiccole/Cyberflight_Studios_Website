import {createBookingHandlers} from '../../../lib/booking-submit.mjs';
import {onRequest as readAvailability} from '../availability.js';
const handlers=createBookingHandlers({readAvailability});
export const onRequest=context=>handlers.submit(context);
